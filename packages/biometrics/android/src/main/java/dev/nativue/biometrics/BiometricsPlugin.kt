package dev.nativue.biometrics

import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import dev.nativue.ActivityListener
import dev.nativue.NativuePlugin
import dev.nativue.PluginRegistry
import dev.nativue.Promise

/**
 * Biometrics (src/index.ts): androidx's BiometricPrompt, on NativueActivity (a FragmentActivity). Class 2
 * ("weak") biometrics count, as many devices' face unlock is: enough to tell it's the user, not to unlock keys.
 */
class BiometricsPlugin : NativuePlugin, ActivityListener {
    private lateinit var registry: PluginRegistry
    private val mainThread = Handler(Looper.getMainLooper())
    /** The call the open prompt answers: one prompt at a time. */
    private var waiting: Promise? = null

    override fun register(registry: PluginRegistry) {
        this.registry = registry

        registry.addAsyncFunction("biometrics.getStatus") { _, promise -> promise.resolve(status()) }

        registry.addAsyncFunction("biometrics.authenticate") { arguments, promise ->
            @Suppress("UNCHECKED_CAST")
            val options = arguments[0] as Map<String, Any?>

            mainThread.post { authenticate(options, promise) }
        }
    }

    // Its JavaScript goes with it: there's no one left to answer.
    override fun onActivityDestroyed(activity: ComponentActivity) {
        waiting = null
    }

    private fun status(): Map<String, Any> {
        val answer = BiometricManager.from(registry.applicationContext).canAuthenticate(BIOMETRIC_WEAK)

        return mapOf(
            "available" to (answer == BiometricManager.BIOMETRIC_SUCCESS || answer == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED),
            "enrolled" to (answer == BiometricManager.BIOMETRIC_SUCCESS),
            "types" to types(),
        )
    }

    /** What the device has sensors for, set up or not. */
    private fun types(): List<String> {
        val packageManager = registry.applicationContext.packageManager
        val features = buildMap {
            put("fingerprint", PackageManager.FEATURE_FINGERPRINT)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put("face", PackageManager.FEATURE_FACE)
                put("iris", PackageManager.FEATURE_IRIS)
            }
        }

        return features.filterValues(packageManager::hasSystemFeature).keys.toList()
    }

    private fun authenticate(options: Map<String, Any?>, promise: Promise) {
        val activity = registry.activity as? FragmentActivity

        if (waiting != null) return promise.reject("ERR_UNAVAILABLE", "The biometric prompt is already open")
        if (activity == null) return promise.reject("ERR_UNAVAILABLE", "The app has no activity open")

        val allowsDeviceCredential = options["allowDeviceCredential"] as? Boolean ?: false
        val reason = options["reason"] as String
        val title = (options["title"] as? String).orEmpty()
        val cancelLabel = (options["cancelLabel"] as? String).orEmpty().ifEmpty { "Cancel" }
        val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback)
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title.ifEmpty { reason })
            .apply { if (title.isNotEmpty()) setSubtitle(reason) }
            .setAllowedAuthenticators(if (allowsDeviceCredential) BIOMETRIC_WEAK or DEVICE_CREDENTIAL else BIOMETRIC_WEAK)
            // With the device's credential, its own screen has the way out; without, the prompt needs one.
            .apply { if (!allowsDeviceCredential) setNegativeButtonText(cancelLabel) }
            .build()

        // In the background the prompt can't show, and androidx then does nothing, without a callback.
        if (activity.supportFragmentManager.isStateSaved) return promise.resolve(mapOf("success" to false, "error" to "interrupted"))

        waiting = promise
        prompt.authenticate(info)
    }

    /** A failed try leaves the prompt open for another: only its end answers. */
    private val callback = object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            answer(mapOf("success" to true))
        }

        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            answer(mapOf("success" to false, "error" to reason(errorCode)))
        }
    }

    private fun answer(result: Map<String, Any>) {
        waiting?.resolve(result)
        waiting = null
    }

    /** A face or finger that doesn't match leaves the prompt open; too many lock it out: none is "failed". */
    private fun reason(errorCode: Int) = when (errorCode) {
        BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON -> "canceled"
        BiometricPrompt.ERROR_CANCELED, BiometricPrompt.ERROR_TIMEOUT -> "interrupted"
        BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "lockout"
        BiometricPrompt.ERROR_NO_BIOMETRICS, BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL -> "not_enrolled"
        else -> "not_available"
    }
}
