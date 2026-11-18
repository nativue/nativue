package dev.nativue

import android.content.Context
import android.content.res.Configuration
import android.view.View
import android.view.ViewGroup

/**
 * The colors of nativue's own views (headers, tab bars, sheets, text without a color) when the app
 * sets none: Material 3's, light or dark with the system, as UIKit's are on iOS. The activity isn't
 * recreated when the system switches (configChanges has uiMode), so views that use them implement
 * ThemeAware and are told by applyThemeColors.
 */
internal object ThemeColors {
    var isDark = false
        private set

    val text get() = pick(light = 0xFF000000, dark = 0xFFFFFFFF)
    val placeholder get() = pick(light = 0x4C3C3C43, dark = 0x4CEBEBF5)
    val onSurface get() = pick(light = 0xFF1D1B20, dark = 0xFFE6E0E9)
    val onSurfaceVariant get() = pick(light = 0xFF49454F, dark = 0xFFCAC4D0)
    val surface get() = pick(light = 0xFFFFFFFF, dark = 0xFF141218)
    val barBackground get() = pick(light = 0xFFF3EDF7, dark = 0xFF211F26)
    val ripple get() = pick(light = 0x1F000000, dark = 0x1FFFFFFF)

    /** Reads the system's mode; true when it changed. */
    fun update(context: Context): Boolean {
        val nightMode = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
        val wasDark = isDark
        isDark = nightMode == Configuration.UI_MODE_NIGHT_YES

        return isDark != wasDark
    }

    private fun pick(light: Long, dark: Long) = (if (isDark) dark else light).toInt()
}

internal interface ThemeAware {
    fun applyThemeColors()
}

/** After a switch between light and dark: every ThemeAware view under [view] repaints. */
internal fun applyThemeColors(view: View) {
    (view as? ThemeAware)?.applyThemeColors()
    if (view !is ViewGroup) return

    for (index in 0 until view.childCount) applyThemeColors(view.getChildAt(index))
}

/** <Text>'s view: without a `color` style, it follows the theme. */
internal class TextLabel(context: Context) : android.widget.TextView(context), ThemeAware {
    var styleColor: Int? = null
        set(value) {
            field = value
            applyThemeColors()
        }

    override fun applyThemeColors() {
        setTextColor(styleColor ?: ThemeColors.text)
    }
}
