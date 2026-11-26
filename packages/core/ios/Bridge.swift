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

    // Limitation: GCD threads have a 512 KB stack; move to a Thread with a bigger stack if deep trees hit
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
    /// AppState.current: "active" or "background". Set on the main thread in start(), before the bundle
    /// runs; then only on the JS queue.
    private var appState = "active"
    /// Kept on the JS queue, for AccessibilityInfo.
    private var accessibilityStatus = AccessibilityStatus()
    /// Kept on the JS queue: the router's screens, reopened after a reload in development.
    private var savedNavigation: String?

    // Only touched on the main thread.
    var rootView: RootView!
    private var gestureReportersByNodeId: [Int: GestureReporter] = [:]
    private let animatedGraph = AnimatedGraph()
    var nodesById: [Int: NativeNode] = [:]
    /// Views with @layout, and the box they last reported.
    private var reportedLayoutsByNodeId: [Int: CGRect] = [:]
    private let blobStore = BlobStore.shared
    private lazy var networking = Networking(blobStore: blobStore)
    /// Modals and screens: their content is laid out as a separate Yoga root.
    private var contentRootsByNodeId: [Int: ContentRoot] = [:]
    /// For Dimensions.get('window'): the screen's at start, then the root view's, kept on the JS queue.
    private var windowSize: CGSize = .zero
    /// The bundle running now, for the error overlay's Reload.
    private var bundle = Data()
    private let errorOverlay = ErrorOverlay()
    #if DEBUG
    private let downloadBanner = DownloadBanner()
    #endif
    private let pluginRegistry: PluginRegistry

    init(plugins: [NativuePlugin]) {
        pluginRegistry = PluginRegistry(plugins: plugins)
    }

    func start(rootView: RootView) {
        self.rootView = rootView
        rootView.onLayoutSubviews = { [unowned self] in layout() }
        NativeNode.onLayoutCalculated = { [unowned self] in reportLayoutChanges() }
        NativeNode.isDrivenByAnimated = { [unowned self] view in animatedGraph.drives(view) }
        networking.onEvent = { [unowned self] owner, requestId, eventName, payload in
            sendNetworkEvent(owner: owner, requestId: requestId, eventName: eventName, payload: payload)
        }
        let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene
        windowSize = windowScene?.screen.bounds.size ?? .zero
        colorScheme = Self.colorScheme(of: windowScene?.traitCollection ?? rootView.traitCollection)
        rootView.onTraitCollectionChange = { [unowned self, unowned rootView] previous in
            let traits = rootView.traitCollection
            if traits.userInterfaceStyle != previous?.userInterfaceStyle {
                colorSchemeDidChange(to: Self.colorScheme(of: traits))
            }
            if traits.preferredContentSizeCategory != previous?.preferredContentSizeCategory {
                nodesById.values.forEach { $0.updateFont() }
                rootView.setNeedsLayout()
            }
        }

        for name in AccessibilityStatus.changeNotifications {
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [unowned self] _ in
                let nextStatus = AccessibilityStatus()
                evaluate { [unowned self] in accessibilityStatus = nextStatus }
            }
        }

        pluginRegistry.sendToJavaScript = { [unowned self] eventName, payload in
            sendNativeEvent(eventName, payload)
        }
        // A background launch (a push) starts in the background.
        let isInBackground = UIApplication.shared.applicationState == .background

        appState = isInBackground ? "background" : "active"
        let appStates = [
            UIApplication.didBecomeActiveNotification: "active",
            UIApplication.didEnterBackgroundNotification: "background",
        ]
        for (name, nextAppState) in appStates {
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [unowned self] _ in
                appStateDidChange(to: nextAppState)
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
        rootView.onReloadShortcut = { [unowned self] in Task { try? await reload() } }
        #endif
    }

    /// Discards the current node tree and runtime, then runs the bundle from scratch: JavaScript, or
    /// Hermes bytecode (production builds).
    func run(_ bundle: Data) {
        // UIKit ignores a dismissal while a modal is presenting or dismissing, so resetNodeTree would leave
        // the old tree's modal up, and the new tree's couldn't present.
        if let transition = modalTransitionInProgress() {
            transition.animate(alongsideTransition: nil) { [unowned self] _ in run(bundle) }
            return
        }

        self.bundle = bundle
        errorOverlay.hide()

        evaluate { [unowned self] in
            enqueue { [unowned self] in resetNodeTree() }

            runtime = makeRuntime()
            runtime?.evaluate(bundle, sourceURL: "main.bundle.js")
        }
    }

    private func modalTransitionInProgress() -> UIViewControllerTransitionCoordinator? {
        guard let presentedViewController = rootView.window?.rootViewController?.presentedViewController else {
            return nil
        }

        return sequence(first: presentedViewController, next: \.presentedViewController)
            .compactMap(\.transitionCoordinator)
            .last
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
        windowSizeDidChange(to: rootView.bounds.size)

        for contentRoot in contentRootsByNodeId.values {
            (contentRoot as? ModalController)?.dismissIfDetached()
            contentRoot.layoutContent()
        }
    }

    /// Results reaching a runtime that has since been reloaded are dropped: call ids start over in the new one.
    private func finishAsyncFunction(_ callId: Int, owner: JavaScriptRuntime?, value: Any?, error: Error?) {
        evaluate { [unowned self] in
            guard runtime === owner else { return }

            let errorCode = (error as? PluginError)?.code
            let arguments: [Any] = [
                callId, value ?? NSNull(), error?.localizedDescription ?? NSNull(), errorCode ?? NSNull(),
            ]

            runtime?.call("__asyncFunctionFinished", arguments: arguments)
        }
    }

    /// For addNativeListener; dropped while no runtime runs.
    private func sendNativeEvent(_ eventName: String, _ payload: Any?) {
        evaluate { [unowned self] in
            runtime?.call("__nativeEvent", arguments: [eventName, payload ?? NSNull()])
        }
    }

    private func appStateDidChange(to nextAppState: String) {
        evaluate { [unowned self] in
            guard nextAppState != appState else { return }

            appState = nextAppState
            runtime?.call("__nativeEvent", arguments: ["app.state", nextAppState])
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

    /// Rotation and split view resize the root view.
    private func windowSizeDidChange(to nextWindowSize: CGSize) {
        guard nextWindowSize != .zero else { return }

        evaluate { [unowned self] in
            guard nextWindowSize != windowSize else { return }

            windowSize = nextWindowSize
            runtime?.call("__windowSizeChanged", arguments: [["width": windowSize.width, "height": windowSize.height]])
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
        if rootView.window == nil { rootView.layoutIfNeeded() }
    }

    #if DEBUG
    @MainActor func listenForReload() async {
        let eventsURL = Self.devServerURL.appendingPathComponent("events")

        while true {
            do {
                let (events, _) = try await URLSession.shared.bytes(from: eventsURL)

                for try await line in events.lines {
                    if line == "data: reload" {
                        try await reload()
                    } else if line.hasPrefix("data: hot ") {
                        let update = String(line.dropFirst("data: hot ".count))
                        evaluate { [unowned self] in runtime?.call("__hotUpdate", arguments: [update]) }
                    }
                }
            } catch {}

            try? await Task.sleep(nanoseconds: 2_000_000_000) // dev server is down: retry
        }
    }

    @MainActor func reload() async throws {
        let data = try await download(Self.devServerURL.appendingPathComponent("bundle.js"))
        print("[Nativue] reload")
        run(data)
    }

    @MainActor private func download(_ url: URL) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            var observation: NSKeyValueObservation?
            let task = URLSession.shared.dataTask(with: url) { [unowned self] data, _, error in
                DispatchQueue.main.async {
                    observation?.invalidate()
                    self.downloadBanner.hide()
                    if let data { continuation.resume(returning: data) } else { continuation.resume(throwing: error!) }
                }
            }
            observation = task.observe(\.countOfBytesReceived) { [unowned self] task, _ in
                let progress = Double(task.countOfBytesReceived) / Double(max(task.countOfBytesExpectedToReceive, 1))
                DispatchQueue.main.async { self.downloadBanner.show(progress: progress) }
            }
            downloadBanner.show(progress: 0)
            task.resume()
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

        defineGetter("windowSize") { [unowned self] _ in
            ["width": windowSize.width, "height": windowSize.height]
        }

        defineGetter("platform") { _ in "ios" }

        defineGetter("accessibilityInfo") { [unowned self] _ in accessibilityStatus.dictionary }

        define("announce") { arguments in
            let message = string(arguments[0])
            DispatchQueue.main.async { UIAccessibility.post(notification: .announcement, argument: message) }
        }

        defineGetter("openSettings") { _ in
            DispatchQueue.main.async {
                UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!)
            }

            return true
        }

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
                        finishAsyncFunction(callId, owner: owner, value: value, error: nil)
                    } catch {
                        finishAsyncFunction(callId, owner: owner, value: nil, error: error)
                    }
                }
            }
        }

        defineGetter("colorScheme") { [unowned self] _ in colorScheme }
        defineGetter("appState") { [unowned self] _ in appState }
        defineGetter("savedNavigation") { [unowned self] _ in savedNavigation }
        define("saveNavigation") { [unowned self] arguments in savedNavigation = arguments[0] as? String }

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
            let subtreeIds = (arguments[1] as? [Any] ?? []).map(int)
            enqueue { [unowned self] in removeNode(id: id, subtreeIds: subtreeIds) }
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
        defineNetworking(define)
        defineBlobFunctions(define, defineGetter)

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
        var request = URLRequest(url: Self.devServerURL.appendingPathComponent("symbolicate"), timeoutInterval: 2)
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
        networking.abortAll() // and so do request ids
        blobStore.removeAll() // and the Blobs that held them are gone
        reportedLayoutsByNodeId = [:]
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
    private func removeNode(id: Int, subtreeIds: [Int]) {
        guard let node = nodesById[id] else { return }

        if let screen = screenController(id) {
            screen.container?.removeScreen(screen)
        } else {
            node.removeFromParent()
        }
        subtreeIds.forEach(forgetNode)
    }

    /// Its view left the tree: what refers to it by id goes too, and a modal or sheet inside closes.
    private func forgetNode(id: Int) {
        let node = nodesById.removeValue(forKey: id)
        (node?.view as? ScreenStackView)?.dismissPresentedScreens()
        modalController(id)?.dismissIfDetached()
        contentRootsByNodeId[id] = nil
        gestureReportersByNodeId[id] = nil
        reportedLayoutsByNodeId[id] = nil
    }

    /// @layout fires for the views whose box changed: { x, y, width, height }, in points, in its parent.
    /// All of a layout pass's changes go in one call, so JS re-renders once for them, not once per view.
    private func reportLayoutChanges() {
        var changedLayouts: [[String: Any]] = []

        for (id, reportedLayout) in reportedLayoutsByNodeId {
            guard let yogaNode = nodesById[id]?.yogaNode else { continue }

            let layout = CGRect(
                x: CGFloat(YGNodeLayoutGetLeft(yogaNode)),
                y: CGFloat(YGNodeLayoutGetTop(yogaNode)),
                width: CGFloat(YGNodeLayoutGetWidth(yogaNode)),
                height: CGFloat(YGNodeLayoutGetHeight(yogaNode))
            )
            guard !layout.width.isNaN, layout != reportedLayout else { continue }

            reportedLayoutsByNodeId[id] = layout
            changedLayouts.append(["id": id, "x": layout.minX, "y": layout.minY, "width": layout.width, "height": layout.height])
        }
        guard !changedLayouts.isEmpty else { return }

        evaluate { [unowned self] in runtime?.call("__layoutsChanged", arguments: [changedLayouts]) }
    }

    private func modalController(_ id: Int) -> ModalController? {
        contentRootsByNodeId[id] as? ModalController
    }

    private func screenController(_ id: Int) -> ScreenController? {
        contentRootsByNodeId[id] as? ScreenController
    }

    /// Text views start at the platform's size, scaled to the system's text size like styled ones.
    private func makeNode(type: String, id: Int) -> NativeNode {
        let node = makeUnstyledNode(type: type, id: id)
        if let button = node.view as? UIButton, let systemFont = button.titleLabel?.font {
            node.defaultFontSize = systemFont.pointSize
            node.fontSize = systemFont.pointSize
        }
        node.updateFont()

        return node
    }

    private func makeUnstyledNode(type: String, id: Int) -> NativeNode {
        switch type {
        case "Text":
            let label = TextLabel()
            label.numberOfLines = 0
            return NativeNode(view: label, measuresContent: true)

        case "Button":
            let button = UIButton(type: .system)
            button.addAction(UIAction { [unowned self] _ in dispatchEvent("press", toNodeId: id) }, for: .touchUpInside)
            return NativeNode(view: button, measuresContent: true)

        case "ScrollView":
            return NativeNode(view: VueScrollView(), measuresContent: false)

        case "Image":
            let imageView = ImageView(frame: .zero)
            let node = NativeNode(view: imageView, measuresContent: true)
            imageView.onImageChange = { [unowned self, weak node] in
                node?.markContentChanged()
                rootView.setNeedsLayout()
            }
            return node

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

    /// XMLHttpRequest's native side (Networking); fetch is built on it in JS.
    private func defineNetworking(_ define: Define) {
        define("sendRequest") { [unowned self] arguments in
            let query = arguments[1] as? [String: Any] ?? [:]
            networking.send(requestId: int(arguments[0]), query: query, owner: runtime)
        }

        define("abortRequest") { [unowned self] arguments in
            networking.abort(requestId: int(arguments[0]))
        }
    }

    /// The bytes behind JS's Blobs (BlobStore). blobRelease is also what the runtime calls when a Blob is
    /// garbage collected.
    private func defineBlobFunctions(_ define: Define, _ defineGetter: DefineGetter) {
        // nil when a part's blob has been released.
        defineGetter("blobCreate") { [unowned self] arguments in
            guard let blob = try? blobStore.create(parts: arguments[0] as? [[String: Any]] ?? []) else { return nil }

            return ["blobId": blob.blobId, "size": blob.size]
        }

        defineGetter("blobRead") { [unowned self] arguments in
            let blob = ["blobId": arguments[0], "offset": arguments[1], "size": arguments[2]]
            guard let data = blobStore.data(of: blob) else { return nil }

            switch string(arguments[3]) {
            case "bytes": return data
            case "base64": return data.base64EncodedString()
            default: return String(decoding: data, as: UTF8.self)
            }
        }

        // Not through self: the runtime may collect Blobs as it's destroyed, with the Bridge.
        define("blobRelease") { [blobStore] arguments in
            blobStore.remove(blobId: arguments[0] as? String ?? "")
        }
    }

    /// Like finishAsyncFunction, dropped if the runtime that asked has since been reloaded.
    private func sendNetworkEvent(owner: AnyObject?, requestId: Int, eventName: String, payload: [String: Any]) {
        evaluate { [unowned self] in
            guard runtime === owner else { return }
            runtime?.call("__networkEvent", arguments: [requestId, eventName, payload])
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
        if node.textDecorationLine != "none" { node.updateTextDecoration() }
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

        case "scrollEventThrottle":
            (node.view as? VueScrollView)?.scrollEventThrottle = (value as? NSNumber)?.doubleValue ?? 0

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

        case "accessibility":
            node.applyAccessibility(value as? [String: Any] ?? [:])

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

        case "cache":
            (node.view as? ImageView)?.cachePolicy = value as? String ?? "disk"

        case "resizeMode":
            node.view.contentMode = ImageView.resizeModes[value as? String ?? ""] ?? .scaleAspectFill

        case "onLayout":
            // A new handler on every render re-registers: only a first one waits for a report.
            if !isTruthyAttribute(value) { reportedLayoutsByNodeId[id] = nil }
            else if reportedLayoutsByNodeId[id] == nil { reportedLayoutsByNodeId[id] = .null }

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
