package dev.nativue

import android.graphics.Color
import android.os.Build
import android.view.View
import android.view.Window
import android.view.WindowInsetsController
import android.view.WindowManager

/** The status and navigation bars: transparent, over the screens, with icons that contrast with them. */
@Suppress("DEPRECATION") // the APIs older Android versions need
object SystemBars {
    /**
     * Screens draw under the bars, which SafeAreaView and headers pad for: the default from Android 15,
     * and the same on older versions instead of a gray status bar.
     */
    fun drawBehind(window: Window) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) return

        window.setDecorFitsSystemWindows(false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        window.attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
    }

    /** Dark icons on light screens, light icons on dark ones. */
    fun setLight(window: Window, isLight: Boolean) {
        val lightBars = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
            WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
        window.insetsController?.setSystemBarsAppearance(if (isLight) lightBars else 0, lightBars)

        // Android 11 keeps the theme's light-bar flags over setSystemBarsAppearance: they're set too.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return

        val decorView = window.decorView
        val flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        decorView.systemUiVisibility =
            if (isLight) decorView.systemUiVisibility or flags else decorView.systemUiVisibility and flags.inv()
    }
}
