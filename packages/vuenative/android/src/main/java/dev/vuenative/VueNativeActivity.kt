package dev.vuenative

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import com.facebook.soloader.SoLoader

/** The app's activity: runs assets/main.bundle.js (or, in debug builds, the dev server's bundle). */
open class VueNativeActivity : Activity() {
    private lateinit var bridge: Bridge

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        SoLoader.init(this, false) // Yoga loads its native library through it

        val rootView = RootView(this)
        setContentView(rootView)
        bridge = Bridge(this, rootView)
        bridge.onCanGoBackChange = ::setHandlesBack
        bridge.start()
        intent.data?.let { bridge.openURL(it.toString()) }
    }

    /** Deep links while running: singleTask brings this activity back instead of starting another. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.let { bridge.openURL(it.toString()) }
    }

    /**
     * Android 13+ takes back gestures only when registered for (predictive back); older versions call
     * onBackPressed.
     */
    private val backCallback = OnBackInvokedCallback { bridge.goBack() }

    private fun setHandlesBack(handlesBack: Boolean) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return

        if (handlesBack) onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback)
        else onBackInvokedDispatcher.unregisterOnBackInvokedCallback(backCallback)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (!bridge.goBack()) super.onBackPressed()
    }

    override fun onDestroy() {
        bridge.destroy()
        super.onDestroy()
    }
}
