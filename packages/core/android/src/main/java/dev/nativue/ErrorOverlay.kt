package dev.nativue

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Development only: shows a JS error over the whole app, modals included. The first error stays until
 * it's dismissed or the bundle reloads, since later ones are usually its consequences.
 * Mirrors ios/ErrorOverlay.swift.
 */
class ErrorOverlay(private val activity: Activity) {
    private var overlay: ViewGroup? = null

    fun show(message: String, details: String, onReload: () -> Unit) {
        if (overlay != null) return

        val overlay = makeOverlay(message, details) {
            hide()
            onReload()
        }
        activity.addContentView(overlay, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        this.overlay = overlay
    }

    fun hide() {
        overlay?.let { (it.parent as? ViewGroup)?.removeView(it) }
        overlay = null
    }

    private fun makeOverlay(message: String, details: String, onReload: () -> Unit): ViewGroup {
        val layout = LinearLayout(activity)
        layout.orientation = LinearLayout.VERTICAL
        layout.setBackgroundColor(BACKGROUND)
        layout.isClickable = true // keeps touches from reaching the app below
        ViewCompat.setOnApplyWindowInsetsListener(layout) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left + dp(20), bars.top + dp(24), bars.right + dp(20), bars.bottom + dp(16))
            insets
        }

        layout.addView(text("UNCAUGHT ERROR", size = 13f, alpha = 0.7f))
        layout.addView(text(message, size = 22f), spaced(dp(8)))
        layout.addView(detailsView(details), LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f).apply { topMargin = dp(20) })
        layout.addView(buttons(onReload), spaced(dp(20)))

        return layout
    }

    /** Where it happened and the stack: monospaced, scrollable and selectable, to copy into a search. */
    private fun detailsView(details: String): ScrollView {
        val detailsText = TextView(activity)
        detailsText.text = details
        detailsText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        detailsText.typeface = Typeface.MONOSPACE
        detailsText.setTextColor(Color.argb(0xD9, 0xFF, 0xFF, 0xFF))
        detailsText.setTextIsSelectable(true)
        detailsText.setPadding(dp(8), dp(12), dp(8), dp(12))

        val scrollView = ScrollView(activity)
        scrollView.background = rounded(Color.argb(0x40, 0, 0, 0))
        scrollView.clipToOutline = true
        scrollView.addView(detailsText)

        return scrollView
    }

    private fun buttons(onReload: () -> Unit): LinearLayout {
        val row = LinearLayout(activity)
        row.addView(button("Dismiss", isPrimary = false, ::hide), LinearLayout.LayoutParams(0, dp(50), 1f))
        row.addView(button("Reload", isPrimary = true, onReload), LinearLayout.LayoutParams(0, dp(50), 1f).apply { marginStart = dp(12) })

        return row
    }

    /** Primary: solid white. Otherwise: translucent white. */
    private fun button(title: String, isPrimary: Boolean, onPress: () -> Unit): TextView {
        val button = text(title, size = 17f, weight = 600)
        button.gravity = Gravity.CENTER
        button.setTextColor(if (isPrimary) BACKGROUND else Color.WHITE)
        button.background = rounded(if (isPrimary) Color.WHITE else Color.argb(0x33, 0xFF, 0xFF, 0xFF))
        button.foreground = ripple(dp(12).toFloat())
        button.setOnClickListener { onPress() }

        return button
    }

    private fun text(content: String, size: Float, alpha: Float = 1f, weight: Int = 700) = TextView(activity).apply {
        text = content
        setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
        setTextColor(Color.WHITE)
        this.alpha = alpha
        typeface = typefaceOfWeight(context, weight)
    }

    private fun rounded(color: Int) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(12).toFloat()
    }

    private fun spaced(top: Int) = LinearLayout.LayoutParams(MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = top }

    private fun dp(value: Int) = (value * activity.resources.displayMetrics.density).toInt()

    private companion object {
        const val MATCH_PARENT = ViewGroup.LayoutParams.MATCH_PARENT
        val BACKGROUND = Color.rgb(140, 23, 31) // iOS: (0.55, 0.09, 0.12)
    }
}
