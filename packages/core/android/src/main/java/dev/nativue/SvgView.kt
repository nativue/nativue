package dev.nativue

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PointF
import android.graphics.RectF
import android.view.View
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * View behind <Svg>: draws SVG elements ([tag, attributes] pairs, the shape of Lucide's icon nodes),
 * scaled from `viewBox` to its bounds like preserveAspectRatio="xMidYMid meet". Elements are stroked
 * with `color` (round caps and joins, as icon sets expect); those whose fill isn't "none" are also
 * filled with it. Mirrors ios/SvgView.swift.
 */
// ponytail: only the shapes icon sets use and a single color; add per-element colors, gradients or
// transforms when a real-world SVG needs them.
class SvgView(context: Context) : View(context) {
    var viewBox = RectF(0f, 0f, 24f, 24f)
        set(value) {
            field = value
            invalidate()
        }

    var strokeWidth = 2f
        set(value) {
            field = value
            invalidate()
        }

    var color = 0xFF000000.toInt()
        set(value) {
            field = value
            invalidate()
        }

    var elements: List<*> = emptyList<Any>()
        set(value) {
            field = value
            buildPaths()
            invalidate()
        }

    private var strokePath = Path()
    private var fillPath = Path()
    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

    init {
        isClickable = false // a press on an icon presses what contains it
    }

    override fun onDraw(canvas: Canvas) {
        if (viewBox.width() <= 0 || viewBox.height() <= 0) return

        val scale = min(width / viewBox.width(), height / viewBox.height())
        val matrix = Matrix()
        matrix.setTranslate(-viewBox.left, -viewBox.top)
        matrix.postScale(scale, scale)
        matrix.postTranslate((width - viewBox.width() * scale) / 2, (height - viewBox.height() * scale) / 2)

        canvas.save()
        canvas.concat(matrix)
        fillPaint.color = color
        strokePaint.color = color
        strokePaint.strokeWidth = strokeWidth
        canvas.drawPath(fillPath, fillPaint)
        canvas.drawPath(strokePath, strokePaint)
        canvas.restore()
    }

    private fun buildPaths() {
        strokePath = Path()
        fillPath = Path()

        for (element in elements.filterIsInstance<List<*>>()) {
            val tag = element.firstOrNull() as? String ?: continue
            val attributes = element.lastOrNull() as? Map<*, *> ?: continue
            val shape = shape(tag, SvgAttributes(attributes)) ?: continue

            strokePath.addPath(shape)
            val fill = attributes["fill"] as? String
            if (fill != null && fill != "none") fillPath.addPath(shape)
        }
    }

    companion object {
        /** [minX, minY, width, height], as sent from JS. */
        fun rect(viewBox: Any?): RectF? {
            val numbers = (viewBox as? List<*>)?.mapNotNull { (it as? Number)?.toFloat() } ?: emptyList()
            if (numbers.size != 4) return null

            return RectF(numbers[0], numbers[1], numbers[0] + numbers[2], numbers[1] + numbers[3])
        }

        /** The elements drawn in [color] into a square bitmap of [size] pixels (tab bar icons). */
        fun bitmap(context: Context, elements: List<*>, viewBox: Any?, size: Int, color: Int): Bitmap {
            val svgView = SvgView(context)
            rect(viewBox)?.let { svgView.viewBox = it }
            svgView.elements = elements
            svgView.color = color
            svgView.layout(0, 0, size, size)

            val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            svgView.draw(Canvas(bitmap))

            return bitmap
        }

        private fun shape(tag: String, attributes: SvgAttributes): Path? = when (tag) {
            "path" -> SvgPathParser(attributes.text("d")).parse()

            "circle" -> {
                val radius = attributes.number("r")
                Path().apply { addOval(ellipseBounds(attributes, radius, radius), Path.Direction.CW) }
            }

            "ellipse" -> Path().apply {
                addOval(ellipseBounds(attributes, attributes.number("rx"), attributes.number("ry")), Path.Direction.CW)
            }

            "rect" -> roundedRect(attributes)

            "line" -> Path().apply {
                moveTo(attributes.number("x1"), attributes.number("y1"))
                lineTo(attributes.number("x2"), attributes.number("y2"))
            }

            "polyline", "polygon" -> Path().apply {
                SvgPathParser(attributes.text("points")).points().forEachIndexed { index, point ->
                    if (index == 0) moveTo(point.x, point.y) else lineTo(point.x, point.y)
                }
                if (tag == "polygon") close()
            }

            else -> null
        }

        private fun ellipseBounds(attributes: SvgAttributes, radiusX: Float, radiusY: Float): RectF {
            val centerX = attributes.number("cx")
            val centerY = attributes.number("cy")

            return RectF(centerX - radiusX, centerY - radiusY, centerX + radiusX, centerY + radiusY)
        }

        /** rx and ry default to each other, and can't exceed half the side (like SVG). */
        private fun roundedRect(attributes: SvgAttributes): Path {
            val left = attributes.number("x")
            val top = attributes.number("y")
            val rect = RectF(left, top, left + attributes.number("width"), top + attributes.number("height"))
            val radiusX = attributes.optionalNumber("rx") ?: attributes.optionalNumber("ry") ?: 0f
            val radiusY = attributes.optionalNumber("ry") ?: radiusX

            return Path().apply {
                addRoundRect(rect, min(radiusX, rect.width() / 2), min(radiusY, rect.height() / 2), Path.Direction.CW)
            }
        }
    }
}

/** Attribute values arrive as strings ("12") or numbers. */
private class SvgAttributes(private val values: Map<*, *>) {
    fun text(name: String): String = values[name]?.toString() ?: ""

    fun optionalNumber(name: String): Float? = when (val value = values[name]) {
        is Number -> value.toFloat()
        is String -> value.toFloatOrNull()
        else -> null
    }

    fun number(name: String): Float = optionalNumber(name) ?: 0f
}

/**
 * Parses SVG path data ("M12 2a10 10 0 1 0 0 20z"): every command, absolute and relative, including
 * the compact forms optimizers emit ("l.486.9", arc flags written "01").
 */
private class SvgPathParser(private val text: String) {
    private var index = 0

    /** "x,y x,y" (polyline / polygon points). */
    fun points(): List<PointF> {
        val points = mutableListOf<PointF>()

        while (true) {
            val x = number() ?: break
            val y = number() ?: break
            points.add(PointF(x, y))
        }

        return points
    }

    fun parse(): Path {
        val path = Path()
        var command = 'M'
        var current = PointF(0f, 0f)
        var subpathStart = PointF(0f, 0f)
        var lastCubicControl: PointF? = null
        var lastQuadraticControl: PointF? = null

        while (true) {
            skipSeparators()
            if (index >= text.length) break

            if (text[index].isLetter()) {
                command = text[index]
                index++
            } else if (command == 'Z' || command == 'z') {
                break // numbers can't follow a close
            }

            val isRelative = command.isLowerCase()
            val origin = if (isRelative) current else PointF(0f, 0f)
            var cubicControl: PointF? = null
            var quadraticControl: PointF? = null

            when (command.uppercaseChar()) {
                'M' -> {
                    val point = point(origin) ?: return path
                    path.moveTo(point.x, point.y)
                    current = point
                    subpathStart = point
                    command = if (isRelative) 'l' else 'L' // further pairs are lines
                }

                'L' -> {
                    val point = point(origin) ?: return path
                    path.lineTo(point.x, point.y)
                    current = point
                }

                'H' -> {
                    val x = number() ?: return path
                    current = PointF(x + origin.x, current.y)
                    path.lineTo(current.x, current.y)
                }

                'V' -> {
                    val y = number() ?: return path
                    current = PointF(current.x, y + origin.y)
                    path.lineTo(current.x, current.y)
                }

                'C' -> {
                    val control1 = point(origin) ?: return path
                    val control2 = point(origin) ?: return path
                    val end = point(origin) ?: return path
                    path.cubicTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y)
                    cubicControl = control2
                    current = end
                }

                'S' -> {
                    val control2 = point(origin) ?: return path
                    val end = point(origin) ?: return path
                    val control1 = lastCubicControl?.let { reflect(it, current) } ?: current
                    path.cubicTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y)
                    cubicControl = control2
                    current = end
                }

                'Q' -> {
                    val control = point(origin) ?: return path
                    val end = point(origin) ?: return path
                    path.quadTo(control.x, control.y, end.x, end.y)
                    quadraticControl = control
                    current = end
                }

                'T' -> {
                    val end = point(origin) ?: return path
                    val control = lastQuadraticControl?.let { reflect(it, current) } ?: current
                    path.quadTo(control.x, control.y, end.x, end.y)
                    quadraticControl = control
                    current = end
                }

                'A' -> {
                    val radiusX = number() ?: return path
                    val radiusY = number() ?: return path
                    val rotation = number() ?: return path
                    val largeArc = flag() ?: return path
                    val sweep = flag() ?: return path
                    val end = point(origin) ?: return path
                    addArc(path, current, end, radiusX, radiusY, rotation, largeArc, sweep)
                    current = end
                }

                'Z' -> {
                    path.close()
                    current = subpathStart
                }

                else -> return path
            }

            lastCubicControl = cubicControl
            lastQuadraticControl = quadraticControl
        }

        return path
    }

    private fun reflect(point: PointF, center: PointF) = PointF(2 * center.x - point.x, 2 * center.y - point.y)

    private fun point(origin: PointF): PointF? {
        val x = number() ?: return null
        val y = number() ?: return null

        return PointF(x + origin.x, y + origin.y)
    }

    private fun skipSeparators() {
        while (index < text.length && (text[index].isWhitespace() || text[index] == ',')) index++
    }

    private fun flag(): Boolean? {
        skipSeparators()
        if (index >= text.length || (text[index] != '0' && text[index] != '1')) return null

        index++

        return text[index - 1] == '1'
    }

    /** "-1.5e-3", ".5" and "1.5.5" (two numbers) all parse. */
    private fun number(): Float? {
        skipSeparators()
        val start = index
        var hasDot = false

        if (index < text.length && (text[index] == '-' || text[index] == '+')) index++
        while (index < text.length) {
            val character = text[index]
            when {
                character.isDigit() -> index++
                character == '.' && !hasDot -> {
                    hasDot = true
                    index++
                }
                character == 'e' || character == 'E' -> {
                    index++
                    if (index < text.length && (text[index] == '-' || text[index] == '+')) index++
                }
                else -> break
            }
        }

        return text.substring(start, index).toFloatOrNull()
    }
}

