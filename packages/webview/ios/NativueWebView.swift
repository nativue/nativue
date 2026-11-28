import Nativue
import UIKit
import WebKit

/// A WKWebView taking <WebView>'s props. The page's window.nativueWebView.postMessage reaches @message.
final class NativueWebView: WKWebView, PluginView, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private static let messageHandlerName = "nativueWebView"
    private static let messageBridge = WKUserScript(
        source: """
        window.nativueWebView = {
          postMessage: (data) => window.webkit.messageHandlers.\(messageHandlerName).postMessage(String(data)),
        }
        """,
        injectionTime: .atDocumentStart,
        forMainFrameOnly: false
    )
    /// Loaded here; any other scheme (tel:, mailto:, another app's) opens in the app it belongs to.
    private static let schemesLoadedHere: Set<String> = ["http", "https", "about", "data", "blob", "file"]

    private let sendEvent: PluginRegistry.SendEvent
    private let register: (Int, NativueWebView) -> Void
    private var source = Source()
    private var loadedSource: Source?
    private var injectedJavaScript: String?
    private var injectedJavaScriptBeforeContentLoaded: String?
    private var javaScriptEnabled = true
    private var hasPendingChanges = false
    private var hasPendingNavigationState = false
    private var observations: [NSKeyValueObservation] = []

    /// Props set one by one: the page loads once they're all in.
    private struct Source: Equatable {
        var url: String?
        var headers: [String: String]?
        var html: String?
        var baseUrl: String?
    }

    init(sendEvent: @escaping PluginRegistry.SendEvent, register: @escaping (Int, NativueWebView) -> Void) {
        self.sendEvent = sendEvent
        self.register = register

        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        super.init(frame: .zero, configuration: configuration)

        // The view is the handler's owner: a weak proxy, or neither would go.
        configuration.userContentController.add(WeakMessageHandler(self), name: Self.messageHandlerName)
        navigationDelegate = self
        uiDelegate = self
        observations = [
            observe(\.url) { webView, _ in webView.scheduleNavigationState() },
            observe(\.title) { webView, _ in webView.scheduleNavigationState() },
            observe(\.isLoading) { webView, _ in webView.scheduleNavigationState() },
            observe(\.canGoBack) { webView, _ in webView.scheduleNavigationState() },
            observe(\.canGoForward) { webView, _ in webView.scheduleNavigationState() },
        ]
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    deinit {
        configuration.userContentController.removeScriptMessageHandler(forName: Self.messageHandlerName)
    }

    func setProp(_ key: String, value: Any?) {
        switch key {
        case "webViewId":
            guard let id = value as? Int else { return }

            register(id, self)
            sendEvent("registered", nil)
            return
        case "url": source.url = value as? String
        case "headers": source.headers = value as? [String: String]
        case "html": source.html = value as? String
        case "baseUrl": source.baseUrl = value as? String
        case "injectedJavaScript": injectedJavaScript = value as? String
        case "injectedJavaScriptBeforeContentLoaded": injectedJavaScriptBeforeContentLoaded = value as? String
        case "javaScriptEnabled": javaScriptEnabled = value as? Bool ?? true
        case "userAgent": customUserAgent = value as? String
        case "allowsBackForwardNavigationGestures": allowsBackForwardNavigationGestures = value as? Bool ?? false
        default: return
        }

        scheduleChanges()
    }

    private func scheduleChanges() {
        guard !hasPendingChanges else { return }

        hasPendingChanges = true
        DispatchQueue.main.async { [weak self] in self?.applyChanges() }
    }

    private func applyChanges() {
        hasPendingChanges = false
        updateUserScripts()

        // Rendering again gives new headers to the same page: only a different source loads.
        guard source != loadedSource else { return }

        loadedSource = source
        if let html = source.html {
            loadHTMLString(html, baseURL: source.baseUrl.flatMap(URL.init(string:)))
        } else if let address = source.url, let url = URL(string: address) {
            var request = URLRequest(url: url)
            source.headers?.forEach { request.setValue($1, forHTTPHeaderField: $0) }
            load(request)
        }
    }

    private func updateUserScripts() {
        let controller = configuration.userContentController
        let scripts = [
            injectedJavaScriptBeforeContentLoaded.map {
                WKUserScript(source: $0, injectionTime: .atDocumentStart, forMainFrameOnly: true)
            },
            injectedJavaScript.map { WKUserScript(source: $0, injectionTime: .atDocumentEnd, forMainFrameOnly: true) },
        ]

        controller.removeAllUserScripts()
        controller.addUserScript(Self.messageBridge)
        scripts.compactMap { $0 }.forEach(controller.addUserScript)
    }

    func evaluate(_ script: String) async throws -> Any? {
        do {
            return try await evaluateJavaScript(script)
        } catch {
            throw PluginError(code: "ERR_UNAVAILABLE", message: error.localizedDescription)
        }
    }

    // KVO fires once per property: one event for what changed together.
    private func scheduleNavigationState() {
        guard !hasPendingNavigationState else { return }

        hasPendingNavigationState = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }

            hasPendingNavigationState = false
            sendEvent("navigationstatechange", [
                "url": url?.absoluteString ?? "",
                "title": title ?? "",
                "loading": isLoading,
                "canGoBack": canGoBack,
                "canGoForward": canGoForward,
            ])
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        sendEvent("loadstart", ["url": url?.absoluteString ?? ""])
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        sendEvent("load", ["url": url?.absoluteString ?? "", "title": title ?? ""])
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        sendError(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        sendError(error)
    }

    // A page that stops loading because another one starts isn't an error.
    private func sendError(_ error: Error) {
        let error = error as NSError
        let isInterruption = (error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled) ||
            (error.domain == "WebKitErrorDomain" && error.code == 102)

        if isInterruption { return }

        sendEvent("error", [
            "url": (error.userInfo[NSURLErrorFailingURLStringErrorKey] as? String) ?? url?.absoluteString ?? "",
            "code": error.code,
            "description": error.localizedDescription,
        ])
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        preferences: WKWebpagePreferences,
        decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void
    ) {
        preferences.allowsContentJavaScript = javaScriptEnabled

        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased(),
              !Self.schemesLoadedHere.contains(scheme)
        else { return decisionHandler(.allow, preferences) }

        // A frame's own link to an app stays put: only the page itself opens another app.
        if navigationAction.targetFrame?.isMainFrame ?? true { UIApplication.shared.open(url) }
        decisionHandler(.cancel, preferences)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        if navigationResponse.isForMainFrame, let response = navigationResponse.response as? HTTPURLResponse,
           response.statusCode >= 400 {
            sendEvent("httperror", ["url": response.url?.absoluteString ?? "", "statusCode": response.statusCode])
        }

        decisionHandler(.allow)
    }

    // target="_blank" and window.open: in this view, as there's no other.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.targetFrame == nil { load(navigationAction.request) }

        return nil
    }

    // The page's process ended (memory, a crash): the view stays blank until the app loads it again.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        sendEvent("processterminated", nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        sendEvent("message", ["data": message.body as? String ?? ""])
    }
}

private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var handler: WKScriptMessageHandler?

    init(_ handler: WKScriptMessageHandler) {
        self.handler = handler
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        handler?.userContentController(userContentController, didReceive: message)
    }
}
