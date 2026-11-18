package dev.nativue

import android.content.Context
import android.view.View
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The native side of a package: functions JavaScript calls (`requireNativeFunction`) and views it
 * renders. Packages declare their Gradle module and plugin class in package.json;
 * nativue.settings.gradle.kts adds them to the app.
 */
interface NativuePlugin {
    fun register(registry: PluginRegistry)
}

/** sendEvent("change", payload) reaches the element's @change; event names are lowercase. */
typealias SendEvent = (eventName: String, payload: Any?) -> Unit

/** Settles an async function's JavaScript Promise; only the first call counts. */
class Promise internal constructor(private val settle: (value: Any?, errorMessage: String?) -> Unit) {
    private val settled = AtomicBoolean(false)

    fun resolve(value: Any? = null) {
        if (settled.compareAndSet(false, true)) settle(value, null)
    }

    fun reject(errorMessage: String) {
        if (settled.compareAndSet(false, true)) settle(null, errorMessage)
    }
}

/** Called on the JavaScript thread; settles `promise` from any thread, when the work is done. */
typealias AsyncFunction = (arguments: List<Any?>, promise: Promise) -> Unit

/** `context` is the app's activity. */
class PluginRegistry internal constructor(val context: Context) {
    internal val functions = mutableMapOf<String, NativeFunction>()
    internal val asyncFunctions = mutableMapOf<String, AsyncFunction>()
    internal val viewMakers = mutableMapOf<String, (SendEvent) -> View>()

    init {
        pluginClassNames(context).forEach { className ->
            val plugin = Class.forName(className).getDeclaredConstructor().newInstance() as NativuePlugin
            plugin.register(this)
        }
    }

    /** Runs on the JavaScript thread and returns synchronously: post to the main thread for views. */
    fun addFunction(name: String, function: NativeFunction) {
        functions[name] = function
    }

    /** For work that takes time (a permission prompt, the camera): JavaScript gets a Promise. */
    fun addAsyncFunction(name: String, function: AsyncFunction) {
        asyncFunctions[name] = function
    }

    /** `type` is the element's tag, e.g. "MapView" for h('MapView'). Created on the main thread. */
    fun addView(type: String, makeView: (SendEvent) -> View) {
        viewMakers[type] = makeView
    }
}

/** The string resource nativue.settings.gradle.kts writes: the plugin classes, comma-separated. */
private fun pluginClassNames(context: Context): List<String> {
    val resourceId = context.resources.getIdentifier("nativue_plugins", "string", context.packageName)
    if (resourceId == 0) return emptyList()

    return context.getString(resourceId).split(',').filter { it.isNotEmpty() }
}

/** A plugin view gets its props here, all but `style`, which nativue applies (layout included). */
interface PluginView {
    fun setProp(key: String, value: Any?)
}
