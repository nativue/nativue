package __KOTLIN_PACKAGE__

import dev.nativue.NativuePlugin
import dev.nativue.PluginRegistry

/** __MODULE__.* in src/index.ts. Apps rebuild after installing or updating it. */
class __PASCAL__Plugin : NativuePlugin {
    override fun register(registry: PluginRegistry) {
        registry.addFunction("__MODULE__.hello") { arguments ->
            "Hello, ${arguments.firstOrNull() ?: "world"}, from Android"
        }
    }
}
