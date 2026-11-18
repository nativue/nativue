package dev.nativue.haptics

import android.app.Activity
import android.view.HapticFeedbackConstants
import dev.nativue.NativuePlugin
import dev.nativue.PluginRegistry

/** Haptics.impact, .notification and .selection (src/index.ts). */
class HapticsPlugin : NativuePlugin {
    private val impactFeedback = mapOf(
        "light" to HapticFeedbackConstants.CLOCK_TICK,
        "medium" to HapticFeedbackConstants.VIRTUAL_KEY,
        "heavy" to HapticFeedbackConstants.LONG_PRESS,
    )
    private val notificationFeedback = mapOf(
        "success" to HapticFeedbackConstants.CONFIRM,
        "warning" to HapticFeedbackConstants.REJECT,
        "error" to HapticFeedbackConstants.REJECT,
    )

    override fun register(registry: PluginRegistry) {
        val window = (registry.context as Activity).window

        fun perform(feedback: Int) {
            window.decorView.post { window.decorView.performHapticFeedback(feedback) }
        }

        registry.addFunction("haptics.impact") { arguments ->
            perform(impactFeedback[arguments.firstOrNull()] ?: HapticFeedbackConstants.VIRTUAL_KEY)
        }
        registry.addFunction("haptics.notification") { arguments ->
            perform(notificationFeedback[arguments.firstOrNull()] ?: HapticFeedbackConstants.CONFIRM)
        }
        registry.addFunction("haptics.selection") { _ -> perform(HapticFeedbackConstants.CLOCK_TICK) }
    }
}
