package dev.nativue

import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.os.Build
import kotlin.math.max

/**
 * A view's box: background color and gradients, rounded corners, border and a shadow drawn like iOS layers
 * draw theirs (color, opacity, blur radius, offset), outside the view's bounds. Sizes in pixels.
 */
class BoxDrawable : Drawable() {
    var backgroundColor = 0
    /** backgroundImage (BackgroundGradients), the first on top; their lengths in dp, hence the density. */
    var gradients: List<Map<*, *>> = emptyList()
    var density = 1f
    var cornerRadius = 0f
    /** Corners with their own radius, over cornerRadius: top left, top right, bottom right, bottom left. */
    val cornerRadii = arrayOfNulls<Float>(4)
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
        val box = roundedPath(rect, inset = 0f)

        fillPaint.shader = null
        fillPaint.color = backgroundColor
        applyShadow(castsShadow = backgroundColor ushr 24 != 0)
        if (backgroundColor ushr 24 != 0) canvas.drawPath(box, fillPaint)

        // The bottom one casts the shadow when there's no background color.
        gradients.asReversed().forEachIndexed { index, gradient ->
            fillPaint.shader = BackgroundGradients.shader(gradient, rect.width(), rect.height(), density) ?: return@forEachIndexed
            fillPaint.color = 0xFF000000.toInt()
            applyShadow(castsShadow = index == 0 && backgroundColor ushr 24 == 0)
            canvas.drawPath(box, fillPaint)
        }
        fillPaint.shader = null

        if (borderWidth > 0) {
            // The stroke is centered on the path: inset by half so it stays inside, like iOS borders.
            rect.inset(borderWidth / 2, borderWidth / 2)
            borderPaint.color = borderColor
            borderPaint.strokeWidth = borderWidth
            canvas.drawPath(roundedPath(rect, inset = borderWidth / 2), borderPaint)
        }
    }

    /** [bounds] with its corners rounded, each radius less [inset]. */
    private fun roundedPath(bounds: RectF, inset: Float): Path {
        val radii = FloatArray(8) { index -> max(0f, (cornerRadii[index / 2] ?: cornerRadius) - inset) }

        return Path().apply { addRoundRect(bounds, radii, Path.Direction.CW) }
    }

    /**
     * Core Animation blurs with a sigma of half the shadow radius; Skia's blur radius r gives a sigma of
     * 0.57735 r + 0.5. The shadow takes the fill's alpha, like iOS (an invisible box casts none).
     */
    private fun applyShadow(castsShadow: Boolean) {
        val sigma = shadowRadius / 2
        val alpha = ((shadowColor ushr 24) * shadowOpacity).toInt().coerceIn(0, 255)

        if (alpha == 0 || !castsShadow) {
            fillPaint.clearShadowLayer()
            return
        }

        val blurRadius = max(0.1f, (sigma - 0.5f) / 0.57735f)
        fillPaint.setShadowLayer(blurRadius, shadowOffsetX, shadowOffsetY, (alpha shl 24) or (shadowColor and 0xFFFFFF))
    }

    /** `overflow: 'hidden'` clips to this outline, so rounded corners clip their content. */
    override fun getOutline(outline: Outline) {
        if (cornerRadii.all { it == null }) return outline.setRoundRect(bounds, cornerRadius)

        val path = roundedPath(RectF(bounds), inset = 0f)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) outline.setPath(path) else @Suppress("DEPRECATION") outline.setConvexPath(path)
    }

    override fun setAlpha(alpha: Int) {}

    override fun setColorFilter(colorFilter: ColorFilter?) {}

    @Deprecated("Deprecated in Java")
    override fun getOpacity() = PixelFormat.TRANSLUCENT
}
