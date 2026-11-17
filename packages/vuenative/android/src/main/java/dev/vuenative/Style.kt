package dev.vuenative

import android.graphics.Typeface
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import com.facebook.yoga.YogaAlign
import com.facebook.yoga.YogaDisplay
import com.facebook.yoga.YogaEdge
import com.facebook.yoga.YogaFlexDirection
import com.facebook.yoga.YogaGutter
import com.facebook.yoga.YogaJustify
import com.facebook.yoga.YogaNode
import com.facebook.yoga.YogaOverflow
import com.facebook.yoga.YogaPositionType
import com.facebook.yoga.YogaWrap

// ponytail: removed layout properties arrive as null and keep their last value, like on iOS.

/** Receives only the properties that changed: the JS renderer diffs style objects before sending. */
fun NativeNode.applyStyle(changes: Map<String, Any?>) {
    for ((property, value) in changes) {
        if (isDrivenByInsets(property)) continue

        if (value != null) layoutPropertySetters[property]?.invoke(yogaNode, value)
        // Some properties are both: overflow also clips the view.
        applyVisualProperty(property, value)
    }

    if ("fontSize" in changes || "fontWeight" in changes) applyFont(changes)
}

/** Safe area and keyboard insets drive these paddings, so style values would fight them. */
private fun NativeNode.isDrivenByInsets(property: String): Boolean = when (view) {
    is SafeAreaView -> property.startsWith("padding")
    is KeyboardAvoidingView -> property == "paddingBottom"
    else -> false
}

private fun NativeNode.applyVisualProperty(property: String, value: Any?) {
    val textView = view as? TextView

    when (property) {
        "backgroundColor" -> updateBox { backgroundColor = androidColor(value) ?: 0 }
        "borderRadius" -> updateBox { cornerRadius = pixels(value) }
        "borderWidth" -> updateBox { borderWidth = pixels(value) }
        "borderColor" -> updateBox { borderColor = androidColor(value) ?: 0 }
        "shadowColor" -> updateBox { shadowColor = androidColor(value) ?: 0xFF000000.toInt() }
        "shadowOpacity" -> updateBox { shadowOpacity = number(value) ?: 0f }
        "shadowRadius" -> updateBox { shadowRadius = pixels(value ?: 3) }
        "shadowOffset" -> updateBox {
            val offset = value as? Map<*, *>
            shadowOffsetX = pixels(offset?.get("width") ?: 0)
            shadowOffsetY = pixels(offset?.get("height") ?: -3)
        }
        "opacity" -> view.alpha = number(value) ?: 1f
        "transform" -> view.applyTransform(value)
        "overflow" -> setClipsContent(value == "hidden")
        "color" -> androidColor(value)?.let { textView?.setTextColor(it) }
        "textAlign" -> textView?.gravity = textGravities[value] ?: Gravity.START
    }
}

private fun NativeNode.updateBox(change: BoxDrawable.() -> Unit) {
    box.change()
    box.invalidateSelf()
    view.invalidateOutline()
}

private fun NativeNode.setClipsContent(clips: Boolean) {
    (view as? ViewGroup)?.clipChildren = clips
    view.clipToOutline = clips // rounded corners clip too: the outline comes from the background
}

/**
 * [{ translateX }, { translateY }, { scale }, { scaleX }, { scaleY }, { rotate: '45deg' | '1rad' | radians }].
 * Android composes them in its own order (scale, rotate, translate), not the list's.
 */
fun View.applyTransform(value: Any?) {
    val steps = (value as? List<*>)?.filterIsInstance<Map<*, *>>() ?: emptyList()
    val amounts = steps.associate { step -> step.keys.first() as String to step.values.first() }
    val scale = number(amounts["scale"]) ?: 1f
    val density = resources.displayMetrics.density

    translationX = (number(amounts["translateX"]) ?: 0f) * density
    translationY = (number(amounts["translateY"]) ?: 0f) * density
    scaleX = scale * (number(amounts["scaleX"]) ?: 1f)
    scaleY = scale * (number(amounts["scaleY"]) ?: 1f)
    rotation = degrees(amounts["rotate"])
}

/** Strings say their unit; numbers (from Animated) are radians. */
private fun degrees(value: Any?): Float {
    if (value is Number) return Math.toDegrees(value.toDouble()).toFloat()

    val text = value as? String ?: return 0f
    val amount = text.trimEnd('d', 'e', 'g', 'r', 'a').toFloatOrNull() ?: return 0f

    return if (text.endsWith("rad")) Math.toDegrees(amount.toDouble()).toFloat() else amount
}

