import UIKit
import JavaScriptRuntime
import yoga

/// Runs the JS bundle off the main thread and applies the operations sent by the Vue renderer
/// (src/renderer.js) to UIKit + Yoga in batches on the main thread.
final class Bridge {
    /// Posted by the app with a URL it was opened with (deep link); forwarded to JS (`__openURL`).
    static let openURLNotification = Notification.Name("NativueOpenURL")

    /// The simulator shares the Mac's network; a device uses the Mac's name, written into the app at build
    /// time by the "Write Dev Server Host" build phase.
    static let devServerURL: URL = {
        #if targetEnvironment(simulator)
        let host = "localhost"
        #else
        let hostFile = Bundle.main.url(forResource: "dev-server-host", withExtension: "txt")
        let host = hostFile.flatMap { try? String(contentsOf: $0, encoding: .utf8) }?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? "localhost"
        #endif

        return URL(string: "http://\(host):40836")!
    }()

    // ponytail: GCD threads have a 512 KB stack; move to a Thread with a bigger stack if deep trees hit
    // "RangeError: Maximum call stack size exceeded".
    private let javaScriptQueue = DispatchQueue(label: "dev.nativue.javascript", qos: .userInteractive)

    // Only touched on javaScriptQueue.
    private var runtime: JavaScriptRuntime?
    private var pendingOperations: [() -> Void] = []
    private lazy var storage = KeyValueStorage(javaScriptQueue: javaScriptQueue)
    /// Set by LayoutAnimation.configureNext in JS; animates the batch it's sent with.
    private var nextLayoutAnimation: LayoutAnimation?
    /// Appearance.getColorScheme(): read on the main thread at start, then kept up to date.
    private var colorScheme = "light"

    // Only touched on the main thread.
    var rootView: RootView!
    private var gestureReportersByNodeId: [Int: GestureReporter] = [:]
    private let animatedGraph = AnimatedGraph()
    // ponytail: children of a removed node stay in the dictionary; clean up recursively if memory leaks.
    var nodesById: [Int: NativeNode] = [:]
    /// Modals and screens: their content is laid out as a separate Yoga root.
    // ponytail: Vue removes only a subtree's root, so the modals and screens inside a removed subtree stay
    // here and are laid out on every pass; drop the detached ones on remove if navigators come and go.
    private var contentRootsByNodeId: [Int: ContentRoot] = [:]
    /// Read on the main thread at start, for Dimensions.get('window').
    private var windowSize: CGSize = .zero
    /// The bundle running now, for the error overlay's Reload.
    private var bundle = Data()
    private let errorOverlay = ErrorOverlay()
    private let pluginRegistry: PluginRegistry

    init(plugins: [NativuePlugin]) {
        pluginRegistry = PluginRegistry(plugins: plugins)
    }

    func start(rootView: RootView) {
        self.rootView = rootView
        rootView.onLayoutSubviews = { [unowned self] in layout() }
        let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene
        windowSize = windowScene?.screen.bounds.size ?? .zero
        colorScheme = Self.colorScheme(of: windowScene?.traitCollection ?? rootView.traitCollection)
        // start runs on the main thread, from makeUIView.
        MainActor.assumeIsolated {
            _ = rootView.registerForTraitChanges([UITraitUserInterfaceStyle.self]) {
                [unowned self] (rootView: RootView, _: UITraitCollection) in
                colorSchemeDidChange(to: Self.colorScheme(of: rootView.traitCollection))
            }
        }

        NotificationCenter.default.addObserver(forName: Self.openURLNotification, object: nil, queue: .main) {
            [unowned self] notification in
            guard let url = notification.object as? URL else { return }

            openURL(url)
        }

        guard let bundleURL = Bundle.main.url(forResource: "main.bundle", withExtension: "js") else {
            fatalError("ios/App/main.bundle.js is missing: run `npm run dev` (or `npm run build`), then build again")
        }
        run(try! Data(contentsOf: bundleURL))
        #if DEBUG
        Task { await listenForReload() }
        #endif
    }

    /// Discards the current node tree and runtime, then runs the bundle from scratch: JavaScript, or
    /// Hermes bytecode (production builds).
    func run(_ bundle: Data) {
        self.bundle = bundle
        errorOverlay.hide()

        evaluate { [unowned self] in
            enqueue { [unowned self] in resetNodeTree() }

            runtime = makeRuntime()
            runtime?.evaluate(bundle, sourceURL: "main.bundle.js")
        }
    }

