package dev.vuenative

typealias NativeFunction = (arguments: List<Any?>) -> Any?

/**
 * A Hermes runtime (src/main/cpp/bridge.cpp) with [functions] installed as `globalThis.__native`.
 * Values cross as null, Boolean, Double, String, List and Map. Use it from one thread only.
 */
class JavaScriptRuntime(
    private val functions: Map<String, NativeFunction>,
    private val onError: (message: String, stack: String) -> Unit,
) {
    private val functionList = functions.values.toList()
    private var handle = create(functions.keys.toTypedArray())

    /** [bundle] is JavaScript (UTF-8) or Hermes bytecode; Hermes tells them apart. */
    fun evaluate(bundle: ByteArray, sourceURL: String) = evaluate(handle, bundle, sourceURL)

    /** Calls a global function, if the bundle defined it. */
    fun call(functionName: String, vararg arguments: Any?) = call(handle, functionName, arrayOf(*arguments))

    fun destroy() {
        destroy(handle)
        handle = 0
    }

    // Called from bridge.cpp.
    private fun callNative(index: Int, arguments: Array<Any?>): Any? = functionList[index](arguments.asList())

    private fun reportError(message: String, stack: String) = onError(message, stack)

    private external fun create(functionNames: Array<String>): Long

    private external fun evaluate(handle: Long, bundle: ByteArray, sourceURL: String)

    private external fun call(handle: Long, functionName: String, arguments: Array<Any?>)

    private external fun destroy(handle: Long)

    companion object {
        init {
            // Hermes calls Java through fbjni, which sets itself up only when Java loads it.
            System.loadLibrary("fbjni")
            System.loadLibrary("vuenative")
        }
    }
}
