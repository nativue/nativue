import UIKit
import JavaScriptCore
import yoga

/// Runs the JS bundle off the main thread and applies the operations sent by the Vue renderer
/// (src/renderer.js) to UIKit + Yoga in batches on the main thread.
final class Bridge {
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

        return URL(string: "http://\(host):42883")!
    }()

    struct EvaluationTimings {
        let javaScript: Duration
        let apply: Duration
    }

    // ponytail: GCD threads have a 512 KB stack; move to a Thread with a bigger stack if deep trees hit
    // "RangeError: Maximum call stack size exceeded".
    private let javaScriptQueue = DispatchQueue(label: "dev.vuenative.javascript", qos: .userInteractive)

    // Only touched on javaScriptQueue.
    private(set) var context: JSContext!
    private var pendingOperations: [() -> Void] = []

    // Only touched on the main thread.
    var rootView: RootView!
    // ponytail: children of a removed node stay in the dictionary; clean up recursively if memory leaks.
    var nodesById: [Int: NativeNode] = [:]
    // ponytail: controllers of removed modals stay here; drop them on remove if many modals come and go.
    private var modalControllersByNodeId: [Int: ModalController] = [:]

    func start(rootView: RootView) {
        self.rootView = rootView
        rootView.onLayoutSubviews = { [unowned self] in layout() }

        let bundleURL = Bundle.main.url(forResource: "main.bundle", withExtension: "js")!
        let source = try! String(contentsOf: bundleURL, encoding: .utf8)

        #if DEBUG
        startBenchmarkOrDevelopment(source: source)
        #else
        run(source)
        #endif
    }

    /// Discards the current node tree and JSContext, then runs the bundle from scratch.
    func run(_ source: String, completion: ((EvaluationTimings) -> Void)? = nil) {
        evaluate({ [unowned self] in
            enqueue { [unowned self] in resetNodeTree() }

            context = makeContext()
            context.evaluateScript(source, withSourceURL: URL(string: "main.bundle.js"))
        }, completion: completion)
    }

    /// Runs `work` on the JS queue, then applies every native operation it produced, in one batch, on the
    /// main thread. JavaScriptCore drains microtasks when `work` returns, so Vue's updates are included.
    func evaluate(_ work: @escaping () -> Void, completion: ((EvaluationTimings) -> Void)? = nil) {
        javaScriptQueue.async { [unowned self] in
            let javaScriptDuration = ContinuousClock().measure(work)
            let operations = pendingOperations
            pendingOperations = []

            DispatchQueue.main.async { [unowned self] in
                let applyDuration = ContinuousClock().measure { operations.forEach { $0() } }
                requestLayout()
                completion?(EvaluationTimings(javaScript: javaScriptDuration, apply: applyDuration))
            }
        }
    }

    func layout() {
        nodesById[0]?.calculateLayout(width: rootView.bounds.width, height: rootView.bounds.height)

        for modalController in modalControllersByNodeId.values {
            modalController.dismissIfDetached()
            modalController.layoutContent()
        }
    }

    /// UIKit coalesces these requests, so the layout pass runs once per batch.
    func requestLayout() {
        rootView.setNeedsLayout()
    }

    #if DEBUG
    private func startBenchmarkOrDevelopment(source: String) {
        run(source) { [unowned self] _ in
            evaluate { [unowned self] in
                let isBenchmark = isBenchmarkBundle

                DispatchQueue.main.async { [unowned self] in
                    if isBenchmark {
                        runBenchmark(source: source)
                    } else {
                        Task { await listenForReload() }
                    }
                }
            }
        }
    }

    @MainActor func listenForReload() async {
        let eventsURL = Self.devServerURL.appending(path: "events")
        let bundleURL = Self.devServerURL.appending(path: "bundle.js")

        while true {
            do {
                let (events, _) = try await URLSession.shared.bytes(from: eventsURL)

                for try await line in events.lines where line == "data: reload" {
                    let (data, _) = try await URLSession.shared.data(from: bundleURL)
                    print("[VueNative] reload")
                    run(String(decoding: data, as: UTF8.self))
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

    private func makeContext() -> JSContext {
        let context = JSContext()!
        context.exceptionHandler = { _, exception in
            let message = exception?.toString() ?? ""
            let stack = exception?.objectForKeyedSubscript("stack")?.toString() ?? ""
            print("JS error:", message, stack)
        }

        let nativeModule = JSValue(newObjectIn: context)!
        func define(_ name: String, _ block: Any) {
            nativeModule.setObject(block, forKeyedSubscript: name as NSString)
        }

        define("log", { message in print("[JS]", message) } as @convention(block) (String) -> Void)

        define("create", { [unowned self] id, type in
            enqueue { [unowned self] in nodesById[id] = makeNode(type: type, id: id) }
        } as @convention(block) (Int, String) -> Void)

        define("insert", { [unowned self] parentId, childId, index in
            enqueue { [unowned self] in insertNode(childId: childId, parentId: parentId, at: index) }
        } as @convention(block) (Int, Int, Int) -> Void)

        define("remove", { [unowned self] id in
            enqueue { [unowned self] in nodesById.removeValue(forKey: id)?.removeFromParent() }
        } as @convention(block) (Int) -> Void)

        define("setText", { [unowned self] id, text in
            enqueue { [unowned self] in setText(text, onNodeId: id) }
        } as @convention(block) (Int, String) -> Void)

        define("setProp", { [unowned self] id, key, value in
            let convertedValue = value.toObject() // JSValue must not leave the JS queue
            enqueue { [unowned self] in setProp(key, value: convertedValue, onNodeId: id) }
        } as @convention(block) (Int, String, JSValue) -> Void)

        define("setTimer", { [unowned self, weak context] timerId, delayInMilliseconds in
            // Weak: after a hot reload, the old context's timers die with it instead of firing in the new
            // context, where timer ids start over.
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(delayInMilliseconds)) { [unowned self, weak context] in
                evaluate {
                    _ = context?.objectForKeyedSubscript("__fireTimer").call(withArguments: [timerId])
                }
            }
        } as @convention(block) (Int, Int) -> Void)

        define("dismissKeyboard", { [unowned self] in
            enqueue { [unowned self] in rootView.window?.endEditing(true) }
        } as @convention(block) () -> Void)

        context.setObject(nativeModule, forKeyedSubscript: "__native" as NSString)
        context.evaluateScript("""
            var console = { log: (...args) => __native.log(args.map(String).join(' ')) }
            console.warn = console.error = console.info = console.log

            // JavaScriptCore has no timers; native schedules them (like React Native's Timing module).
            // ponytail: no setInterval yet; chain setTimeout or add it when something needs it.
            var timerCallbacks = new Map()
            var nextTimerId = 1

            function setTimeout(callback, delay = 0, ...args) {
              const timerId = nextTimerId++
              timerCallbacks.set(timerId, () => callback(...args))
              __native.setTimer(timerId, Math.max(0, Math.round(delay)))

              return timerId
            }

            function clearTimeout(timerId) {
              timerCallbacks.delete(timerId)
            }

            function __fireTimer(timerId) {
              const callback = timerCallbacks.get(timerId)
              timerCallbacks.delete(timerId)
              callback?.()
            }
            """)

        return context
    }

    // MARK: - Main thread

    private func resetNodeTree() {
        rootView.subviews.forEach { $0.removeFromSuperview() }
        modalControllersByNodeId.values.forEach { $0.setVisible(false) }
        modalControllersByNodeId = [:]
        nodesById = [0: NativeNode(view: rootView, measuresContent: false)]
    }

    private func insertNode(childId: Int, parentId: Int, at index: Int) {
        guard let parent = nodesById[parentId], let child = nodesById[childId] else { return }

        guard parent.canHaveChildren else {
            print("[VueNative] <\(type(of: parent.view))> can't have native children; use <View>")
            return
        }

        (parent.contentNode ?? parent).insertChild(child, at: index)
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

        case "PressableView":
            let pressableView = PressableView()
            pressableView.onEvent = { [unowned self] eventName in dispatchEvent(eventName, toNodeId: id) }
            return NativeNode(view: pressableView, measuresContent: false)

        case "KeyboardAvoidingView":
            let keyboardAvoidingView = KeyboardAvoidingView()
            let node = NativeNode(view: keyboardAvoidingView, measuresContent: false)
            keyboardAvoidingView.onKeyboardOverlapChange = { [unowned self, unowned node] overlap in
                YGNodeStyleSetPadding(node.yogaNode, .bottom, Float(overlap))
                rootView.setNeedsLayout()
                rootView.layoutIfNeeded() // runs inside the keyboard animation, so frames animate with it
            }
            return node

        case "SafeAreaView":
            let safeAreaView = SafeAreaView()
            let node = NativeNode(view: safeAreaView, measuresContent: false)
            safeAreaView.onSafeAreaInsetsChange = { [unowned self, unowned node] in
                if node.applySafeAreaPadding() { requestLayout() }
            }
            return node

        case "TextInput":
            return NativeNode(view: makeTextInput(id: id), measuresContent: true)

        case "Switch":
            let toggle = UISwitch()
            toggle.addAction(UIAction { [unowned self, unowned toggle] _ in
                dispatchEvent("valuechange", toNodeId: id, payload: toggle.isOn)
            }, for: .valueChanged)
            return NativeNode(view: toggle, measuresContent: true)

        case "ActivityIndicator":
            let indicator = UIActivityIndicatorView(style: .medium)
            indicator.hidesWhenStopped = true
            indicator.startAnimating() // React Native's `animating` defaults to true
            return NativeNode(view: indicator, measuresContent: true)

        case "Modal":
            let modalController = ModalController()
            modalController.onEvent = { [unowned self] eventName in dispatchEvent(eventName, toNodeId: id) }
            modalControllersByNodeId[id] = modalController

            let node = NativeNode(view: modalController.placeholderView, measuresContent: false)
            YGNodeStyleSetDisplay(node.yogaNode, .none)
            node.contentNode = modalController.contentNode
            return node

        default:
            return NativeNode(view: UIView(), measuresContent: false)
        }
    }

    private func makeTextInput(id: Int) -> TextInputView {
        let textInput = TextInputView()

        textInput.addAction(UIAction { [unowned self, unowned textInput] _ in
            textInput.recordTextSentToJavaScript()
            dispatchEvent("changetext", toNodeId: id, payload: textInput.text ?? "")
        }, for: .editingChanged)

        // Listening to "did end on exit" also makes the return key close the keyboard (React Native's
        // default for single-line inputs).
        textInput.addAction(UIAction { [unowned self, unowned textInput] _ in
            dispatchEvent("submitediting", toNodeId: id, payload: textInput.text ?? "")
        }, for: .editingDidEndOnExit)

        textInput.addAction(UIAction { [unowned textInput] _ in
            textInput.endEditingSession()
        }, for: .editingDidEnd)

        return textInput
    }

    private func dispatchEvent(_ eventName: String, toNodeId id: Int, payload: Any? = nil) {
        evaluate { [unowned self] in
            let arguments: [Any] = [id, eventName, payload ?? NSNull()]
            context.objectForKeyedSubscript("__dispatch").call(withArguments: arguments)
        }
    }

    private func setText(_ text: String, onNodeId id: Int) {
        guard let node = nodesById[id] else { return }

        (node.view as? UILabel)?.text = text
        node.markContentChanged()
    }

    private func setProp(_ key: String, value: Any?, onNodeId id: Int) {
        guard let node = nodesById[id] else { return }

        switch key {
        case "title":
            (node.view as? UIButton)?.setTitle(value as? String, for: .normal)
            node.markContentChanged()

        case "style":
            node.applyStyle(value as? [String: Any] ?? [:])

        case "horizontal":
            setScrollDirection(of: node, horizontal: isTruthyAttribute(value))

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

        case "visible":
            modalControllersByNodeId[id]?.setVisible(isTruthyAttribute(value))

        case "animationType":
            modalControllersByNodeId[id]?.animationType = value as? String ?? "none"

        case "presentationStyle":
            modalControllersByNodeId[id]?.presentationStyleName = value as? String ?? "fullScreen"

        case "transparent":
            modalControllersByNodeId[id]?.transparent = isTruthyAttribute(value)

        case "placeholder":
            (node.view as? TextInputView)?.placeholder = value as? String

        case "secureTextEntry":
            (node.view as? TextInputView)?.isSecureTextEntry = isTruthyAttribute(value)

        case "keyboardType":
            (node.view as? TextInputView)?.keyboardType = TextInputView.keyboardTypes[value as? String ?? ""] ?? .default

        case "keyboardDismissMode":
            (node.view as? VueScrollView)?.keyboardDismissMode = VueScrollView.keyboardDismissModes[value as? String ?? ""] ?? .none

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