    /// Runs `work` on the JS queue, then applies every native operation it produced, in one batch, on the
    /// main thread. The runtime drains promise jobs after each call, so Vue's updates are included.
    func evaluate(_ work: @escaping () -> Void) {
        javaScriptQueue.async { [unowned self] in
            work()

            let operations = pendingOperations
            let layoutAnimation = nextLayoutAnimation
            pendingOperations = []
            nextLayoutAnimation = nil

            DispatchQueue.main.async { [unowned self] in
                apply(operations, animatedWith: layoutAnimation)
                requestLayout()
            }
        }
    }

    /// An animated batch lays out right away, inside the animation, so the new frames animate too.
    private func apply(_ operations: [() -> Void], animatedWith layoutAnimation: LayoutAnimation?) {
        guard let layoutAnimation else { return operations.forEach { $0() } }

        layoutAnimation.perform { [unowned self] in
            operations.forEach { $0() }
            layout()
        }
    }

    func layout() {
        nodesById[0]?.calculateLayout(width: rootView.bounds.width, height: rootView.bounds.height)

        for contentRoot in contentRootsByNodeId.values {
            (contentRoot as? ModalController)?.dismissIfDetached()
            contentRoot.layoutContent()
        }
    }

    /// Results reaching a runtime that has since been reloaded are dropped: call ids start over in the new one.
    private func finishAsyncFunction(_ callId: Int, owner: JavaScriptRuntime?, value: Any?, errorMessage: String?) {
        evaluate { [unowned self] in
            guard runtime === owner else { return }

            let arguments: [Any] = [callId, value ?? NSNull(), errorMessage ?? NSNull()]
            runtime?.call("__asyncFunctionFinished", arguments: arguments)
        }
    }

    private static func colorScheme(of traits: UITraitCollection) -> String {
        traits.userInterfaceStyle == .dark ? "dark" : "light"
    }

    private func colorSchemeDidChange(to nextColorScheme: String) {
        evaluate { [unowned self] in
            guard nextColorScheme != colorScheme else { return }

            colorScheme = nextColorScheme
            runtime?.call("__colorSchemeChanged", arguments: [nextColorScheme])
        }
    }

    /// Queued on the JS queue, so a URL that opens the app arrives after the bundle has run.
    private func openURL(_ url: URL) {
        evaluate { [unowned self] in
            runtime?.call("__openURL", arguments: [url.absoluteString])
        }
    }

    /// UIKit coalesces these requests, so the layout pass runs once per batch.
    func requestLayout() {
        rootView.setNeedsLayout()
    }

    #if DEBUG
    @MainActor func listenForReload() async {
        let eventsURL = Self.devServerURL.appending(path: "events")
        let bundleURL = Self.devServerURL.appending(path: "bundle.js")

        while true {
            do {
                let (events, _) = try await URLSession.shared.bytes(from: eventsURL)

                for try await line in events.lines where line == "data: reload" {
                    let (data, _) = try await URLSession.shared.data(from: bundleURL)
                    print("[Nativue] reload")
                    run(data)
                }
            } catch {}

            try? await Task.sleep(for: .seconds(2)) // dev server is down: retry
        }
    }
    #endif

    // MARK: - JS queue

    private func enqueue(_ operation: @escaping () -> Void) {
        pendingOperations.append(operation)
    }

    private typealias NativeFunction = (_ arguments: [Any]) -> Any?
    private typealias Define = (_ name: String, _ function: @escaping (_ arguments: [Any]) -> Void) -> Void
    private typealias DefineGetter = (_ name: String, _ function: @escaping NativeFunction) -> Void

