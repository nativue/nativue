import UIKit
import JavaScriptCore

/// Recebe as operações do renderer Vue (src/renderer.js) e as aplica em UIKit.
final class Bridge {
    static let devServer = URL(string: "http://localhost:42883")!

    var ctx: JSContext!
    var root: UIView!
    // ponytail: filhos de uma view removida continuam no dicionário; limpar recursivamente se vazar memória.
    var views: [Int: UIView] = [:]

    func start(root: UIView) {
        self.root = root
        let url = Bundle.main.url(forResource: "main.bundle", withExtension: "js")!
        run(try! String(contentsOf: url, encoding: .utf8))
        #if DEBUG
        Task { await listenForReload() }
        #endif
    }

    /// Descarta a árvore e o JSContext atuais e roda o bundle do zero.
    func run(_ source: String) {
        root.subviews.forEach { $0.removeFromSuperview() }
        views = [0: root]
        ctx = makeContext()
        ctx.evaluateScript(source, withSourceURL: URL(string: "main.bundle.js"))
    }

    #if DEBUG
    // ponytail: localhost só alcança o Mac a partir do simulador; device físico precisa do IP do Mac.
    @MainActor func listenForReload() async {
        while true {
            do {
                let (events, _) = try await URLSession.shared.bytes(from: Self.devServer.appending(path: "events"))
                for try await line in events.lines where line == "data: reload" {
                    let (data, _) = try await URLSession.shared.data(from: Self.devServer.appending(path: "bundle.js"))
                    print("[VueNative] reload")
                    run(String(decoding: data, as: UTF8.self))
                }
            } catch {}
            try? await Task.sleep(for: .seconds(2)) // dev server fora do ar: tenta de novo
        }
    }
    #endif

    func makeContext() -> JSContext {
        let ctx = JSContext()!
        ctx.exceptionHandler = { _, e in
            print("JS error:", e?.toString() ?? "", e?.objectForKeyedSubscript("stack")?.toString() ?? "")
        }

        let native = JSValue(newObjectIn: ctx)!
        func def(_ name: String, _ block: Any) { native.setObject(block, forKeyedSubscript: name as NSString) }

        def("log", { print("[JS]", $0) } as @convention(block) (String) -> Void)
        def("create", { [unowned self] id, type in views[id] = make(type, id) } as @convention(block) (Int, String) -> Void)
        def("insert", { [unowned self] p, c, i in
            guard let parent = views[p], let child = views[c] else { return }
            child.removeFromSuperview()
            if let stack = parent as? UIStackView {
                stack.insertArrangedSubview(child, at: min(i, stack.arrangedSubviews.count))
            } else {
                parent.insertSubview(child, at: i)
            }
        } as @convention(block) (Int, Int, Int) -> Void)
        def("remove", { [unowned self] id in views.removeValue(forKey: id)?.removeFromSuperview() } as @convention(block) (Int) -> Void)
        def("setText", { [unowned self] id, text in (views[id] as? UILabel)?.text = text } as @convention(block) (Int, String) -> Void)
        def("setProp", { [unowned self] id, key, value in
            if let v = views[id] { setProp(v, key, value) }
        } as @convention(block) (Int, String, JSValue) -> Void)

        ctx.setObject(native, forKeyedSubscript: "__native" as NSString)
        ctx.evaluateScript("var console = { log: (...a) => __native.log(a.map(String).join(' ')) }; console.warn = console.error = console.info = console.log")
        return ctx
    }

    func make(_ type: String, _ id: Int) -> UIView {
        switch type {
        case "View":
            let s = UIStackView()
            s.axis = .vertical
            return s
        case "Text":
            let l = UILabel()
            l.numberOfLines = 0
            return l
        case "Button":
            let b = UIButton(type: .system)
            b.addAction(UIAction { [unowned self] _ in
                ctx.objectForKeyedSubscript("__dispatch").call(withArguments: [id, "press"])
            }, for: .touchUpInside)
            return b
        default:
            return UIView()
        }
    }

    func setProp(_ v: UIView, _ key: String, _ value: JSValue) {
        switch key {
        case "title": (v as? UIButton)?.setTitle(value.toString(), for: .normal)
        case "style": applyStyle(v, value.toDictionary() as? [String: Any] ?? [:])
        default: break // onPress etc.: o handler fica no JS
        }
    }

    // ponytail: subset de estilos sobre UIStackView; trocar por Yoga quando precisar de flexbox de verdade.
    func applyStyle(_ v: UIView, _ s: [String: Any]) {
        for (k, val) in s {
            let n = (val as? NSNumber).map { CGFloat(truncating: $0) } ?? 0
            switch (k, v) {
            case ("backgroundColor", _): v.backgroundColor = color(val)
            case ("borderRadius", _): v.layer.cornerRadius = n
            case ("padding", let st as UIStackView):
                st.isLayoutMarginsRelativeArrangement = true
                st.directionalLayoutMargins = .init(top: n, leading: n, bottom: n, trailing: n)
            case ("gap", let st as UIStackView): st.spacing = n
            case ("flexDirection", let st as UIStackView): st.axis = (val as? String) == "row" ? .horizontal : .vertical
            case ("fontSize", let l as UILabel): l.font = .systemFont(ofSize: n)
            case ("color", let l as UILabel): l.textColor = color(val)
            default: break
            }
        }
    }

    func color(_ val: Any) -> UIColor? {
        guard var hex = val as? String, hex.hasPrefix("#") else { return nil }
        hex.removeFirst()
        guard hex.count == 6, let rgb = Int(hex, radix: 16) else { return nil }
        return UIColor(red: CGFloat(rgb >> 16 & 0xFF) / 255, green: CGFloat(rgb >> 8 & 0xFF) / 255, blue: CGFloat(rgb & 0xFF) / 255, alpha: 1)
    }
}
