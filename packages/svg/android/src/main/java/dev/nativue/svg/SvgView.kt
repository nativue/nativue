package dev.nativue.svg

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.DashPathEffect
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PathMeasure
import android.graphics.PointF
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Region
import android.graphics.Shader
import android.graphics.Typeface
import android.os.Build
import android.view.MotionEvent
import android.view.View
import dev.nativue.PluginView
import dev.nativue.RemoteImageView
import dev.nativue.androidColor
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * View behind <svg>: draws what JS sends as `drawing`, [tag, attributes, children or text] (src/svg.ts),
 * its viewBox fitted as preserveAspectRatio says. Icons send `elements` instead, [tag, attributes] pairs
 * stroked with `color`. Mirrors ios/SvgView.swift.
 */
class SvgView(context: Context) : View(context), PluginView {
    var viewBox = RectF(0f, 0f, 24f, 24f)
        set(value) {
            field = value
            updateIconDrawing()
        }

    var strokeWidth = 2f
        set(value) {
            field = value
            updateIconDrawing()
        }

    /** currentColor. */
    var color = 0xFF000000.toInt()
        set(value) {
            field = value
            invalidate()
        }

    var elements: List<*> = emptyList<Any>()
        set(value) {
            field = value
            updateIconDrawing()
        }

    /** From JS (an <svg>'s content). An icon's `elements` draw instead, when it has them. */
    var drawing: Any? = null
        set(value) {
            field = value
            drawingRoot = SvgElement.from(value)
            rootDidChange()
        }

    /** The ids of the elements pressed, innermost first, and where (in pixels, in the view). */
    var onElementPress: ((nodeIds: List<Int>, x: Float, y: Float) -> Unit)? = null

    private var drawingRoot: SvgElement? = null
    private var iconRoot: SvgElement? = null
    private val root: SvgElement? get() = if (elements.isEmpty()) drawingRoot else iconRoot
    /** Pressable shapes as last drawn, in view coordinates, topmost last. */
    private var pressTargets: List<SvgPressTarget> = emptyList()
    private var pressedTarget: SvgPressTarget? = null
    private val images = SvgImages(context) { invalidate() }

    init {
        isClickable = false // a press on an icon presses what contains it
    }

    override fun setProp(key: String, value: Any?) {
        when (key) {
            "color" -> color = androidColor(value) ?: 0xFF000000.toInt()
            "viewBox" -> rect(value)?.let { viewBox = it }
            "elements" -> elements = value as? List<*> ?: emptyList<Any>()
            "drawing" -> drawing = value
            "strokeWidth" -> strokeWidth = (value as? Number)?.toFloat() ?: 2f
        }
    }

    override fun onDraw(canvas: Canvas) {
        val root = root ?: return
        val viewBoxMatrix = root.viewBoxMatrix(width.toFloat(), height.toFloat())
        val renderer = SvgRenderer(canvas, color, root.definitionsById(), viewBoxMatrix, resources.displayMetrics.density, images)

        canvas.save()
        canvas.clipRect(0, 0, width, height)
        canvas.concat(viewBoxMatrix)
        renderer.draw(root, SvgStyle(), emptyList())
        canvas.restore()
        pressTargets = renderer.pressTargets
    }

    /** Only a press on a pressable element is this view's: elsewhere it goes to what contains it. */
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> pressedTarget = pressTargets.lastOrNull { it.contains(event.x, event.y) }
            MotionEvent.ACTION_UP -> pressedTarget?.takeIf { it.contains(event.x, event.y) }?.let {
                onElementPress?.invoke(it.nodeIds, event.x, event.y)
            }
            MotionEvent.ACTION_CANCEL -> pressedTarget = null
        }

        return pressedTarget != null
    }

    private fun rootDidChange() {
        isClickable = root?.hasPressableElements == true
        invalidate()
    }

    /**
     * An icon: its elements, stroked with currentColor (round caps and joins, as icon sets expect), and
     * filled with it when their fill isn't "none".
     */
    private fun updateIconDrawing() {
        if (elements.isEmpty()) return rootDidChange()

        val rootAttributes = mapOf(
            "viewBox" to listOf(viewBox.left, viewBox.top, viewBox.width(), viewBox.height()),
            "fill" to "none",
            "stroke" to "currentColor",
            "stroke-width" to strokeWidth,
            "stroke-linecap" to "round",
            "stroke-linejoin" to "round",
        )
        val children = elements.filterIsInstance<List<*>>().map { element ->
            val attributes = (element.lastOrNull() as? Map<*, *>).orEmpty().toMutableMap()
            val fill = attributes["fill"]

            if (fill != null && fill.toString() != "none") attributes["fill"] = "currentColor"
            listOf(element.firstOrNull(), attributes, emptyList<Any>())
        }
        iconRoot = SvgElement.from(listOf("svg", rootAttributes, children))
        rootDidChange()
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
    }
}