    /// Errors outside Vue (timers, native callbacks, the bundle itself) come from the runtime; Vue's
    /// through `__native.reportError`.
    private func makeRuntime() -> JavaScriptRuntime {
        var functions: [String: Any] = [:]
        func defineGetter(_ name: String, _ function: @escaping NativeFunction) {
            functions[name] = function as @convention(block) ([Any]) -> Any?
        }
        func define(_ name: String, _ function: @escaping (_ arguments: [Any]) -> Void) {
            defineGetter(name) { arguments in
                function(arguments)
                return nil
            }
        }

        define("log") { arguments in print("[JS]", arguments[0]) }

        define("reportError") { [unowned self] arguments in
            reportError(message: string(arguments[0]), details: string(arguments[1]))
        }

        // ponytail: the size at launch; report rotation and split view changes if the app supports them.
        defineGetter("windowSize") { [unowned self] _ in
            ["width": windowSize.width, "height": windowSize.height]
        }

        defineGetter("platform") { _ in "ios" }

        // Prefixed, so a plugin can't replace nativue's own functions.
        for (name, function) in pluginRegistry.functions {
            defineGetter("plugin:\(name)", function)
        }

        // (callId, ...arguments): settles the call with __asyncFunctionFinished.
        for (name, function) in pluginRegistry.asyncFunctions {
            define("pluginAsync:\(name)") { [unowned self] arguments in
                let callId = int(arguments[0])
                let owner = runtime

                Task {
                    do {
                        let value = try await function(Array(arguments.dropFirst()))
                        finishAsyncFunction(callId, owner: owner, value: value, errorMessage: nil)
                    } catch {
                        finishAsyncFunction(callId, owner: owner, value: nil, errorMessage: error.localizedDescription)
                    }
                }
            }
        }

        defineGetter("colorScheme") { [unowned self] _ in colorScheme }

        define("create") { [unowned self] arguments in
            let (id, type) = (int(arguments[0]), string(arguments[1]))
            enqueue { [unowned self] in nodesById[id] = makeNode(type: type, id: id) }
        }

        define("insert") { [unowned self] arguments in
            let (parentId, childId, index) = (int(arguments[0]), int(arguments[1]), int(arguments[2]))
            enqueue { [unowned self] in insertNode(childId: childId, parentId: parentId, at: index) }
        }

        define("remove") { [unowned self] arguments in
            let id = int(arguments[0])
            enqueue { [unowned self] in removeNode(id: id) }
        }

        define("setText") { [unowned self] arguments in
            let (id, text) = (int(arguments[0]), string(arguments[1]))
            enqueue { [unowned self] in setText(text, onNodeId: id) }
        }

        define("setProp") { [unowned self] arguments in
            let (id, key, value) = (int(arguments[0]), string(arguments[1]), arguments[2])
            enqueue { [unowned self] in setProp(key, value: value, onNodeId: id) }
        }

        defineAnimatedFunctions(define)
        defineStorageFunctions(define, defineGetter)
        defineFetch(define)

        define("setTimer") { [unowned self] arguments in
            let (timerId, delayInMilliseconds) = (int(arguments[0]), int(arguments[1]))
            setTimer(timerId, delayInMilliseconds: delayInMilliseconds)
        }

        define("configureNextLayoutAnimation") { [unowned self] arguments in
            nextLayoutAnimation = LayoutAnimation(config: arguments[0] as? [String: Any] ?? [:])
        }

        define("dismissKeyboard") { [unowned self] _ in
            enqueue { [unowned self] in rootView.window?.endEditing(true) }
        }

        return JavaScriptRuntime(functions: functions) { [unowned self] message, stack in
            reportError(message: message, details: stack)
        }
    }

    /// A timer of a runtime that has since been reloaded doesn't fire: timer ids start over in the new one.
    private func setTimer(_ timerId: Int, delayInMilliseconds: Int) {
        let owner = runtime

        javaScriptQueue.asyncAfter(deadline: .now() + .milliseconds(delayInMilliseconds)) { [unowned self] in
            guard runtime === owner else { return }

            evaluate { [unowned self] in runtime?.call("__fireTimer", arguments: [timerId]) }
        }
    }

    /// Logged always; shown over the app in development builds.
    private func reportError(message: String, details: String) {
        print("[Nativue] JS error:", message, "\n" + details)

        #if DEBUG
        Task { @MainActor [unowned self] in
            let details = await symbolicated(details)
            errorOverlay.show(message: message, details: details) { [unowned self] in run(bundle) }
        }
        #endif
    }

