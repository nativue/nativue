import UIKit
import JavaScriptCore
import yoga

/// Runs the JS bundle off the main thread and applies the operations sent by the Vue renderer
/// (src/renderer.js) to UIKit + Yoga in batches on the main thread.
final class Bridge {
    static let devServerURL = URL(string: "http://localhost:42883")!

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

    // ponytail: localhost only reaches the Mac from the simulator; a physical device needs the Mac's IP.
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

        context.setObject(nativeModule, forKeyedSubscript: "__native" as NSString)
        context.evaluateScript("""
            var console = { log: (...args) => __native.log(args.map(String).join(' ')) }
            console.warn = console.error = console.info = console.log
            """)

        return context
    }

    // MARK: - Main thread

    private func resetNodeTree() {
        rootView.subviews.forEach { $0.removeFromSuperview() }
        nodesById = [0: NativeNode(view: rootView, measuresContent: false)]
    }

    private func insertNode(childId: Int, parentId: Int, at index: Int) {
        guard let parent = nodesById[parentId], let child = nodesById[childId] else { return }

        guard parent.canHaveChildren else {
            print("[VueNative] <\(type(of: parent.view))> can't have native children; use <View>")
            return
        }

        parent.insertChild(child, at: index)
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
            let scrollView = UIScrollView()
            scrollView.contentInsetAdjustmentBehavior = .never // the root view already sits in the safe area
            scrollView.alwaysBounceVertical = true
            return NativeNode(view: scrollView, measuresContent: false)

        default:
            return NativeNode(view: UIView(), measuresContent: false)
        }
    }

    private func dispatchEvent(_ eventName: String, toNodeId id: Int) {
        evaluate { [unowned self] in
            context.objectForKeyedSubscript("__dispatch").call(withArguments: [id, eventName])
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

        default:
            break // event props (onPress...): the handler lives in JS
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