/** One element of a drawing. */
private class SvgElement(
    val tag: String,
    val attributes: SvgAttributes,
    val children: List<SvgElement>,
    val text: String,
) {
    val hasPressableElements: Boolean
        get() = attributes.values["nodeId"] != null || children.any { it.hasPressableElements }

    /** Gradients, patterns, clip paths and masks, which elements refer to by id. */
    fun definitionsById(): Map<String, SvgElement> {
        val definitions = mutableMapOf<String, SvgElement>()
        val id = attributes.values["id"] as? String

        if (tag in setOf("linearGradient", "radialGradient", "pattern", "clipPath", "mask") && id != null) definitions[id] = this
        children.forEach { child -> child.definitionsById().forEach { (key, value) -> definitions.putIfAbsent(key, value) } }

        return definitions
    }

    /** The root's viewBox fitted into the view, as its preserveAspectRatio says. */
    fun viewBoxMatrix(width: Float, height: Float): Matrix {
        val viewBox = SvgView.rect(attributes.values["viewBox"]) ?: return Matrix()

        return SvgFit.matrix(viewBox, RectF(0f, 0f, width, height), attributes.text("preserveAspectRatio"))
    }

    /** Its own transform attribute. */
    val transform: Matrix?
        get() = matrixAttribute(attributes.values["transform"])

    companion object {
        fun from(value: Any?): SvgElement? {
            val parts = value as? List<*> ?: return null
            val tag = parts.firstOrNull() as? String ?: return null
            val content = parts.getOrNull(2)

            return SvgElement(
                tag,
                SvgAttributes(parts.getOrNull(1) as? Map<*, *> ?: emptyMap<String, Any>()),
                (content as? List<*>)?.mapNotNull(::from) ?: emptyList(),
                content as? String ?: "",
            )
        }
    }
}

/** [a, b, c, d, e, f], as JS sends transforms. */
private fun matrixAttribute(value: Any?): Matrix? {
    val numbers = (value as? List<*>)?.mapNotNull { (it as? Number)?.toFloat() }
    if (numbers == null || numbers.size != 6) return null

    return matrixOf(numbers)
}

/** SVG's [a, b, c, d, e, f] as an Android matrix. */
private fun matrixOf(numbers: List<Float>): Matrix = Matrix().apply {
    setValues(floatArrayOf(numbers[0], numbers[2], numbers[4], numbers[1], numbers[3], numbers[5], 0f, 0f, 1f))
}

/** fill and stroke: none, a color, currentColor, or a gradient or pattern (url(#id)). */
private sealed class SvgPaint {
    object None : SvgPaint()
    object CurrentColor : SvgPaint()
    class Color(val color: Int) : SvgPaint()
    class Reference(val id: String) : SvgPaint()

    companion object {
        fun from(value: Any?): SvgPaint? = when {
            value is Number -> androidColor(value)?.let(::Color)
            value == "none" -> None
            value == "currentColor" -> CurrentColor
            value is String && value.startsWith("url(#") -> Reference(value.removePrefix("url(#").removeSuffix(")"))
            else -> null
        }
    }
}

/** What children inherit, as SVG's presentation attributes cascade. */
private data class SvgStyle(
    val fill: SvgPaint = SvgPaint.Color(0xFF000000.toInt()),
    val stroke: SvgPaint = SvgPaint.None,
    val strokeWidth: Float = 1f,
    val fillOpacity: Float = 1f,
    val strokeOpacity: Float = 1f,
    val lineCap: Paint.Cap = Paint.Cap.BUTT,
    val lineJoin: Paint.Join = Paint.Join.MITER,
    val dashes: List<Float> = emptyList(),
    val dashOffset: Float = 0f,
    val isEvenOdd: Boolean = false,
    val letterSpacing: Float = 0f,
    val fontSize: Float = 16f,
    val isBold: Boolean = false,
    val fontFamily: String? = null,
    val textAnchor: String = "start",
    val baseline: String = "auto",
    val miterLimit: Float = 4f,
) {
    fun inheriting(attributes: SvgAttributes): SvgStyle {
        val values = attributes.values
        val weight = values["font-weight"]?.toString()

        return copy(
            fill = SvgPaint.from(values["fill"]) ?: fill,
            stroke = SvgPaint.from(values["stroke"]) ?: stroke,
            strokeWidth = attributes.optionalNumber("stroke-width") ?: strokeWidth,
            fillOpacity = attributes.optionalNumber("fill-opacity") ?: fillOpacity,
            strokeOpacity = attributes.optionalNumber("stroke-opacity") ?: strokeOpacity,
            lineCap = when (values["stroke-linecap"]) {
                "round" -> Paint.Cap.ROUND
                "square" -> Paint.Cap.SQUARE
                "butt" -> Paint.Cap.BUTT
                else -> lineCap
            },
            lineJoin = when (values["stroke-linejoin"]) {
                "round" -> Paint.Join.ROUND
                "bevel" -> Paint.Join.BEVEL
                "miter" -> Paint.Join.MITER
                else -> lineJoin
            },
            dashes = (values["stroke-dasharray"] as? List<*>)?.mapNotNull { (it as? Number)?.toFloat() } ?: dashes,
            isEvenOdd = (values["fill-rule"] as? String)?.let { it == "evenodd" } ?: isEvenOdd,
            dashOffset = attributes.optionalNumber("stroke-dashoffset") ?: dashOffset,
            letterSpacing = attributes.optionalNumber("letter-spacing") ?: letterSpacing,
            fontSize = attributes.optionalNumber("font-size") ?: fontSize,
            isBold = weight?.let { it == "bold" || (it.toIntOrNull() ?: 400) >= 600 } ?: isBold,
            fontFamily = values["font-family"] as? String ?: fontFamily,
            textAnchor = values["text-anchor"] as? String ?: textAnchor,
            baseline = (values["dominant-baseline"] ?: values["alignment-baseline"]) as? String ?: baseline,
            miterLimit = attributes.optionalNumber("stroke-miterlimit") ?: miterLimit,
        )
    }
}