    #if DEBUG
    /// The dev server maps main.bundle.js lines back to the app's files with the bundle's source map.
    /// Without a dev server, the stack stays as it is.
    private func symbolicated(_ text: String) async -> String {
        var request = URLRequest(url: Self.devServerURL.appending(path: "symbolicate"), timeoutInterval: 2)
        request.httpMethod = "POST"
        request.httpBody = Data(text.utf8)

        guard
            let (data, response) = try? await URLSession.shared.data(for: request),
            (response as? HTTPURLResponse)?.statusCode == 200
        else { return text }

        return String(decoding: data, as: UTF8.self)
    }
    #endif

    // MARK: - Main thread

    private func resetNodeTree() {
        // Sheets of the old tree's screen stacks too, which only their stack knows about.
        rootView.window?.rootViewController?.dismiss(animated: false)
        rootView.subviews.forEach { $0.removeFromSuperview() }
        contentRootsByNodeId.values.forEach { ($0 as? ModalController)?.setVisible(false) }
        contentRootsByNodeId = [:]
        gestureReportersByNodeId = [:] // node ids start over
        animatedGraph.reset()
        animatedGraph.onAnimationEnd = { [unowned self] animationId, finished in
            evaluate { [unowned self] in
                runtime?.call("__animationFinished", arguments: [animationId, finished])
            }
        }
        nodesById = [0: NativeNode(view: rootView, measuresContent: false)]
    }

    private func insertNode(childId: Int, parentId: Int, at index: Int) {
        guard let parent = nodesById[parentId], let child = nodesById[childId] else { return }

        guard parent.canHaveChildren else {
            print("[Nativue] <\(type(of: parent.view))> can't have native children; use <View>")
            return
        }

        if let container = parent.view as? ScreenContainer, let screen = screenController(childId) {
            container.insertScreen(screen, at: index)
            return
        }

        (parent.contentNode ?? parent).insertChild(child, at: index)
    }

    /// A screen leaves through its stack, so the navigation controller animates it out.
    private func removeNode(id: Int) {
        guard let node = nodesById.removeValue(forKey: id) else { return }

        guard let screen = screenController(id) else {
            node.removeFromParent()
            return
        }

        contentRootsByNodeId[id] = nil
        screen.container?.removeScreen(screen)
    }

    private func modalController(_ id: Int) -> ModalController? {
        contentRootsByNodeId[id] as? ModalController
    }

    private func screenController(_ id: Int) -> ScreenController? {
        contentRootsByNodeId[id] as? ScreenController
    }

