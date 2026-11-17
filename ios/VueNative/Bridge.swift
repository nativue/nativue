import UIKit
import JavaScriptCore

/// Receives the operations sent by the Vue renderer (src/renderer.js) and applies them to UIKit.
final class Bridge {
    static let devServerURL = URL(string: "http://localhost:42883")!

    var context: JSContext!
    var rootView: UIView!
    // ponytail: children of a removed view stay in the dictionary; clean up recursively if memory leaks.
    var viewsById: [Int: UIView] = [:]

    func start(rootView: UIView) {
        self.rootView = rootView

        let bundleURL = Bundle.main.url(forResource: "main.bundle", withExtension: "js")!
        run(try! String(contentsOf: bundleURL, encoding: .utf8))

        #if DEBUG
        Task { await listenForReload() }
        #endif
    }

    /// Discards the current view tree and JSContext, then runs the bundle from scratch.
    func run(_ source: String) {
        rootView.subviews.forEach { $0.removeFromSuperview() }
        viewsById = [0: rootView]

        context = makeContext()
        context.evaluateScript(source, withSourceURL: URL(string: "main.bundle.js"))
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
            viewsById[id] = makeView(type: type, id: id)
        } as @convention(block) (Int, String) -> Void)

        define("insert", { [unowned self] parentId, childId, index in
            insertView(childId: childId, parentId: parentId, at: index)
        } as @convention(block) (Int, Int, Int) -> Void)

        define("remove", { [unowned self] id in
            viewsById.removeValue(forKey: id)?.removeFromSuperview()
        } as @convention(block) (Int) -> Void)

        define("setText", { [unowned self] id, text in
            (viewsById[id] as? UILabel)?.text = text
        } as @convention(block) (Int, String) -> Void)

        define("setProp", { [unowned self] id, key, value in
            guard let view = viewsById[id] else { return }
            setProp(on: view, key: key, value: value)
        } as @convention(block) (Int, String, JSValue) -> Void)

        context.setObject(nativeModule, forKeyedSubscript: "__native" as NSString)
        context.evaluateScript("""
            var console = { log: (...args) => __native.log(args.map(String).join(' ')) }
            console.warn = console.error = console.info = console.log
            """)

        return context
    }

    func insertView(childId: Int, parentId: Int, at index: Int) {
        guard let parent = viewsById[parentId], let child = viewsById[childId] else { return }

        child.removeFromSuperview()

        if let stackView = parent as? UIStackView {
            stackView.insertArrangedSubview(child, at: min(index, stackView.arrangedSubviews.count))
        } else {
            parent.insertSubview(child, at: index)
        }
    }

    func makeView(type: String, id: Int) -> UIView {
        switch type {
        case "View":
            let stackView = UIStackView()
            stackView.axis = .vertical
            return stackView

        case "Text":
            let label = UILabel()
            label.numberOfLines = 0
            return label

        case "Button":
            let button = UIButton(type: .system)
            button.addAction(UIAction { [unowned self] _ in dispatchEvent("press", toNodeId: id) }, for: .touchUpInside)
            return button

        default:
            return UIView()
        }
    }

    func dispatchEvent(_ eventName: String, toNodeId id: Int) {
        context.objectForKeyedSubscript("__dispatch").call(withArguments: [id, eventName])
    }

    func setProp(on view: UIView, key: String, value: JSValue) {
        switch key {
        case "title": (view as? UIButton)?.setTitle(value.toString(), for: .normal)
        case "style": applyStyle(value.toDictionary() as? [String: Any] ?? [:], to: view)
        default: break // event props (onPress...): the handler lives in JS
        }
    }

    // ponytail: a subset of styles on top of UIStackView; switch to Yoga when real flexbox is needed.
    func applyStyle(_ style: [String: Any], to view: UIView) {
        for (property, value) in style {
            let number = (value as? NSNumber).map { CGFloat(truncating: $0) } ?? 0

            switch (property, view) {
            case ("backgroundColor", _):
                view.backgroundColor = color(fromHex: value)
            case ("borderRadius", _):
                view.layer.cornerRadius = number
            case ("padding", let stackView as UIStackView):
                stackView.isLayoutMarginsRelativeArrangement = true
                stackView.directionalLayoutMargins = .init(top: number, leading: number, bottom: number, trailing: number)
            case ("gap", let stackView as UIStackView):
                stackView.spacing = number
            case ("flexDirection", let stackView as UIStackView):
                stackView.axis = (value as? String) == "row" ? .horizontal : .vertical
            case ("fontSize", let label as UILabel):
                label.font = .systemFont(ofSize: number)
            case ("color", let label as UILabel):
                label.textColor = color(fromHex: value)
            default:
                break
            }
        }
    }

    func color(fromHex value: Any) -> UIColor? {
        guard let hexString = value as? String, hexString.hasPrefix("#") else { return nil }

        let digits = hexString.dropFirst()
        guard digits.count == 6, let rgb = Int(digits, radix: 16) else { return nil }

        let red = CGFloat(rgb >> 16 & 0xFF) / 255
        let green = CGFloat(rgb >> 8 & 0xFF) / 255
        let blue = CGFloat(rgb & 0xFF) / 255

        return UIColor(red: red, green: green, blue: blue, alpha: 1)
    }
}