/** An elliptical arc as cubic Béziers, one per quarter turn at most (SVG spec, appendix B.2.4). */
private fun addArc(
    path: Path,
    from: PointF,
    to: PointF,
    radiusX: Float,
    radiusY: Float,
    rotationDegrees: Float,
    largeArc: Boolean,
    sweep: Boolean,
) {
    if (from == to) return
    if (radiusX == 0f || radiusY == 0f) return path.lineTo(to.x, to.y)

    val angle = Math.toRadians(rotationDegrees.toDouble())
    val cosine = cos(angle)
    val sine = sin(angle)

    // The start point in the ellipse's own axes, relative to the chord's middle.
    val halfDeltaX = (from.x - to.x) / 2.0
    val halfDeltaY = (from.y - to.y) / 2.0
    val startX = cosine * halfDeltaX + sine * halfDeltaY
    val startY = -sine * halfDeltaX + cosine * halfDeltaY

    // Radii too small to reach the end are scaled up just enough.
    var rx = abs(radiusX.toDouble())
    var ry = abs(radiusY.toDouble())
    val radiiScale = (startX * startX) / (rx * rx) + (startY * startY) / (ry * ry)
    if (radiiScale > 1) {
        rx *= sqrt(radiiScale)
        ry *= sqrt(radiiScale)
    }

    val numerator = rx * rx * ry * ry - rx * rx * startY * startY - ry * ry * startX * startX
    val denominator = rx * rx * startY * startY + ry * ry * startX * startX
    var coefficient = sqrt(max(0.0, numerator / denominator))
    if (largeArc == sweep) coefficient = -coefficient

    val centerX = coefficient * rx * startY / ry
    val centerY = -coefficient * ry * startX / rx
    val ellipseCenterX = cosine * centerX - sine * centerY + (from.x + to.x) / 2.0
    val ellipseCenterY = sine * centerX + cosine * centerY + (from.y + to.y) / 2.0

    val startVectorX = (startX - centerX) / rx
    val startVectorY = (startY - centerY) / ry
    val endVectorX = (-startX - centerX) / rx
    val endVectorY = (-startY - centerY) / ry
    val startAngle = angleBetween(1.0, 0.0, startVectorX, startVectorY)
    var sweepAngle = angleBetween(startVectorX, startVectorY, endVectorX, endVectorY)
    if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI
    if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI

    val segmentCount = max(1, ceil(abs(sweepAngle) / (Math.PI / 2)).toInt())
    val segmentAngle = sweepAngle / segmentCount
    val handle = 4.0 / 3 * tan(segmentAngle / 4)

    // Unit-circle points mapped onto the rotated ellipse.
    fun onEllipse(x: Double, y: Double) = PointF(
        (ellipseCenterX + rx * cosine * x - ry * sine * y).toFloat(),
        (ellipseCenterY + rx * sine * x + ry * cosine * y).toFloat(),
    )

    for (segment in 0 until segmentCount) {
        val segmentStart = startAngle + segment * segmentAngle
        val segmentEnd = segmentStart + segmentAngle
        val control1 = onEllipse(cos(segmentStart) - handle * sin(segmentStart), sin(segmentStart) + handle * cos(segmentStart))
        val control2 = onEllipse(cos(segmentEnd) + handle * sin(segmentEnd), sin(segmentEnd) - handle * cos(segmentEnd))
        val end = onEllipse(cos(segmentEnd), sin(segmentEnd))
        path.cubicTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y)
    }
}

private fun angleBetween(firstX: Double, firstY: Double, secondX: Double, secondY: Double): Double =
    atan2(firstX * secondY - firstY * secondX, firstX * secondX + firstY * secondY)