    private func makeNode(type: String, id: Int) -> NativeNode {
        switch type {
        case "Text":
            let label = UILabel()
            label.numberOfLines = 0
            return NativeNode(view: label, measuresContent: true)

        case "Button":
            let button = UIButton(type: .system)
            button.addAction(UIAction { [unowned self] _ in dispatchEvent("press", toNodeId: id) }, for: .touchUpInside)
            return NativeNode(view: button, measuresContent: true)

        case "ScrollView":
            return NativeNode(view: VueScrollView(), measuresContent: false)

        case "Image":
            return NativeNode(view: ImageView(frame: .zero), measuresContent: false)

        case "SwipeableView":
            return NativeNode(view: SwipeableView(frame: .zero), measuresContent: false)

        case "Svg":
            return NativeNode(view: SvgView(frame: .zero), measuresContent: false)

        case "PressableView":
            let pressableView = PressableView()
            pressableView.onEvent = { [unowned self] eventName in dispatchEvent(eventName, toNodeId: id) }
            return NativeNode(view: pressableView, measuresContent: false)

        case "KeyboardAvoidingView":
            let keyboardAvoidingView = KeyboardAvoidingView()
            let node = NativeNode(view: keyboardAvoidingView, measuresContent: false)
            // weak: a reload frees the node while a dismissing modal still shows its view.
            keyboardAvoidingView.onKeyboardOverlapChange = { [unowned self, weak node] overlap in
                guard let node else { return }

                YGNodeStyleSetPadding(node.yogaNode, .bottom, Float(overlap))
                rootView.setNeedsLayout()
                rootView.layoutIfNeeded() // runs inside the keyboard animation, so frames animate with it
            }
            return node

        case "SafeAreaView":
            let safeAreaView = SafeAreaView()
            let node = NativeNode(view: safeAreaView, measuresContent: false)
            safeAreaView.onSafeAreaInsetsChange = { [unowned self, weak node] in
                if node?.applySafeAreaPadding() == true { requestLayout() }
            }
            return node

        case "TextInput":
            return NativeNode(view: makeTextInput(id: id), measuresContent: true)

        case "ScreenStack":
            return NativeNode(view: ScreenStackView(), measuresContent: false)

        case "TabBar":
            let tabBar = TabBarView()
            tabBar.onTabChange = { [unowned self] index in
                dispatchEvent("tabchange", toNodeId: id, payload: ["index": index])
            }
            return NativeNode(view: tabBar, measuresContent: false)

        case "Screen":
            let screen = ScreenController()
            screen.onEvent = { [unowned self] eventName, payload in
                dispatchEvent(eventName, toNodeId: id, payload: payload)
            }
            contentRootsByNodeId[id] = screen
            return screen.contentNode

        case "Switch":
            let toggle = UISwitch()
            toggle.addAction(UIAction { [unowned self, unowned toggle] _ in
                dispatchEvent("valuechange", toNodeId: id, payload: toggle.isOn)
            }, for: .valueChanged)
            return NativeNode(view: toggle, measuresContent: true)

        case "ActivityIndicator":
            let indicator = UIActivityIndicatorView(style: .medium)
            indicator.hidesWhenStopped = true
            indicator.startAnimating() // `animating` defaults to true
            return NativeNode(view: indicator, measuresContent: true)

        case "Modal":
            let modalController = ModalController()
            modalController.onEvent = { [unowned self] eventName in dispatchEvent(eventName, toNodeId: id) }
            contentRootsByNodeId[id] = modalController

            let node = NativeNode(view: modalController.placeholderView, measuresContent: false)
            YGNodeStyleSetDisplay(node.yogaNode, .none)
            node.contentNode = modalController.contentNode
            return node

        default:
            guard let makeView = pluginRegistry.viewMakers[type] else {
                return NativeNode(view: UIView(), measuresContent: false)
            }

            let view = makeView { [unowned self] eventName, payload in
                dispatchEvent(eventName, toNodeId: id, payload: payload)
            }
            return NativeNode(view: view, measuresContent: false)
        }
    }

    private func makeTextInput(id: Int) -> TextInputView {
        let textInput = TextInputView()

        textInput.addAction(UIAction { [unowned self, unowned textInput] _ in
            textInput.recordTextSentToJavaScript()
            dispatchEvent("changetext", toNodeId: id, payload: textInput.text ?? "")
        }, for: .editingChanged)

        // Listening to "did end on exit" also makes the return key close the keyboard, as single-line
        // inputs are expected to.
        textInput.addAction(UIAction { [unowned self, unowned textInput] _ in
            dispatchEvent("submitediting", toNodeId: id, payload: textInput.text ?? "")
        }, for: .editingDidEndOnExit)

        textInput.addAction(UIAction { [unowned self] _ in
            dispatchEvent("focus", toNodeId: id, payload: nil)
        }, for: .editingDidBegin)

        textInput.addAction(UIAction { [unowned self, unowned textInput] _ in
            textInput.endEditingSession()
            dispatchEvent("blur", toNodeId: id, payload: nil)
        }, for: .editingDidEnd)

        return textInput
    }

    /// AsyncStorage: synchronous on the JS queue (values are in memory); JS wraps them in promises.
    private func defineStorageFunctions(_ define: Define, _ defineGetter: DefineGetter) {
        defineGetter("storageGet") { [unowned self] arguments in
            storage.value(forKey: string(arguments[0]))
        }

        define("storageSet") { [unowned self] arguments in
            storage.setValue(string(arguments[1]), forKey: string(arguments[0]))
        }

        define("storageRemove") { [unowned self] arguments in
            storage.removeValue(forKey: string(arguments[0]))
        }

        defineGetter("storageKeys") { [unowned self] _ in
            storage.keys
        }

        define("storageClear") { [unowned self] _ in
            storage.removeAll()
        }
    }

