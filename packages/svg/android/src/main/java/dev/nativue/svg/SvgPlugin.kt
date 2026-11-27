package dev.nativue.svg

import dev.nativue.NativuePlugin
import dev.nativue.PluginRegistry

/** <svg>'s view, and the icons it draws for tab bars and headers (svgIcon). */
class SvgPlugin : NativuePlugin {
    override fun register(registry: PluginRegistry) {
        registry.addView("Svg") { sendEvent ->
            SvgView(registry.activity ?: registry.applicationContext).apply {
                val density = resources.displayMetrics.density

                onElementPress = { nodeIds, x, y ->
                    sendEvent("elementpress", mapOf("nodeIds" to nodeIds, "x" to x / density, "y" to y / density))
                }
            }
        }

        registry.addIconDrawer("svg") { icon, size ->
            SvgView.bitmap(registry.applicationContext, icon["elements"] as? List<*> ?: emptyList<Any>(), icon["viewBox"], size, 0xFF000000.toInt())
        }
    }
}
