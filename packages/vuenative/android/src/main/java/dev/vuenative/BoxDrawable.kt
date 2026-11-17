package dev.vuenative

import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.drawable.Drawable
import kotlin.math.max

/**
 * A view's box: background color, rounded corners, border and a shadow drawn like iOS layers draw
 * theirs (color, opacity, blur radius, offset), outside the view's bounds. Sizes in pixels.
 */
class BoxDrawable : Drawable() {
    var backgroundColor = 0
    var cornerRadius = 0f
    var borderWidth = 0f
    var borderColor = 0

    var shadowColor = 0xFF000000.toInt()
    var shadowOpacity = 0f
    var shadowRadius = 0f
    var shadowOffsetX = 0f
    var shadowOffsetY = 0f

    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val rect = RectF()

    override fun draw(canvas: Canvas) {
        rect.set(bounds)

        fillPaint.color = backgroundColor
        applyShadow()
        if (backgroundColor ushr 24 != 0) canvas.drawRoundRect(rect, cornerRadius, cornerRadius, fillPaint)

        if (borderWidth > 0) {
            // The stroke is centered on the path: inset by half so it stays inside, like iOS borders.
            rect.inset(borderWidth / 2, borderWidth / 2)
            borderPaint.color = borderColor
            borderPaint.strokeWidth = borderWidth
            val radius = max(0f, cornerRadius - borderWidth / 2)
            canvas.drawRoundRect(rect, radius, radius, borderPaint)
        }
    }

    /**
     * Core Animation blurs with a sigma of half the shadow radius; Skia's blur radius r gives a sigma of
     * 0.57735 r + 0.5. The shadow takes the fill's alpha, like iOS (an invisible box casts none).
     */
    private fun applyShadow() {
        val sigma = shadowRadius / 2
        val alpha = ((shadowColor ushr 24) * shadowOpacity).toInt().coerceIn(0, 255)

        if (alpha == 0 || backgroundColor ushr 24 == 0) {
            fillPaint.clearShadowLayer()
            return
        }

        val blurRadius = max(0.1f, (sigma - 0.5f) / 0.57735f)
        fillPaint.setShadowLayer(blurRadius, shadowOffsetX, shadowOffsetY, (alpha shl 24) or (shadowColor and 0xFFFFFF))
    }

    /** `overflow: 'hidden'` clips to this outline, so rounded corners clip their content. */
    override fun getOutline(outline: Outline) {
        outline.setRoundRect(bounds, cornerRadius)
    }

    override fun setAlpha(alpha: Int) {}

    override fun setColorFilter(colorFilter: ColorFilter?) {}

    @Deprecated("Deprecated in Java")
    override fun getOpacity() = PixelFormat.TRANSLUCENT
}