    /// fetch: URLSession runs the request; JS hears back through __fetchFinished(requestId, response, error).
    /// ponytail: text bodies only (no binary, FormData or streaming) and no abort.
    private func defineFetch(_ define: Define) {
        define("fetch") { [unowned self] arguments in
            let (requestId, url, method) = (int(arguments[0]), string(arguments[1]), string(arguments[2]))
            let headers = arguments[3] as? [String: String] ?? [:]
            let bodyText = arguments[4] as? String
            let owner = runtime

            guard let url = URL(string: url) else {
                return finishFetch(requestId, owner: owner, response: nil, error: "invalid URL \(url)")
            }

            var request = URLRequest(url: url)
            request.httpMethod = method
            request.httpBody = bodyText?.data(using: .utf8)
            headers.forEach { name, value in request.setValue(value, forHTTPHeaderField: name) }

            URLSession.shared.dataTask(with: request) { [unowned self] data, response, error in
                guard let response = response as? HTTPURLResponse, error == nil else {
                    return finishFetch(
                        requestId, owner: owner, response: nil, error: error?.localizedDescription ?? "no response"
                    )
                }

                finishFetch(requestId, owner: owner, response: [
                    "status": response.statusCode,
                    "headers": response.allHeaderFields,
                    "body": String(decoding: data ?? Data(), as: UTF8.self),
                ], error: nil)
            }.resume()
        }
    }

    /// Like finishAsyncFunction, dropped if the runtime that asked has since been reloaded.
    private func finishFetch(_ requestId: Int, owner: JavaScriptRuntime?, response: [String: Any]?, error: String?) {
        evaluate { [unowned self] in
            guard runtime === owner else { return }
            let arguments: [Any] = [requestId, response ?? NSNull(), error ?? NSNull()]
            runtime?.call("__fetchFinished", arguments: arguments)
        }
    }

    /// Animated's native driver (see AnimatedGraph); queued like the view operations, so a value bound in
    /// a batch exists when that batch is applied.
    private func defineAnimatedFunctions(_ define: Define) {
        define("createAnimatedNode") { [unowned self] arguments in
            let (id, config) = (int(arguments[0]), arguments[1] as? [String: Any] ?? [:])
            enqueue { [unowned self] in animatedGraph.createNode(id: id, config: config) }
        }

        define("setAnimatedValue") { [unowned self] arguments in
            let (id, value) = (int(arguments[0]), double(arguments[1]))
            enqueue { [unowned self] in animatedGraph.setValue(value, ofNode: id) }
        }

        define("startAnimation") { [unowned self] arguments in
            let (animationId, nodeId) = (int(arguments[0]), int(arguments[1]))
            let config = arguments[2] as? [String: Any] ?? [:]
            enqueue { [unowned self] in animatedGraph.startAnimation(id: animationId, nodeId: nodeId, config: config) }
        }

        define("stopAnimation") { [unowned self] arguments in
            let nodeId = int(arguments[0])
            enqueue { [unowned self] in animatedGraph.stopAnimation(ofNode: nodeId) }
        }

        define("setAnimatedStyle") { [unowned self] arguments in
            let (viewId, binding) = (int(arguments[0]), arguments[1] as? [String: Any])
            enqueue { [unowned self] in
                guard let view = nodesById[viewId]?.view else { return }

                animatedGraph.bind(view: view, viewId: viewId, binding: binding)
            }
        }

        define("setAnimatedEvent") { [unowned self] arguments in
            let (viewId, event) = (int(arguments[0]), string(arguments[1]))
            let mapping = (arguments[2] as? [String: Any])?.compactMapValues { ($0 as? NSNumber)?.intValue }
            enqueue { [unowned self] in setAnimatedEvent(event, mapping: mapping, onNodeId: viewId) }
        }
    }

    private func setAnimatedEvent(_ event: String, mapping: [String: Int]?, onNodeId id: Int) {
        guard let node = nodesById[id] else { return }

        guard let scrollView = node.view as? VueScrollView, event == "scroll" else {
            return gestureReporter(forNodeId: id).setAnimatedMapping(event, mapping)
        }

        scrollView.onOffsetChange = mapping.map { mapping in
            { [unowned self] offset in
                if let nodeId = mapping["x"] { animatedGraph.setValue(Double(offset.x), ofNode: nodeId) }
                if let nodeId = mapping["y"] { animatedGraph.setValue(Double(offset.y), ofNode: nodeId) }
            }
        }
    }

