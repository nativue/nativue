package dev.nativue

import android.graphics.Color
import android.os.Build
import android.view.Window
import android.view.WindowManager
import androidx.core.view.WindowCompat

/** The status and navigation bars: transparent, over the screens, with icons that contrast with them. */
@Suppress("DEPRECATION") // the APIs older Android versions need
object SystemBars {
    /**
     * Screens draw under the bars, which SafeAreaView and headers pad for: the default from Android 15,
     * and the same on older versions instead of a gray status bar.
     */
    fun drawBehind(window: Window) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) return

        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        // Before Android 8 the navigation bar's icons are always light: a scrim keeps them readable.
        window.navigationBarColor = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Color.TRANSPARENT else NAVIGATION_BAR_SCRIM
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
    }

    /** Dark icons on light screens, light icons on dark ones. */
    fun setLight(window: Window, isLight: Boolean) {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = isLight
        controller.isAppearanceLightNavigationBars = isLight
    }

    private const val NAVIGATION_BAR_SCRIM = 0x80000000.toInt()
}
