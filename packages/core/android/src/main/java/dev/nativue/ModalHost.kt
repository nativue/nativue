package dev.nativue

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Canvas
import android.graphics.drawable.GradientDrawable
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout

/**
 * Shows the content of a <Modal> over the app. The <Modal> itself is a hidden placeholder in the tree;
 * its children live in [contentNode], laid out as a separate Yoga root. `pageSheet` and `formSheet`
 * are Material bottom sheets (dragged down to close), the others cover the window.
 * Mirrors ios/ModalController.swift.
 */
class ModalHost(private val activity: Activity) {
    val placeholder = View(activity)
    val contentNode = NativeNode(ContainerView(activity), measuresContent = false)

    var onEvent: (eventName: String) -> Unit = {}

    /** The window's layout pass places the content; called when the overlay's size changes. */
    var onNeedsLayout: () -> Unit = {}
    var animationType = "none"
    var presentationStyle = "fullScreen"
    var transparent = false

    private val overlay = Overlay()
    private var isPresented = false

    val isSheet: Boolean
        get() = !transparent && (presentationStyle == "pageSheet" || presentationStyle == "formSheet")

    /** Deferred to after the current batch, so the content is in before it shows. */
    fun setVisible(visible: Boolean) {
        placeholder.post { if (visible) present() else dismiss() }
    }

    /** The <Modal> left the tree (an ancestor's v-if): its content must go too. */
    fun dismissIfDetached() {
        if (isPresented && !placeholder.isAttachedToWindow) dismiss()
    }

    /** Lays the content out below the sheet's top, or over the whole window. */
    fun layout(windowInsetTop: Int) {
        if (!isPresented || overlay.width == 0) return

        val density = activity.resources.displayMetrics.density
        val top = if (isSheet) windowInsetTop + overlay.dp(12f) else 0
        val content = contentNode.view

        content.measure(exactly(overlay.width), exactly(overlay.height - top))
        content.layout(0, top, overlay.width, overlay.height)
        contentNode.calculateLayout(overlay.width / density, (overlay.height - top) / density)
    }

    /** Back closes it the way a dragged sheet does: JS decides. */
    fun requestClose() = onEvent("requestclose")

    val isShowing: Boolean
        get() = isPresented

    private fun present() {
        if (isPresented) return

        isPresented = true
        val content = contentNode.view
        content.background = when {
            transparent -> null
            isSheet -> GradientDrawable().apply {
                setColor(ThemeColors.surface)
                val radius = overlay.dp(28f).toFloat()
                cornerRadii = floatArrayOf(radius, radius, radius, radius, 0f, 0f, 0f, 0f)
            }
            else -> GradientDrawable().apply { setColor(ThemeColors.surface) }
        }
        content.clipToOutline = isSheet
        (content.parent as? ViewGroup)?.removeView(content)
        overlay.addView(content)
        activity.addContentView(overlay, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))

        overlay.post {
            animate(showing = true) { onEvent("show") }
        }
    }

    private fun dismiss() {
        if (!isPresented) return

        isPresented = false
        animate(showing = false) {
            (overlay.parent as? ViewGroup)?.removeView(overlay)
            onEvent("dismiss")
        }
    }

    private fun animate(showing: Boolean, onEnd: () -> Unit) {
        val content = contentNode.view
        val animator = content.animate().setDuration(if (animationType == "none") 0 else 300)

        when (animationType) {
            "fade" -> {
                content.alpha = if (showing) 0f else content.alpha
                animator.alpha(if (showing) 1f else 0f)
            }

            else -> {
                if (showing && animationType != "none") content.translationY = overlay.height.toFloat()
                animator.translationY(if (showing) 0f else overlay.height.toFloat())
            }
        }

        animator.setUpdateListener { overlay.invalidate() }
        animator.withEndAction(onEnd).start()
    }

    /** Dims the app under a sheet, and drags the sheet down. */
    private inner class Overlay : ContainerView(activity) {
        private val sheetDrag = SheetDrag(contentNode.view) { requestClose() }

        init {
            clipChildren = true
            isClickable = true // keeps touches from reaching the app below
        }

        override fun dispatchDraw(canvas: Canvas) {
            if (isSheet && height > 0) {
                val progress = 1 - (contentNode.view.translationY / height).coerceIn(0f, 1f)
                canvas.drawColor(((0x52 * progress).toInt()) shl 24)
            }

            super.dispatchDraw(canvas)
        }

        override fun onInterceptTouchEvent(event: MotionEvent): Boolean =
            isSheet && sheetDrag.shouldIntercept(event, dragAreaBottom = dp(56f).toFloat())

        private var isScrimTouch = false

        /** A tap on the dimmed app above a sheet closes it; a drag from the sheet's top moves it. */
        @SuppressLint("ClickableViewAccessibility")
        override fun onTouchEvent(event: MotionEvent): Boolean {
            if (!isSheet) return true

            val content = contentNode.view
            if (event.actionMasked == MotionEvent.ACTION_DOWN) isScrimTouch = event.y < content.top + content.translationY
            if (!isScrimTouch) return sheetDrag.onTouchEvent(event)

            if (event.actionMasked == MotionEvent.ACTION_UP) requestClose()

            return true
        }

        override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
            if (changed) post { onNeedsLayout() }
        }
    }

    private companion object {
        const val MATCH_PARENT = ViewGroup.LayoutParams.MATCH_PARENT
    }
}
