import UIKit
import JavaScriptCore

/// Receives the operations sent by the Vue renderer (src/renderer.js) and applies them to UIKit + Yoga.
final class Bridge {
    static let devServerURL = URL(string: "http://localhost:42883")!

    var context: JSContext!
    var rootView: RootView!
    // ponytail: children of a removed node stay in the dictionary; clean up recursively if memory leaks.
    var nodesById: [Int: NativeNode] = [:]

    func start(rootView: RootView) {
        self.rootView = rootView
        rootView.onLayoutSubviews = { [unowned self] in layout() }

        let bundleURL = Bundle.main.url(forResource: "main.bundle", withExtension: "js")!
        run(try! String(contentsOf: bundleURL, encoding: .utf8))

        #if DEBUG
        Task { await listenForReload() }
        #endif
    }

    /// Discards the current node tree and JSContext, then runs the bundle from scratch.
    func run(_ source: String) {
        rootView.subviews.forEach { $0.removeFromSuperview() }
        nodesById = [0: NativeNode(view: rootView, measuresContent: false)]

        context = makeContext()
        context.evaluateScript(source, withSourceURL: URL(string: "main.bundle.js"))
    }

    func layout() {
        nodesById[0]?.calculateLayout(width: rootView.bounds.width, height: rootView.bounds.height)
    }

    /// UIKit coalesces these requests, so the layout pass runs once after a burst of JS mutations.
    func requestLayout() {
        rootView.setNeedsLayout()
    }

    #if DEBUG
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

    func makeContext() -> JSContext {
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
            nodesById[id] = makeNode(type: type, id: id)
        } as @convention(block) (Int, String) -> Void)

        define("insert", { [unowned self] parentId, childId, index in
            insertNode(childId: childId, parentId: parentId, at: index)
        } as @convention(block) (Int, Int, Int) -> Void)

        define("remove", { [unowned self] id in
            nodesById.removeValue(forKey: id)?.removeFromParent()
            requestLayout()
        } as @convention(block) (Int) -> Void)

        define("setText", { [unowned self] id, text in
            guard let node = nodesById[id] else { return }

            (node.view as? UILabel)?.text = text
            node.markContentChanged()
            requestLayout()
        } as @convention(block) (Int, String) -> Void)

        define("setProp", { [unowned self] id, key, value in
            guard let node = nodesById[id] else { return }

            setProp(on: node, key: key, value: value)
            requestLayout()
        } as @convention(block) (Int, String, JSValue) -> Void)

        context.setObject(nativeModule, forKeyedSubscript: "__native" as NSString)
        context.evaluateScript("""
            var console = { log: (...args) => __native.log(args.map(String).join(' ')) }
            console.warn = console.error = console.info = console.log
            """)

        return context
    }

    func insertNode(childId: Int, parentId: Int, at index: Int) {
        guard let parent = nodesById[parentId], let child = nodesById[childId] else { return }

        guard parent.canHaveChildren else {
            print("[VueNative] <\(type(of: parent.view))> can't have native children; use <View>")
            return
        }

        parent.insertChild(child, at: index)
        requestLayout()
    }

    func makeNode(type: String, id: Int) -> NativeNode {
        switch type {
        case "Text":
            let label = UILabel()
            label.numberOfLines = 0
            return NativeNode(view: label, measuresContent: true)

        case "Button":
            let button = UIButton(type: .system)
            button.addAction(UIAction { [unowned self] _ in dispatchEvent("press", toNodeId: id) }, for: .touchUpInside)
            return NativeNode(view: button, measuresContent: true)

        default:
            return NativeNode(view: UIView(), measuresContent: false)
        }
    }

    func dispatchEvent(_ eventName: String, toNodeId id: Int) {
        context.objectForKeyedSubscript("__dispatch").call(withArguments: [id, eventName])
    }

    func setProp(on node: NativeNode, key: String, value: JSValue) {
        switch key {
        case "title":
            (node.view as? UIButton)?.setTitle(value.toString(), for: .normal)
            node.markContentChanged()

        case "style":
            node.applyStyle(value.toDictionary() as? [String: Any] ?? [:])

        default:
            break // event props (onPress...): the handler lives in JS
        }
    }
}
