package dev.nativue

import android.app.Activity
import android.content.Intent
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import androidx.annotation.RequiresApi
import com.facebook.soloader.SoLoader

/** The app's activity: runs assets/main.bundle.js (or, in debug builds, the dev server's bundle). */
open class NativueActivity : Activity() {
    private lateinit var bridge: Bridge

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        SoLoader.init(this, false) // Yoga loads its native library through it
        SystemBars.drawBehind(window)
        ThemeColors.update(this)

        val rootView = RootView(this)
        setContentView(rootView)
        keepSplashScreenUntilFirstRender(rootView)
        bridge = Bridge(this, rootView)
        bridge.onCanGoBackChange = ::setHandlesBack
        bridge.start()
        intent.data?.let { bridge.openURL(it.toString()) }
    }

    /**
     * The splash screen leaves on the window's first frame, which would be empty until JS renders: skip
     * frames until the first screen (or the error overlay, added next to the root view) is in.
     */
    private fun keepSplashScreenUntilFirstRender(rootView: RootView) {
        val content = rootView.parent as ViewGroup

        rootView.viewTreeObserver.addOnPreDrawListener(object : ViewTreeObserver.OnPreDrawListener {
            override fun onPreDraw(): Boolean {
                if (rootView.childCount == 0 && content.childCount == 1) return false

                rootView.viewTreeObserver.removeOnPreDrawListener(this)

                return true
            }
        })
    }

    /** Deep links while running: singleTask brings this activity back instead of starting another. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.let { bridge.openURL(it.toString()) }
    }

    /** The manifest's configChanges keep the activity (and the JS state) through uiMode changes. */
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        bridge.onConfigurationChanged()
    }

    /** Android 13+ takes back gestures only when registered for (predictive back); older versions call onBackPressed. */
    private var predictiveBack: PredictiveBack? = null

    private fun setHandlesBack(handlesBack: Boolean) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return

        val predictiveBack = predictiveBack ?: PredictiveBack(this) { bridge.goBack() }.also { predictiveBack = it }
        predictiveBack.setRegistered(handlesBack)
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

/**
 * Its own class, created only on Android 13+: older versions can't load OnBackInvokedCallback, and a
 * release build crashes on launch if the activity itself refers to it.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private class PredictiveBack(private val activity: Activity, onBack: () -> Unit) {
    private val callback = OnBackInvokedCallback(onBack)

    fun setRegistered(isRegistered: Boolean) {
        val dispatcher = activity.onBackInvokedDispatcher
        if (isRegistered) dispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback)
        else dispatcher.unregisterOnBackInvokedCallback(callback)
    }
}