/** Font size and weight can change independently, so the node remembers both. */
private fun NativeNode.applyFont(changes: Map<String, Any?>) {
    number(changes["fontSize"])?.let { fontSize = it }
    changes["fontWeight"]?.let { weightName -> fontWeight = fontWeightOf(weightName) }

    val textView = view as? TextView ?: return
    textView.setTextSize(TypedValue.COMPLEX_UNIT_DIP, fontSize)
    textView.typeface = Typeface.create(Typeface.DEFAULT, fontWeight, false)

    markContentChanged()
}

private fun NativeNode.pixels(value: Any?): Float = (number(value) ?: 0f) * view.resources.displayMetrics.density

fun number(value: Any?): Float? = (value as? Number)?.toFloat()

/** Colors arrive as 0xRRGGBBAA numbers (src/colors.ts parses every CSS format); Android's are ARGB. */
fun androidColor(value: Any?): Int? {
    val rgba = (value as? Number)?.toLong()?.toInt() ?: return null

    return (rgba ushr 8) or (rgba shl 24)
}

// ---------- CSS value tables ----------

private val edgesBySuffix = mapOf(
    "" to YogaEdge.ALL,
    "Horizontal" to YogaEdge.HORIZONTAL,
    "Vertical" to YogaEdge.VERTICAL,
    "Top" to YogaEdge.TOP,
    "Bottom" to YogaEdge.BOTTOM,
    "Left" to YogaEdge.LEFT,
    "Right" to YogaEdge.RIGHT,
    "Start" to YogaEdge.START,
    "End" to YogaEdge.END,
)

private val positionEdges = mapOf(
    "top" to YogaEdge.TOP,
    "bottom" to YogaEdge.BOTTOM,
    "left" to YogaEdge.LEFT,
    "right" to YogaEdge.RIGHT,
    "start" to YogaEdge.START,
    "end" to YogaEdge.END,
)

private val flexDirections = mapOf(
    "row" to YogaFlexDirection.ROW,
    "row-reverse" to YogaFlexDirection.ROW_REVERSE,
    "column" to YogaFlexDirection.COLUMN,
    "column-reverse" to YogaFlexDirection.COLUMN_REVERSE,
)

private val justifications = mapOf(
    "flex-start" to YogaJustify.FLEX_START,
    "center" to YogaJustify.CENTER,
    "flex-end" to YogaJustify.FLEX_END,
    "space-between" to YogaJustify.SPACE_BETWEEN,
    "space-around" to YogaJustify.SPACE_AROUND,
    "space-evenly" to YogaJustify.SPACE_EVENLY,
)

private val alignments = mapOf(
    "auto" to YogaAlign.AUTO,
    "flex-start" to YogaAlign.FLEX_START,
    "center" to YogaAlign.CENTER,
    "flex-end" to YogaAlign.FLEX_END,
    "stretch" to YogaAlign.STRETCH,
    "baseline" to YogaAlign.BASELINE,
    "space-between" to YogaAlign.SPACE_BETWEEN,
    "space-around" to YogaAlign.SPACE_AROUND,
    "space-evenly" to YogaAlign.SPACE_EVENLY,
)

private val wraps = mapOf(
    "nowrap" to YogaWrap.NO_WRAP,
    "wrap" to YogaWrap.WRAP,
    "wrap-reverse" to YogaWrap.WRAP_REVERSE,
)

private val positionTypes = mapOf(
    "relative" to YogaPositionType.RELATIVE,
    "absolute" to YogaPositionType.ABSOLUTE,
    "static" to YogaPositionType.STATIC,
)

private val displays = mapOf("flex" to YogaDisplay.FLEX, "none" to YogaDisplay.NONE)

private val overflows = mapOf(
    "visible" to YogaOverflow.VISIBLE,
    "hidden" to YogaOverflow.HIDDEN,
    "scroll" to YogaOverflow.SCROLL,
)

private val textGravities = mapOf(
    "auto" to Gravity.START,
    "left" to Gravity.LEFT,
    "center" to Gravity.CENTER_HORIZONTAL,
    "right" to Gravity.RIGHT,
    "justify" to Gravity.START,
)

// ---------- Layout properties (Yoga) ----------