private class SvgPressTarget(path: Path, val nodeIds: List<Int>) {
    private val region = Region().apply {
        val bounds = RectF().also { path.computeBounds(it, true) }
        setPath(path, Region(bounds.left.toInt() - 1, bounds.top.toInt() - 1, bounds.right.toInt() + 1, bounds.bottom.toInt() + 1))
    }

    fun contains(x: Float, y: Float) = region.contains(x.roundToInt(), y.roundToInt())
}

/** Draws elements into a canvas already scaled to the viewBox, and notes what can be pressed. */
private class SvgRenderer(
    private val canvas: Canvas,
    private val currentColor: Int,
    private val definitions: Map<String, SvgElement>,
    viewBoxMatrix: Matrix,
    private val density: Float,
    private val images: SvgImages,
) {
    val pressTargets = mutableListOf<SvgPressTarget>()
    /** From the element's coordinates to the view's: Canvas.getMatrix is deprecated. */
    private var toView = Matrix(viewBoxMatrix)
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

    fun draw(element: SvgElement, inherited: SvgStyle, pressableAncestors: List<Int>) {
        if (element.tag in DEFINITION_TAGS) return

        val style = inherited.inheriting(element.attributes)
        val nodeId = (element.attributes.values["nodeId"] as? Number)?.toInt()
        val pressable = listOfNotNull(nodeId) + pressableAncestors
        val opacity = element.attributes.optionalNumber("opacity") ?: 1f
        val shadow = (element.attributes.values["shadow"] as? List<*>)?.mapNotNull { it as? Number }
        val blur = element.attributes.number("blur")
        val savedToView = Matrix(toView)

        // Opacity applies to the element as a whole, overlaps included: drawn apart, then blended.
        val saveCount = if (opacity < 1f) canvas.saveLayerAlpha(null, (opacity * 255).roundToInt()) else canvas.save()
        element.transform?.let { transform ->
            canvas.concat(transform)
            toView.preConcat(transform)
        }
        applyClipPath(element)

        val mask = definition("mask", element, "mask")
        val contentLayer = if (mask != null) canvas.saveLayer(null, null) else null

        when {
            blur > 0 -> drawBlurred(element, style, pressable, blur)
            shadow != null && shadow.size == 4 -> drawShadow(element, style, pressable, shadow)
            else -> drawContent(element, style, pressable)
        }
        if (mask != null && contentLayer != null) applyMask(mask, contentLayer)

        canvas.restoreToCount(saveCount)
        toView = savedToView
    }

    private fun drawContent(element: SvgElement, style: SvgStyle, pressable: List<Int>) {
        when (element.tag) {
            "svg", "g" -> {
                // An <svg @press>: anywhere in it, under its elements.
                val nodeId = (element.attributes.values["nodeId"] as? Number)?.toInt()
                if (element.tag == "svg" && nodeId != null) {
                    val viewport = Path().apply { addRect(RectF(canvas.clipBounds), Path.Direction.CW) }
                    viewport.transform(toView)
                    pressTargets.add(SvgPressTarget(viewport, listOf(nodeId)))
                }
                element.children.forEach { draw(it, style, pressable) }
            }
            "text" -> drawText(element, style, pressable)
            "image" -> drawImage(element, pressable)
            else -> SvgShapes.path(element.tag, element.attributes)?.let { drawShape(it, style, pressable) }
        }
    }

    /** <image>: its picture fitted into x, y, width and height as preserveAspectRatio says, once loaded. */
    private fun drawImage(element: SvgElement, pressable: List<Int>) {
        val attributes = element.attributes
        val source = (attributes.values["href"] ?: attributes.values["xlink:href"]) as? String ?: return
        val bitmap = images.bitmap(source) ?: return
        val imageWidth = bitmap.width / density
        val imageHeight = bitmap.height / density
        val left = attributes.number("x")
        val top = attributes.number("y")
        val frame = RectF(
            left,
            top,
            left + (attributes.optionalNumber("width") ?: imageWidth),
            top + (attributes.optionalNumber("height") ?: imageHeight),
        )
        val fit = SvgFit.matrix(RectF(0f, 0f, imageWidth, imageHeight), frame, attributes.text("preserveAspectRatio"))

        canvas.save()
        canvas.clipRect(frame)
        canvas.concat(fit)
        canvas.drawBitmap(bitmap, null, RectF(0f, 0f, imageWidth, imageHeight), Paint(Paint.FILTER_BITMAP_FLAG))
        canvas.restore()

        if (pressable.isEmpty()) return

        val area = Path().apply { addRect(frame, Path.Direction.CW) }
        area.transform(toView)
        pressTargets.add(SvgPressTarget(area, pressable))
    }

    /** blur, an <feGaussianBlur>'s deviation in the drawing's units: the element drawn apart, blurred, then drawn. */
    private fun drawBlurred(element: SvgElement, style: SvgStyle, pressable: List<Int>, deviation: Float) {
        val scale = hypot(toViewValue(Matrix.MSCALE_X), toViewValue(Matrix.MSKEW_Y))
        val radius = deviation * scale
        val area = shadowArea(element, style, scale, radius)
        val bitmap = Bitmap.createBitmap(area.width(), area.height(), Bitmap.Config.ARGB_8888)
        val offscreen = Canvas(bitmap).apply {
            translate(-area.left.toFloat(), -area.top.toFloat())
            concat(toView)
        }
        val offscreenRenderer = SvgRenderer(offscreen, currentColor, definitions, toView, density, images)
        offscreenRenderer.drawContent(element, style, pressable)
        pressTargets.addAll(offscreenRenderer.pressTargets)
        SvgBlur.blur(bitmap, radius)

        canvas.save()
        canvas.concat(Matrix().also(toView::invert))
        canvas.drawBitmap(bitmap, area.left.toFloat(), area.top.toFloat(), null)
        canvas.restore()
        bitmap.recycle()
    }

    /** The element referred to by an attribute's url(#id). */
    private fun definition(attribute: String, element: SvgElement, tag: String): SvgElement? {
        val reference = element.attributes.text(attribute)
        if (!reference.startsWith("url(#")) return null

        return definitions[reference.removePrefix("url(#").removeSuffix(")")]?.takeIf { it.tag == tag }
    }

    /** clip-path="url(#id)": only what its shapes cover is drawn. */
    private fun applyClipPath(element: SvgElement) {
        val clipPath = definition("clip-path", element, "clipPath") ?: return
        val shapes = SvgShapes.combinedPath(clipPath.children)
        val transform = clipPath.transform ?: Matrix()

        if (clipPath.attributes.text("clipPathUnits") == "objectBoundingBox") {
            val box = SvgShapes.boundingBox(element)
            transform.postConcat(Matrix().apply { setScale(box.width(), box.height()); postTranslate(box.left, box.top) })
        }
        shapes.transform(transform)
        if (clipPath.children.firstOrNull()?.attributes?.text("clip-rule") == "evenodd") shapes.fillType = Path.FillType.EVEN_ODD
        canvas.clipPath(shapes)
    }

    /** mask="url(#id)": the content drawn so far stays where the mask's content is light (its luminance). */
    private fun applyMask(mask: SvgElement, contentLayer: Int) {
        val maskPaint = Paint().apply {
            xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
            colorFilter = ColorMatrixColorFilter(LUMINANCE_TO_ALPHA)
        }
        canvas.saveLayer(null, maskPaint)
        val maskRenderer = SvgRenderer(canvas, currentColor, definitions, toView, density, images)
        mask.children.forEach { maskRenderer.draw(it, SvgStyle(), emptyList()) }
        canvas.restoreToCount(contentLayer)
    }

    /**
     * shadow, [dx, dy, blur, color] (from an <feDropShadow>), in the drawing's units: the element is drawn
     * apart, its shape blurred into the shadow, then both drawn.
     */
    private fun drawShadow(element: SvgElement, style: SvgStyle, pressable: List<Int>, shadow: List<Number>) {
        val scale = hypot(toViewValue(Matrix.MSCALE_X), toViewValue(Matrix.MSKEW_Y))
        val blur = shadow[2].toFloat() * scale
        val area = shadowArea(element, style, scale, blur)
        val bitmap = Bitmap.createBitmap(area.width(), area.height(), Bitmap.Config.ARGB_8888)
        val offscreen = Canvas(bitmap).apply {
            translate(-area.left.toFloat(), -area.top.toFloat())
            concat(toView)
        }
        val offscreenRenderer = SvgRenderer(offscreen, currentColor, definitions, toView, density, images)
        offscreenRenderer.drawContent(element, style, pressable)
        pressTargets.addAll(offscreenRenderer.pressTargets)

        val offset = IntArray(2)
        val shape = bitmap.extractAlpha(Paint().apply { if (blur > 0) maskFilter = BlurMaskFilter(blur, BlurMaskFilter.Blur.NORMAL) }, offset)
        val shadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = androidColor(shadow[3]) ?: 0xFF000000.toInt() }
        val toCanvas = Matrix().also(toView::invert)

        canvas.save()
        canvas.concat(toCanvas)
        canvas.drawBitmap(
            shape,
            area.left + offset[0] + shadow[0].toFloat() * scale,
            area.top + offset[1] + shadow[1].toFloat() * scale,
            shadowPaint,
        )
        canvas.drawBitmap(bitmap, area.left.toFloat(), area.top.toFloat(), null)
        canvas.restore()
        shape.recycle()
        bitmap.recycle()
    }

    /** The element's box in the view, with room for its stroke and blur; the whole view when it has none (text). */
    private fun shadowArea(element: SvgElement, style: SvgStyle, scale: Float, blur: Float): Rect {
        val view = Rect(0, 0, canvas.width.coerceAtLeast(1), canvas.height.coerceAtLeast(1))
        val bounds = SvgShapes.boundingBox(element).also(toView::mapRect)
        if (bounds.isEmpty) return view

        val margin = style.strokeWidth * scale + blur * 3
        val area = Rect()

        bounds.inset(-margin, -margin)
        bounds.roundOut(area)

        return if (area.intersect(view)) area else view
    }

    private fun drawShape(shape: Path, style: SvgStyle, pressable: List<Int>) {
        shape.fillType = if (style.isEvenOdd) Path.FillType.EVEN_ODD else Path.FillType.WINDING
        if (configure(style.fill, style.fillOpacity, shape)) {
            paint.style = Paint.Style.FILL
            canvas.drawPath(shape, paint)
        }
        if (configure(style.stroke, style.strokeOpacity, shape)) {
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = style.strokeWidth
            paint.strokeCap = style.lineCap
            paint.strokeJoin = style.lineJoin
            paint.strokeMiter = style.miterLimit
            paint.pathEffect = style.dashes.takeIf { it.isNotEmpty() }?.let {
                // An odd list repeats, as SVG reads it.
                val intervals = if (it.size % 2 == 0) it else it + it
                DashPathEffect(intervals.toFloatArray(), style.dashOffset)
            }
            canvas.drawPath(shape, paint)
            paint.pathEffect = null
        }

        if (pressable.isEmpty()) return

        // A thin line is hard to hit: at least 44dp wide, like the targets of iOS's guidelines.
        val scale = max(hypot(toViewValue(Matrix.MSCALE_X), toViewValue(Matrix.MSKEW_Y)), 0.01f)
        val area = Path()
        val touchWidth = max(style.strokeWidth, 44 * density / scale)
        val outline = Paint().apply {
            this.style = Paint.Style.STROKE
            strokeWidth = touchWidth
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        val strokeArea = Path()

        if (style.fill !is SvgPaint.None) area.addPath(shape)
        outline.getFillPath(shape, strokeArea)
        area.addPath(strokeArea)
        area.transform(toView)
        pressTargets.add(SvgPressTarget(area, pressable))
    }

    /** <text>'s runs: a run with its own x starts a chunk, which text-anchor places. */
    private fun drawText(element: SvgElement, style: SvgStyle, pressable: List<Int>) {
        element.children.filter { it.tag == "textPath" }.forEach { drawTextAlongPath(it, style.inheriting(it.attributes)) }

        val runs = element.children.filter { it.tag != "textPath" }.map { it to style.inheriting(it.attributes) }
        var penX = element.attributes.number("x") + element.attributes.number("dx")
        var penY = element.attributes.number("y") + element.attributes.number("dy")
        val textBox = RectF()
        var index = 0

        while (index < runs.size) {
            var end = index + 1
            while (end < runs.size && runs[end].first.attributes.optionalNumber("x") == null) end++

            val chunk = runs.subList(index, end)
            val chunkWidth = chunk.sumOf { (run, runStyle) -> configureText(runStyle).measureText(run.text).toDouble() }.toFloat()
            val anchorOffset = when (chunk.first().second.textAnchor) {
                "middle" -> chunkWidth / 2
                "end" -> chunkWidth
                else -> 0f
            }

            chunk.forEachIndexed { position, (run, runStyle) ->
                run.attributes.optionalNumber("x")?.let { penX = it }
                run.attributes.optionalNumber("y")?.let { penY = it }
                penX += run.attributes.number("dx") - if (position == 0) anchorOffset else 0f
                penY += run.attributes.number("dy")

                val textPaint = configureText(runStyle)
                val width = textPaint.measureText(run.text)
                // y is the baseline, as drawText takes it, unless dominant-baseline moves it.
                val baselineY = penY + baselineShift(textPaint, runStyle.baseline)
                if (textPaint.color != 0) canvas.drawText(run.text, penX, baselineY, textPaint)
                textBox.union(penX, baselineY + textPaint.ascent(), penX + width, baselineY + textPaint.descent())
                penX += width
            }
            index = end
        }

        if (pressable.isEmpty() || textBox.isEmpty) return

        val box = Path().apply { addRect(textBox, Path.Direction.CW) }
        box.transform(toView)
        pressTargets.add(SvgPressTarget(box, pressable))
    }

    /** <textPath>: its text along the path, from startOffset (a length, or a percentage of the path's). */
    private fun drawTextAlongPath(run: SvgElement, style: SvgStyle) {
        val path = SvgPathParser(run.attributes.text("d")).parse()
        matrixAttribute(run.attributes.values["pathTransform"])?.let(path::transform)

        val textPaint = configureText(style)
        if (textPaint.color == 0) return

        val length = PathMeasure(path, false).length
        val width = textPaint.measureText(run.text)
        val startOffset = run.attributes.text("startOffset")
        val offset = if (startOffset.endsWith("%")) (startOffset.dropLast(1).toFloatOrNull() ?: 0f) / 100 * length else run.attributes.number("startOffset")
        val anchorOffset = when (style.textAnchor) {
            "middle" -> width / 2
            "end" -> width
            else -> 0f
        }

        canvas.drawTextOnPath(run.text, path, offset - anchorOffset, baselineShift(textPaint, style.baseline), textPaint)
    }

    /** dominant-baseline: where y falls on the text, as a shift of the baseline. */
    private fun baselineShift(textPaint: Paint, baseline: String): Float = when (baseline) {
        "middle", "central" -> -(textPaint.ascent() + textPaint.descent()) / 2
        "hanging", "text-before-edge", "text-top" -> -textPaint.ascent()
        "text-after-edge", "text-bottom", "ideographic" -> -textPaint.descent()
        else -> 0f
    }

    /** The paint for a run: its color (0 for none), font and spacing, left-aligned (runs are placed by hand). */
    private fun configureText(style: SvgStyle): Paint {
        val color = resolved(style.fill) as? SvgPaint.Color

        paint.reset()
        paint.isAntiAlias = true
        paint.style = Paint.Style.FILL
        paint.color = color?.let { withOpacity(it.color, style.fillOpacity) } ?: 0
        paint.textSize = style.fontSize
        paint.typeface = Typeface.create(style.fontFamily, if (style.isBold) Typeface.BOLD else Typeface.NORMAL)
        paint.letterSpacing = if (style.fontSize > 0) style.letterSpacing / style.fontSize else 0f
        paint.textAlign = Paint.Align.LEFT

        return paint
    }

    private fun toViewValue(index: Int): Float = FloatArray(9).also(toView::getValues)[index]

    private fun resolved(paint: SvgPaint): SvgPaint =
        if (paint is SvgPaint.CurrentColor) SvgPaint.Color(currentColor) else paint

    /** Sets up the paint for a fill or a stroke; false when there's nothing to draw. */
    private fun configure(svgPaint: SvgPaint, opacity: Float, shape: Path): Boolean {
        paint.reset()
        paint.isAntiAlias = true

        return when (val resolved = resolved(svgPaint)) {
            is SvgPaint.Color -> {
                paint.color = withOpacity(resolved.color, opacity)
                true
            }
            is SvgPaint.Reference -> {
                val definition = definitions[resolved.id] ?: return false
                val bounds = RectF().also { shape.computeBounds(it, true) }
                paint.shader = (if (definition.tag == "pattern") patternShader(definition, bounds) else SvgGradients.shader(definition, bounds))
                    ?: return false
                paint.alpha = (opacity * 255).roundToInt()
                true
            }
            else -> false
        }
    }

    /** A <pattern>'s tile drawn once, at the view's resolution, and repeated by the shader over the shape. */
    private fun patternShader(pattern: SvgElement, bounds: RectF): Shader? {
        val attributes = pattern.attributes
        val isInBox = attributes.text("patternUnits") != "userSpaceOnUse"
        val tile = RectF(attributes.number("x"), attributes.number("y"), 0f, 0f).apply {
            right = left + attributes.number("width")
            bottom = top + attributes.number("height")
        }
        if (isInBox) {
            tile.set(
                bounds.left + tile.left * bounds.width(),
                bounds.top + tile.top * bounds.height(),
                bounds.left + tile.right * bounds.width(),
                bounds.top + tile.bottom * bounds.height(),
            )
        }
        if (tile.width() <= 0f || tile.height() <= 0f) return null

        val patternTransform = matrixAttribute(attributes.values["patternTransform"])
        val scale = hypot(toViewValue(Matrix.MSCALE_X), toViewValue(Matrix.MSKEW_Y)) *
            (patternTransform?.let { FloatArray(9).also(it::getValues).let { values -> hypot(values[0], values[3]) } } ?: 1f)
        val tileWidth = (tile.width() * scale).roundToInt().coerceIn(1, 2048)
        val tileHeight = (tile.height() * scale).roundToInt().coerceIn(1, 2048)
        val bitmap = Bitmap.createBitmap(tileWidth, tileHeight, Bitmap.Config.ARGB_8888)
        val content = SvgView.rect(attributes.values["viewBox"])?.let {
            SvgFit.matrix(it, RectF(0f, 0f, tile.width(), tile.height()), attributes.text("preserveAspectRatio"))
        } ?: Matrix().apply {
            if (attributes.text("patternContentUnits") == "objectBoundingBox") setScale(bounds.width(), bounds.height())
        }
        val tileCanvas = Canvas(bitmap).apply {
            scale(tileWidth / tile.width(), tileHeight / tile.height())
            concat(content)
        }
        val tileRenderer = SvgRenderer(tileCanvas, currentColor, definitions, Matrix(), density, images)
        pattern.children.forEach { tileRenderer.draw(it, SvgStyle(), emptyList()) }

        val shaderMatrix = Matrix().apply {
            setScale(tile.width() / tileWidth, tile.height() / tileHeight)
            postTranslate(tile.left, tile.top)
            patternTransform?.let(::postConcat)
        }

        return BitmapShader(bitmap, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT).apply { setLocalMatrix(shaderMatrix) }
    }

    private fun withOpacity(color: Int, opacity: Float): Int {
        val alpha = ((color ushr 24) * opacity).roundToInt().coerceIn(0, 255)

        return (color and 0xFFFFFF) or (alpha shl 24)
    }

    companion object {
        /** Referred to by id (url(#id), href), not drawn where they are. */
        val DEFINITION_TAGS = setOf(
            "defs", "linearGradient", "radialGradient", "stop", "pattern", "symbol", "clipPath", "mask",
        )

        /** A mask's luminance as alpha, as SVG's luminance masks read it. */
        private val LUMINANCE_TO_ALPHA = ColorMatrix(
            floatArrayOf(
                0f, 0f, 0f, 0f, 0f,
                0f, 0f, 0f, 0f, 0f,
                0f, 0f, 0f, 0f, 0f,
                0.2125f, 0.7154f, 0.0721f, 0f, 0f,
            ),
        )
    }
}

