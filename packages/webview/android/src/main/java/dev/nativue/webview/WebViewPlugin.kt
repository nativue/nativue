package dev.nativue.webview

import android.os.Handler
import android.os.Looper
import dev.nativue.NativuePlugin
import dev.nativue.PluginRegistry
import dev.nativue.Promise
import java.lang.ref.WeakReference

/** <WebView> (src/index.ts), and the commands its methods send, to the view whose component gave it that id. */
class WebViewPlugin : NativuePlugin {
    private val mainThread = Handler(Looper.getMainLooper())
    /** On the main thread. */
    private val webViewsById = mutableMapOf<Int, WeakReference<NativueWebView>>()

    override fun register(registry: PluginRegistry) {
        registry.addView("WebView") { sendEvent ->
            NativueWebView(registry.activity ?: registry.applicationContext, sendEvent) { id, webView ->
                webViewsById.values.removeAll { it.get() == null }
                webViewsById[id] = WeakReference(webView)
            }
        }

        addCommand("webView.goBack", registry) { if (it.canGoBack()) it.goBack() }
        addCommand("webView.goForward", registry) { if (it.canGoForward()) it.goForward() }
        addCommand("webView.reload", registry) { it.reload() }
        addCommand("webView.stopLoading", registry) { it.stopLoading() }

        registry.addAsyncFunction("webView.evaluate") { arguments, promise ->
            onWebView(arguments[0], promise) { it.evaluate(arguments[1] as String, promise) }
        }
    }

    private fun addCommand(name: String, registry: PluginRegistry, command: (NativueWebView) -> Unit) {
        registry.addAsyncFunction(name) { arguments, promise ->
            onWebView(arguments[0], promise) {
                command(it)
                promise.resolve(null)
            }
        }
    }

    private fun onWebView(id: Any?, promise: Promise, action: (NativueWebView) -> Unit) {
        mainThread.post {
            val webView = webViewsById[(id as Number).toInt()]?.get()

            if (webView == null) promise.reject("ERR_UNAVAILABLE", "That WebView isn't on screen")
            else action(webView)
        }
    }
}