    private func gestureReporter(forNodeId id: Int) -> GestureReporter {
        if let reporter = gestureReportersByNodeId[id] { return reporter }

        let reporter = GestureReporter(
            report: { [unowned self] event, payload in dispatchEvent(event, toNodeId: id, payload: payload) },
            setAnimatedValue: { [unowned self] nodeId, value in animatedGraph.setValue(value, ofNode: nodeId) }
        )
        gestureReportersByNodeId[id] = reporter

        return reporter
    }

    private func dispatchEvent(_ eventName: String, toNodeId id: Int, payload: Any? = nil) {
        evaluate { [unowned self] in
            let arguments: [Any] = [id, eventName, payload ?? NSNull()]
            runtime?.call("__dispatch", arguments: arguments)
        }
    }

    private func setText(_ text: String, onNodeId id: Int) {
        guard let node = nodesById[id] else { return }

        (node.view as? UILabel)?.text = text
        node.markContentChanged()
    }

    private func setProp(_ key: String, value: Any?, onNodeId id: Int) {
        guard let node = nodesById[id] else { return }

        if key != "style", let pluginView = node.view as? PluginView {
            pluginView.setProp(key, value: value is NSNull ? nil : value)
            return
        }

        switch key {
        case "title":
            (node.view as? UIButton)?.setTitle(value as? String, for: .normal)
            screenController(id)?.navigationItem.title = value as? String
            node.markContentChanged()

        case "stackPresentation":
            screenController(id)?.stackPresentation = value as? String ?? "push"

        case "headerShown":
            screenController(id)?.headerShown = isTruthyAttribute(value)

        case "headerLargeTitle":
            screenController(id)?.navigationItem.largeTitleDisplayMode = isTruthyAttribute(value) ? .always : .never

        case "headerBackTitle":
            screenController(id)?.headerBackTitle = value as? String

        case "headerTintColor":
            screenController(id)?.headerTintColor = UIColor(rgba: value as Any)

        case "tabBarItem":
            let item = value as? [String: Any] ?? [:]
            screenController(id)?.setTabBarItem(
                label: item["label"] as? String,
                image: SvgView.iconImage(item),
                badge: (item["badge"] as? CustomStringConvertible)?.description
            )

        case "activeTintColor":
            (node.view as? TabBarView)?.tabBar.tintColor = UIColor(rgba: value as Any)

        case "inactiveTintColor":
            (node.view as? TabBarView)?.setInactiveTintColor(UIColor(rgba: value as Any))

        case "barBackgroundColor":
            (node.view as? TabBarView)?.setBarBackgroundColor(UIColor(rgba: value as Any))

        case "selectedIndex":
            (node.view as? TabBarView)?.select(index: value as? Int ?? 0)

        case "headerRightItems":
            screenController(id)?.setHeaderItems(value, side: "right")

        case "headerLeftItems":
            screenController(id)?.setHeaderItems(value, side: "left")

        case "style":
            node.applyStyle(value as? [String: Any] ?? [:])

        case "horizontal":
            setScrollDirection(of: node, horizontal: isTruthyAttribute(value))

        case "pagingEnabled":
            (node.view as? UIScrollView)?.isPagingEnabled = isTruthyAttribute(value)

        case "showsHorizontalScrollIndicator":
            (node.view as? UIScrollView)?.showsHorizontalScrollIndicator = isTruthyAttribute(value)

        case "showsVerticalScrollIndicator":
            (node.view as? UIScrollView)?.showsVerticalScrollIndicator = isTruthyAttribute(value)

        case "automaticallyAdjustKeyboardInsets":
            (node.view as? VueScrollView)?.adjustsForKeyboard = isTruthyAttribute(value)

        case "value":
            (node.view as? TextInputView)?.setTextFromJavaScript(value as? String ?? "")
            (node.view as? UISwitch)?.setOn(isTruthyAttribute(value), animated: true)

        case "disabled":
            (node.view as? UIControl)?.isEnabled = !isTruthyAttribute(value)

        case "animating":
            guard let indicator = node.view as? UIActivityIndicatorView else { break }
            if isTruthyAttribute(value) { indicator.startAnimating() } else { indicator.stopAnimating() }

        case "size":
            (node.view as? UIActivityIndicatorView)?.style = value as? String == "large" ? .large : .medium
            node.markContentChanged()

        case "color":
            (node.view as? UIActivityIndicatorView)?.color = UIColor(rgba: value as Any)
            (node.view as? SvgView)?.color = UIColor(rgba: value as Any) ?? .black

        case "viewBox":
            if let viewBox = SvgView.rect(fromViewBox: value) { (node.view as? SvgView)?.viewBox = viewBox }

        case "elements":
            (node.view as? SvgView)?.elements = value as? [[Any]] ?? []

        case "strokeWidth":
            (node.view as? SvgView)?.strokeWidth = CGFloat((value as? NSNumber)?.doubleValue ?? 2)

        case "visible":
            modalController(id)?.setVisible(isTruthyAttribute(value))

        case "animationType":
            modalController(id)?.animationType = value as? String ?? "none"

        case "presentationStyle":
            modalController(id)?.presentationStyleName = value as? String ?? "fullScreen"

        case "transparent":
            modalController(id)?.transparent = isTruthyAttribute(value)

        case "placeholder":
            (node.view as? TextInputView)?.placeholder = value as? String

        case "secureTextEntry":
            (node.view as? TextInputView)?.isSecureTextEntry = isTruthyAttribute(value)

        case "keyboardType":
            (node.view as? TextInputView)?.keyboardType = TextInputView.keyboardTypes[value as? String ?? ""] ?? .default

        case "keyboardDismissMode":
            (node.view as? VueScrollView)?.keyboardDismissMode = VueScrollView.keyboardDismissModes[value as? String ?? ""] ?? .none

        case "contentInsetAdjustmentBehavior":
            (node.view as? VueScrollView)?.contentInsetAdjustmentBehavior =
                VueScrollView.contentInsetAdjustmentBehaviors[value as? String ?? ""] ?? .never

        case "keyboardShouldPersistTaps":
            (node.view as? VueScrollView)?.dismissesKeyboardOnTap = (value as? String ?? "never") == "never"

        case "source":
            (node.view as? ImageView)?.load(value as? String)

        case "resizeMode":
            node.view.contentMode = ImageView.resizeModes[value as? String ?? ""] ?? .scaleAspectFill

        case "onScroll":
            (node.view as? VueScrollView)?.onScroll = isTruthyAttribute(value) ? reportScroll(toNodeId: id) : nil

        case "onRefresh":
            (node.view as? VueScrollView)?.onRefresh = isTruthyAttribute(value) ? { [unowned self] in
                dispatchEvent("refresh", toNodeId: id)
            } : nil

        case "refreshing":
            (node.view as? VueScrollView)?.setRefreshing(isTruthyAttribute(value))

        case "onPan", "onPinch", "onRotate":
            let event = key.dropFirst(2).lowercased()
            gestureReporter(forNodeId: id).setReporting(event, isTruthyAttribute(value), on: node.view)

        case "onLongPress":
            (node.view as? PressableView)?.reportsLongPress = isTruthyAttribute(value)

        default:
            break // event props (onPress...): the handler lives in JS
        }
    }

