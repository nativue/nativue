package dev.nativue.webview

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import dev.nativue.PluginView
import dev.nativue.SendEvent
import org.json.JSONTokener

/** A WebView taking <WebView>'s props. The page's window.nativueWebView.postMessage reaches @message. */
@SuppressLint("SetJavaScriptEnabled", "ViewConstructor")
class NativueWebView(
    context: Context,
    private val sendEvent: SendEvent,
    private val register: (Int, NativueWebView) -> Unit,
) : WebView(context), PluginView {
    /** Props set one by one: the page loads once they're all in. */
    private data class Source(
        val url: String? = null,
        val headers: Map<String, String>? = null,
        val html: String? = null,
        val baseUrl: String? = null,
    )

    private var source = Source()
    private var loadedSource: Source? = null
    private var injectedJavaScript: String? = null
    private var injectedJavaScriptBeforeContentLoaded: String? = null
    private var documentStartScript: ScriptHandler? = null
    private var isLoadingPage = false
    private var hasPendingChanges = false
    private var hasPendingNavigationState = false

    init {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        addJavascriptInterface(MessageBridge(), "nativueWebView")
        webViewClient = Client()
        webChromeClient = object : WebChromeClient() {
            override fun onReceivedTitle(view: WebView, title: String?) = scheduleNavigationState()
        }
    }

    private inner class MessageBridge {
        // On a WebView thread.
        @JavascriptInterface
        fun postMessage(data: String?) {
            post { sendEvent("message", mapOf("data" to (data ?: ""))) }
        }
    }

    override fun setProp(key: String, value: Any?) {
        when (key) {
            "webViewId" -> (value as? Number)?.let { register(it.toInt(), this) }
            "url" -> source = source.copy(url = value as? String)
            "headers" -> source = source.copy(headers = (value as? Map<*, *>)?.entries?.associate { "${it.key}" to "${it.value}" })
            "html" -> source = source.copy(html = value as? String)
            "baseUrl" -> source = source.copy(baseUrl = value as? String)
            "injectedJavaScript" -> injectedJavaScript = value as? String
            "injectedJavaScriptBeforeContentLoaded" -> injectedJavaScriptBeforeContentLoaded = value as? String
            "javaScriptEnabled" -> settings.javaScriptEnabled = value as? Boolean ?: true
            "userAgent" -> settings.userAgentString = value as? String
            else -> return
        }

        scheduleChanges()
    }

    private fun scheduleChanges() {
        if (hasPendingChanges) return

        hasPendingChanges = true
        post { applyChanges() }
    }

    private fun applyChanges() {
        hasPendingChanges = false
        updateDocumentStartScript()

        // Rendering again gives new headers to the same page: only a different source loads.
        if (source == loadedSource) return

        loadedSource = source
        val html = source.html
        val url = source.url

        if (html != null) loadDataWithBaseURL(source.baseUrl, html, "text/html", "utf-8", null)
        else if (url != null) loadUrl(url, source.headers.orEmpty())
    }

    // Without the feature (a WebView before 2021), the script runs when the page starts, as soon as it can.
    private fun updateDocumentStartScript() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return

        documentStartScript?.remove()
        documentStartScript = injectedJavaScriptBeforeContentLoaded?.let {
            WebViewCompat.addDocumentStartJavaScript(this, it, setOf("*"))
        }
    }

    fun evaluate(script: String, resolve: (String?) -> Unit) {
        evaluateJavascript(script) { json -> resolve(JSONTokener(json).nextValue() as? String) }
    }

    // Each callback says one thing changed: one event for what changed together.
    private fun scheduleNavigationState() {
        if (hasPendingNavigationState) return

        hasPendingNavigationState = true
        post {
            hasPendingNavigationState = false
            sendEvent(
                "navigationstatechange",
                mapOf(
                    "url" to (url ?: ""),
                    "title" to (title ?: ""),
                    "loading" to isLoadingPage,
                    "canGoBack" to canGoBack(),
                    "canGoForward" to canGoForward(),
                ),
            )
        }
    }

    /** Loaded here; any other scheme (tel:, mailto:, another app's) opens in the app it belongs to. */
    private fun openElsewhere(uri: Uri) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (error: ActivityNotFoundException) {
            // No app for it: the link does nothing, as in a browser.
        }
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (request.url.scheme?.lowercase() in SCHEMES_LOADED_HERE) return false

            // A frame's own link to an app stays put: only the page itself opens another app.
            if (request.isForMainFrame) openElsewhere(request.url)

            return true
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            isLoadingPage = true
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                injectedJavaScriptBeforeContentLoaded?.let { evaluateJavascript(it, null) }
            }
            sendEvent("loadstart", mapOf("url" to url))
            scheduleNavigationState()
        }

        override fun onPageFinished(view: WebView, url: String) {
            isLoadingPage = false
            injectedJavaScript?.let { evaluateJavascript(it, null) }
            sendEvent("load", mapOf("url" to url, "title" to (title ?: "")))
            scheduleNavigationState()
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) = scheduleNavigationState()

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return

            sendEvent(
                "error",
                mapOf("url" to request.url.toString(), "code" to error.errorCode, "description" to error.description.toString()),
            )
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            if (!request.isForMainFrame) return

            sendEvent("httperror", mapOf("url" to request.url.toString(), "statusCode" to response.statusCode))
        }
    }

    private companion object {
        val SCHEMES_LOADED_HERE = setOf("http", "https", "about", "data", "blob", "file", "javascript")
    }
}
