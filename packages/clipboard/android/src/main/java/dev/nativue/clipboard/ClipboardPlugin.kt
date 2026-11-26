package dev.nativue.clipboard

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import dev.nativue.NativuePlugin
import dev.nativue.PluginRegistry

/** Clipboard.copy (src/index.ts). Resolves with whether the system confirmed the copy: Android 13+ does. */
class ClipboardPlugin : NativuePlugin {
    override fun register(registry: PluginRegistry) {
        val clipboard = registry.applicationContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val systemConfirmsCopy = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
        val mainHandler = Handler(Looper.getMainLooper())

        registry.addAsyncFunction("clipboard.copy") { arguments, promise ->
            val text = arguments[0] as String

            mainHandler.post {
                // The system throws past the Binder transaction limit (~1MB), or when it refuses the clip.
                try {
                    clipboard.setPrimaryClip(ClipData.newPlainText("", text))
                    promise.resolve(systemConfirmsCopy)
                } catch (error: Exception) {
                    promise.reject(error.message ?: "Couldn't copy to the clipboard")
                }
            }
        }
    }
}
