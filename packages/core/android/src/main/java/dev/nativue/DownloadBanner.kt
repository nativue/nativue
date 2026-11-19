package dev.nativue

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/** Development only: a strip at the top of the screen while the app downloads the dev server's bundle. Mirrors ios/DownloadBanner.swift. */
class DownloadBanner(private val activity: Activity) {
    private var label: TextView? = null

    fun show(progress: Double) {
        val label = label ?: makeLabel().also { label = it }
        label.text = "Downloading ${(progress * 100).toInt()}%"
    }

    fun hide() {
        label?.let { (it.parent as? ViewGroup)?.removeView(it) }
        label = null
    }

    private fun makeLabel(): TextView {
        val height = (24 * activity.resources.displayMetrics.density).toInt()
        val label = TextView(activity)
        label.setBackgroundColor(Color.rgb(0x0B, 0x12, 0x20))
        label.setTextColor(Color.rgb(0xF1, 0xF5, 0xF9))
        label.textSize = 12f
        label.typeface = Typeface.DEFAULT_BOLD
        label.gravity = Gravity.CENTER
        ViewCompat.setOnApplyWindowInsetsListener(label) { view, insets ->
            val top = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
            view.layoutParams = (view.layoutParams as FrameLayout.LayoutParams).apply { topMargin = top }
            insets
        }
        activity.addContentView(label, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height))
        ViewCompat.requestApplyInsets(label)

        return label
    }
}