/**
 * <linearGradient> and <radialGradient>: coordinates in the shape's box (objectBoundingBox, the default) or
 * in the drawing's (userSpaceOnUse).
 */
private object SvgGradients {
    fun shader(element: SvgElement, bounds: RectF): Shader? {
        val stops = element.children.filter { it.tag == "stop" }
        if (stops.isEmpty()) return null

        val colors = stops.map { stop ->
            val color = (SvgPaint.from(stop.attributes.values["stop-color"]) as? SvgPaint.Color)?.color ?: 0xFF000000.toInt()
            val opacity = stop.attributes.optionalNumber("stop-opacity") ?: 1f
            val alpha = ((color ushr 24) * opacity).roundToInt().coerceIn(0, 255)

            (color and 0xFFFFFF) or (alpha shl 24)
        }.toIntArray()
        val positions = stops.map { (it.attributes.optionalNumber("offset") ?: 0f).coerceIn(0f, 1f) }.toFloatArray()
        val attributes = element.attributes
        val tileMode = when (attributes.text("spreadMethod")) {
            "reflect" -> Shader.TileMode.MIRROR
            "repeat" -> Shader.TileMode.REPEAT
            else -> Shader.TileMode.CLAMP
        }
        val shader = if (element.tag == "linearGradient") {
            LinearGradient(
                attributes.optionalNumber("x1") ?: 0f,
                attributes.optionalNumber("y1") ?: 0f,
                attributes.optionalNumber("x2") ?: 1f,
                attributes.optionalNumber("y2") ?: 0f,
                colors,
                positions,
                tileMode,
            )
        } else {
            radialGradient(attributes, colors, positions, tileMode)
        }
        val matrix = Matrix()

        (attributes.values["gradientTransform"] as? List<*>)?.mapNotNull { (it as? Number)?.toFloat() }
            ?.takeIf { it.size == 6 }
            ?.let { matrix.set(matrixOf(it)) }
        if (attributes.text("gradientUnits") != "userSpaceOnUse") {
            matrix.postScale(bounds.width(), bounds.height())
            matrix.postTranslate(bounds.left, bounds.top)
        }
        shader.setLocalMatrix(matrix)

        return shader
    }
}

