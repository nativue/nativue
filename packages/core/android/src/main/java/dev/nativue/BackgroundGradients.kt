package dev.nativue

import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.PointF
import android.graphics.RadialGradient
import android.graphics.Shader
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * backgroundImage: a CSS gradient (src/gradients.ts) as a shader for a box [width] by [height] pixels, where
 * CSS puts it, as iOS's CSSGradient does. Lengths arrive in dp.
 */
object BackgroundGradients {
    fun shader(gradient: Map<*, *>, width: Float, height: Float, density: Float): Shader? {
        val colors = (gradient["colors"] as? List<*>).orEmpty().mapNotNull(::androidColor).toIntArray()
        val positions = (gradient["positions"] as? List<*>).orEmpty().mapNotNull { (it as? Number)?.toFloat() }.toFloatArray()
        if (colors.size < 2 || colors.size != positions.size || width <= 0 || height <= 0) return null

        if (gradient["type"] != "radial") {
            val (start, end) = linear(gradient, width, height)

            return LinearGradient(start.x, start.y, end.x, end.y, colors, positions, Shader.TileMode.CLAMP)
        }

        val (center, radii) = radial(gradient, width, height, density)
        val radiusX = max(radii.x, 0.01f)

        // Android's is a circle: stretched into the ellipse.
        return RadialGradient(center.x, center.y, radiusX, colors, positions, Shader.TileMode.CLAMP).apply {
            setLocalMatrix(Matrix().apply { setScale(1f, max(radii.y, 0.01f) / radiusX, center.x, center.y) })
        }
    }

    /** The gradient line: through the center, as long as the box is along it, so its ends touch the corners. */
    private fun linear(gradient: Map<*, *>, width: Float, height: Float): Pair<PointF, PointF> {
        val sides = (gradient["to"] as? List<*>)?.map { it.toString() }
        val angle = (gradient["angle"] as? Number)?.toDouble()?.let(Math::toRadians)
        var directionX = 0f
        var directionY = 1f

        if (sides != null) {
            val x = if ("right" in sides) 1f else if ("left" in sides) -1f else 0f
            val y = if ("bottom" in sides) 1f else if ("top" in sides) -1f else 0f
            // To a corner: perpendicular to the diagonal between the two corners next to it.
            val isCorner = x != 0f && y != 0f

            directionX = if (isCorner) x * height else x
            directionY = if (isCorner) y * width else y
        } else if (angle != null) {
            // 0 points up, 90 right.
            directionX = sin(angle).toFloat()
            directionY = -cos(angle).toFloat()
        }

        val length = hypot(directionX, directionY)
        if (length == 0f) return PointF(0f, 0f) to PointF(0f, height)

        val unitX = directionX / length
        val unitY = directionY / length
        val halfLine = (abs(width * unitX) + abs(height * unitY)) / 2

        return PointF(width / 2 - unitX * halfLine, height / 2 - unitY * halfLine) to
            PointF(width / 2 + unitX * halfLine, height / 2 + unitY * halfLine)
    }

    /** The center and the radii: given, or reaching the extent keyword's side or corner. */
    private fun radial(gradient: Map<*, *>, width: Float, height: Float, density: Float): Pair<PointF, PointF> {
        val center = PointF(
            length(gradient["center"], 0, width, density, 0.5f),
            length(gradient["center"], 1, height, density, 0.5f),
        )
        val isCircle = gradient["shape"] == "circle"

        if (gradient["radii"] != null) {
            val radiusX = length(gradient["radii"], 0, width, density, 0.5f)
            val radiusY = if (isCircle) radiusX else length(gradient["radii"], 1, height, density, 0.5f)

            return center to PointF(radiusX, radiusY)
        }

        val extent = gradient["extent"] as? String ?: "farthest-corner"
        val pick = { first: Float, second: Float -> if (extent.startsWith("closest")) min(first, second) else max(first, second) }
        val sideX = pick(abs(center.x), abs(width - center.x))
        val sideY = pick(abs(center.y), abs(height - center.y))

        val radii = when {
            extent.endsWith("corner") && isCircle -> hypot(sideX, sideY).let { PointF(it, it) }
            // An ellipse through the corner, shaped like the one that would touch the sides.
            extent.endsWith("corner") -> PointF(sideX * sqrt(2f), sideY * sqrt(2f))
            isCircle -> pick(sideX, sideY).let { PointF(it, it) }
            else -> PointF(sideX, sideY)
        }

        return center to radii
    }

    /** [[fraction, dp], ...][index], in pixels of a side [side] long. */
    private fun length(value: Any?, index: Int, side: Float, density: Float, defaultFraction: Float): Float {
        val pair = ((value as? List<*>)?.getOrNull(index) as? List<*>)?.mapNotNull { (it as? Number)?.toFloat() }
        if (pair == null || pair.size != 2) return defaultFraction * side

        return pair[0] * side + pair[1] * density
    }
}
