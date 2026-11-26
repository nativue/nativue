package dev.nativue.haptics

import android.os.Build
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
    // CONFIRM and REJECT are Android 11+; before, the closest older ones.
    private val isAndroid11OrLater = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
    private val confirm = if (isAndroid11OrLater) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
    private val reject = if (isAndroid11OrLater) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
    private val notificationFeedback = mapOf("success" to confirm, "warning" to reject, "error" to reject)

    override fun register(registry: PluginRegistry) {
        fun perform(feedback: Int) {
            val decorView = registry.activity?.window?.decorView ?: return

            decorView.post { decorView.performHapticFeedback(feedback) }
        }

        registry.addFunction("haptics.impact") { arguments ->
            perform(impactFeedback[arguments.firstOrNull()] ?: HapticFeedbackConstants.VIRTUAL_KEY)
        }
        registry.addFunction("haptics.notification") { arguments ->
            perform(notificationFeedback[arguments.firstOrNull()] ?: confirm)
        }
        registry.addFunction("haptics.selection") { _ -> perform(HapticFeedbackConstants.CLOCK_TICK) }
    }
}