/** A viewBox fitted into a frame as preserveAspectRatio says, like src/svg.ts's viewBoxFit. */
private object SvgFit {
    fun matrix(viewBox: RectF, frame: RectF, preserveAspectRatio: String): Matrix {
        val matrix = Matrix()
        if (viewBox.width() <= 0f || viewBox.height() <= 0f) return matrix

        val parts = preserveAspectRatio.trim().split(Regex("\\s+"))
        val align = parts.first().ifEmpty { "xMidYMid" }
        var scaleX = frame.width() / viewBox.width()
        var scaleY = frame.height() / viewBox.height()

        if (align != "none") {
            val scale = if (parts.getOrNull(1) == "slice") max(scaleX, scaleY) else min(scaleX, scaleY)
            scaleX = scale
            scaleY = scale
        }

        matrix.setTranslate(-viewBox.left, -viewBox.top)
        matrix.postScale(scaleX, scaleY)
        matrix.postTranslate(
            frame.left + alignment(align, 1) * (frame.width() - viewBox.width() * scaleX),
            frame.top + alignment(align, 5) * (frame.height() - viewBox.height() * scaleY),
        )

        return matrix
    }

    /** "xMinYMax": Min at 1 (x), Max at 5 (y). */
    private fun alignment(align: String, offset: Int): Float = when (align.substring(offset.coerceAtMost(align.length), (offset + 3).coerceAtMost(align.length))) {
        "Min" -> 0f
        "Max" -> 1f
        else -> 0.5f
    }
}