    private func reportScroll(toNodeId id: Int) -> (CGRect) -> Void {
        { [unowned self] bounds in
            let payload = ["x": bounds.minX, "y": bounds.minY, "width": bounds.width, "height": bounds.height]
            dispatchEvent("scroll", toNodeId: id, payload: payload)
        }
    }

    private func setScrollDirection(of node: NativeNode, horizontal: Bool) {
        guard let scrollView = node.view as? UIScrollView else { return }

        YGNodeStyleSetFlexDirection(node.yogaNode, horizontal ? .row : .column)
        scrollView.alwaysBounceHorizontal = horizontal
        scrollView.alwaysBounceVertical = !horizontal
    }

    /// `<ScrollView horizontal>` arrives as an empty string, `:horizontal="true"` as a boolean.
    private func isTruthyAttribute(_ value: Any?) -> Bool {
        if let flag = value as? Bool { return flag }
        if let text = value as? String { return text != "false" }

        return false
    }
}

// JS numbers arrive as NSNumber doubles; a missing or mistyped argument reads as 0 or "".

private func int(_ argument: Any) -> Int {
    (argument as? NSNumber)?.intValue ?? 0
}

private func double(_ argument: Any) -> Double {
    (argument as? NSNumber)?.doubleValue ?? 0
}

private func string(_ argument: Any) -> String {
    argument as? String ?? ""
}