private typealias LayoutPropertySetter = (YogaNode, Any) -> Unit

private val layoutPropertySetters: Map<String, LayoutPropertySetter> = buildMap {
    put("flexDirection", enumSetter(flexDirections, YogaNode::setFlexDirection))
    put("justifyContent", enumSetter(justifications, YogaNode::setJustifyContent))
    put("alignItems", enumSetter(alignments, YogaNode::setAlignItems))
    put("alignSelf", enumSetter(alignments, YogaNode::setAlignSelf))
    put("alignContent", enumSetter(alignments, YogaNode::setAlignContent))
    put("flexWrap", enumSetter(wraps, YogaNode::setWrap))
    put("position", enumSetter(positionTypes, YogaNode::setPositionType))
    put("display", enumSetter(displays, YogaNode::setDisplay))
    put("overflow", enumSetter(overflows, YogaNode::setOverflow))

    put("flex", numberSetter(YogaNode::setFlex))
    put("flexGrow", numberSetter(YogaNode::setFlexGrow))
    put("flexShrink", numberSetter(YogaNode::setFlexShrink))
    put("aspectRatio", numberSetter(YogaNode::setAspectRatio))

    put("flexBasis", lengthSetter(YogaNode::setFlexBasis, YogaNode::setFlexBasisPercent, YogaNode::setFlexBasisAuto))
    put("width", lengthSetter(YogaNode::setWidth, YogaNode::setWidthPercent, YogaNode::setWidthAuto))
    put("height", lengthSetter(YogaNode::setHeight, YogaNode::setHeightPercent, YogaNode::setHeightAuto))
    put("minWidth", lengthSetter(YogaNode::setMinWidth, YogaNode::setMinWidthPercent))
    put("minHeight", lengthSetter(YogaNode::setMinHeight, YogaNode::setMinHeightPercent))
    put("maxWidth", lengthSetter(YogaNode::setMaxWidth, YogaNode::setMaxWidthPercent))
    put("maxHeight", lengthSetter(YogaNode::setMaxHeight, YogaNode::setMaxHeightPercent))

    put("gap", numberSetter { node, gap -> node.setGap(YogaGutter.ALL, gap) })
    put("rowGap", numberSetter { node, gap -> node.setGap(YogaGutter.ROW, gap) })
    put("columnGap", numberSetter { node, gap -> node.setGap(YogaGutter.COLUMN, gap) })

    for ((suffix, edge) in edgesBySuffix) {
        put("padding$suffix", lengthSetter({ node, points -> node.setPadding(edge, points) }, { node, percent -> node.setPaddingPercent(edge, percent) }))
        put(
            "margin$suffix",
            lengthSetter(
                { node, points -> node.setMargin(edge, points) },
                { node, percent -> node.setMarginPercent(edge, percent) },
                { node -> node.setMarginAuto(edge) },
            ),
        )
    }

    for ((property, edge) in positionEdges) {
        put(property, lengthSetter({ node, points -> node.setPosition(edge, points) }, { node, percent -> node.setPositionPercent(edge, percent) }))
    }
}

private fun <Value> enumSetter(valuesByName: Map<String, Value>, apply: (YogaNode, Value) -> Unit): LayoutPropertySetter =
    { node, value -> valuesByName[value]?.let { apply(node, it) } }

private fun numberSetter(apply: (YogaNode, Float) -> Unit): LayoutPropertySetter =
    { node, value -> number(value)?.let { apply(node, it) } }

/** Lengths accept points (`16`), percentages (`'50%'`) and, where supported, `'auto'`. */
private fun lengthSetter(
    setPoints: (YogaNode, Float) -> Unit,
    setPercent: (YogaNode, Float) -> Unit,
    setAuto: ((YogaNode) -> Unit)? = null,
): LayoutPropertySetter = { node, value ->
    val points = number(value)
    val text = value as? String

    when {
        points != null -> setPoints(node, points)
        text == "auto" -> setAuto?.invoke(node)
        text != null && text.endsWith("%") -> text.dropLast(1).toFloatOrNull()?.let { setPercent(node, it) }
    }
}

/** 'normal', 'bold' or '100'...'900' (a number works too). */
private fun fontWeightOf(name: Any): Int = when (name) {
    "normal" -> 400
    "bold" -> 700
    else -> name.toString().toFloatOrNull()?.toInt() ?: 400
}