/** <image>s' pictures, loaded as <Image> loads them; [onLoad] redraws the view as each arrives. */
private class SvgImages(private val context: Context, private val onLoad: () -> Unit) {
    private val bitmapsBySource = mutableMapOf<String, Bitmap>()
    private val loadingSources = mutableSetOf<String>()

    fun bitmap(source: String): Bitmap? {
        bitmapsBySource[source]?.let { return it }
        if (!loadingSources.add(source)) return null

        RemoteImageView.loadBitmap(context, source) { bitmap ->
            bitmapsBySource[source] = bitmap
            onLoad()
        }

        return null
    }
}

/**
 * Three box blurs in a row, close to a Gaussian of deviation [radius] pixels: Android has no blur for a
 * bitmap's colors before RenderEffect, which draws only on views.
 */
private object SvgBlur {
    fun blur(bitmap: Bitmap, radius: Float) {
        val width = bitmap.width
        val height = bitmap.height
        // Three passes of a box this wide have the Gaussian's variance: r(r + 1) = deviation².
        val boxRadius = max(1, ((sqrt(4 * radius * radius + 1) - 1) / 2).roundToInt())
        val pixels = IntArray(width * height).also { bitmap.getPixels(it, 0, width, 0, 0, width, height) }
        val buffer = IntArray(pixels.size)

        repeat(3) {
            boxBlur(pixels, buffer, width, height, boxRadius, horizontal = true)
            boxBlur(buffer, pixels, width, height, boxRadius, horizontal = false)
        }
        bitmap.setPixels(pixels, 0, width, 0, 0, width, height)
    }

