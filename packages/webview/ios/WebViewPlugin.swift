import Nativue
import UIKit

/// <WebView> (src/index.ts), and the commands its methods send, to the view whose component gave it that id.
public final class WebViewPlugin: NativuePlugin {
    /// On the main thread.
    private let webViewsById = NSMapTable<NSNumber, NativueWebView>.strongToWeakObjects()

    public init() {}

    public func register(in registry: PluginRegistry) {
        registry.addView("WebView") { [unowned self] sendEvent in
            NativueWebView(sendEvent: sendEvent) { [unowned self] id, webView in
                webViewsById.setObject(webView, forKey: id as NSNumber)
            }
        }

        addCommand("webView.goBack", in: registry) { _ = $0.goBack() }
        addCommand("webView.goForward", in: registry) { _ = $0.goForward() }
        addCommand("webView.reload", in: registry) { _ = $0.reload() }
        addCommand("webView.stopLoading", in: registry) { $0.stopLoading() }

        registry.addAsyncFunction("webView.evaluate") { [unowned self] arguments in
            let webView = try await webView(arguments[0])

            return try await webView.evaluate(arguments[1] as! String)
        }
    }

    private func addCommand(_ name: String, in registry: PluginRegistry, _ command: @escaping @MainActor (NativueWebView) -> Void) {
        registry.addAsyncFunction(name) { [unowned self] arguments in
            let webView = try await webView(arguments[0])

            await MainActor.run { command(webView) }

            return nil
        }
    }

    @MainActor
    private func webView(_ id: Any) throws -> NativueWebView {
        guard let webView = webViewsById.object(forKey: (id as! NSNumber)) else {
            throw PluginError(code: "ERR_UNAVAILABLE", message: "That WebView isn't on screen")
        }

        return webView
    }
}