    /** One pass along rows (or columns), each channel averaged over 2 × radius + 1 pixels, edges transparent. */
    private fun boxBlur(source: IntArray, target: IntArray, width: Int, height: Int, radius: Int, horizontal: Boolean) {
        val lines = if (horizontal) height else width
        val length = if (horizontal) width else height
        val window = 2 * radius + 1
        val sums = IntArray(4)

        for (line in 0 until lines) {
            val indexOf = { position: Int -> if (horizontal) line * width + position else position * width + line }
            sums.fill(0)
            for (position in 0 until min(radius, length)) addPixel(sums, source[indexOf(position)], 1)

            for (position in 0 until length) {
                val entering = position + radius
                val leaving = position - radius - 1
                if (entering < length) addPixel(sums, source[indexOf(entering)], 1)
                if (leaving >= 0) addPixel(sums, source[indexOf(leaving)], -1)
                target[indexOf(position)] = averagePixel(sums, window)
            }
        }
    }

    // Colors weighed by their alpha (premultiplied), or transparent pixels would darken the edges.
    private fun addPixel(sums: IntArray, pixel: Int, sign: Int) {
        val alpha = pixel ushr 24

        sums[0] += sign * alpha
        sums[1] += sign * (pixel shr 16 and 0xFF) * alpha
        sums[2] += sign * (pixel shr 8 and 0xFF) * alpha
        sums[3] += sign * (pixel and 0xFF) * alpha
    }

    private fun averagePixel(sums: IntArray, window: Int): Int {
        if (sums[0] <= 0) return 0

        val channel = { sum: Int -> (sum / sums[0]).coerceIn(0, 255) }

        return (sums[0] / window shl 24) or (channel(sums[1]) shl 16) or (channel(sums[2]) shl 8) or channel(sums[3])
    }
}

/** fx and fy move the focus off the center, which takes the two-point constructor of Android 12. */
private fun radialGradient(attributes: SvgAttributes, colors: IntArray, positions: FloatArray, tileMode: Shader.TileMode): Shader {
    val centerX = attributes.optionalNumber("cx") ?: 0.5f
    val centerY = attributes.optionalNumber("cy") ?: 0.5f
    val radius = max(attributes.optionalNumber("r") ?: 0.5f, 0.0001f)
    val focusX = attributes.optionalNumber("fx") ?: centerX
    val focusY = attributes.optionalNumber("fy") ?: centerY
    val hasFocus = focusX != centerX || focusY != centerY

    if (!hasFocus || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        return RadialGradient(centerX, centerY, radius, colors, positions, tileMode)
    }

    val packedColors = LongArray(colors.size) { Color.pack(colors[it]) }

    return RadialGradient(focusX, focusY, 0f, centerX, centerY, radius, packedColors, positions, tileMode)
}

private object SvgShapes {
    /** A <clipPath>'s shapes as one path, each in its place (its transform). */
    fun combinedPath(elements: List<SvgElement>): Path {
        val combined = Path()

        for (element in elements) {
            val shape = if (element.tag == "g") combinedPath(element.children) else path(element.tag, element.attributes)
            shape ?: continue
            element.transform?.let(shape::transform)
            combined.addPath(shape)
        }

        return combined
    }

    /** For objectBoundingBox units: the box of what the element draws, in its own coordinates. */
    fun boundingBox(element: SvgElement): RectF {
        val shape = if (element.tag == "g" || element.tag == "svg") {
            combinedPath(element.children)
        } else {
            path(element.tag, element.attributes)
        }

        return RectF().also { shape?.computeBounds(it, true) }
    }

    fun path(tag: String, attributes: SvgAttributes): Path? = when (tag) {
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

/** Attribute values arrive as strings ("12") or numbers. */
private class SvgAttributes(val values: Map<*, *>) {
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
