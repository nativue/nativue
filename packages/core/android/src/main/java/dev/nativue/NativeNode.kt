package dev.nativue

import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import com.facebook.yoga.YogaConfigFactory
import com.facebook.yoga.YogaEdge
import com.facebook.yoga.YogaMeasureMode
import com.facebook.yoga.YogaMeasureOutput
import com.facebook.yoga.YogaNode
import com.facebook.yoga.YogaNodeFactory
import kotlin.math.roundToInt

/** A native view paired with the Yoga node that lays it out. Yoga works in dp, views in pixels. */
class NativeNode(val view: View, measuresContent: Boolean) {
    val yogaNode: YogaNode = YogaNodeFactory.create(yogaConfig).also { it.data = this }

    /** Where child views go when it isn't [view] (a scroll view's content, a screen's). */
    var childContainer: ViewGroup? = view as? ViewGroup

    /** Where children go when it isn't this node: a <Modal>'s live in a separate Yoga root. */
    var contentNode: NativeNode? = null

    var fontSize = DEFAULT_FONT_SIZE
    var fontWeight = 400

    /** WindowInsets types that pad this node (safe area, keyboard), 0 for none, and the last padding. */
    var insetTypes = 0
    var insetPadding = listOf(0f, 0f, 0f, 0f)

    /** Background color, corners, border and shadow, drawn by one drawable. */
    val box: BoxDrawable by lazy { BoxDrawable().also { view.background = it } }

    init {
        if (measuresContent) yogaNode.setMeasureFunction(::measure)
    }

    val canHaveChildren: Boolean
        get() = !yogaNode.isMeasureDefined

    /** Call when content that affects the measured size changes (text, title, font). */
    fun markContentChanged() {
        if (!canHaveChildren) yogaNode.dirty()
    }

    fun insertChild(child: NativeNode, index: Int) {
        child.removeFromParent()

        yogaNode.addChildAt(child.yogaNode, index)
        childContainer?.addView(child.view, index)
    }

    fun removeFromParent() {
        yogaNode.owner?.let { owner -> owner.removeChildAt(owner.indexOf(yogaNode)) }
        val parentView = view.parent
        if (parentView is ScreenStackView && view is ScreenView) parentView.removeScreen(view)
        else (parentView as? ViewGroup)?.removeView(view)
    }

    /** Computes the layout for this subtree and places its views. */
    fun calculateLayout(width: Float, height: Float) {
        yogaNode.calculateLayout(width, height)
        applyFrames()
        onLayoutCalculated()
    }

    /** Only visits subtrees Yoga laid out again; untouched subtrees keep their frames. */
    private fun applyFrames() {
        for (index in 0 until yogaNode.childCount) {
            val childYogaNode = yogaNode.getChildAt(index)
            if (!childYogaNode.hasNewLayout()) continue

            childYogaNode.markLayoutSeen()

            val child = childYogaNode.data as NativeNode
            child.place()
            child.applyFrames()
            child.applyContentLayout()
        }
    }

    /** Rounds edges, not sizes, so neighbors share a pixel edge. */
    private fun place() {
        val left = pixels(yogaNode.layoutX)
        val top = pixels(yogaNode.layoutY)
        val right = pixels(yogaNode.layoutX + yogaNode.layoutWidth)
        val bottom = pixels(yogaNode.layoutY + yogaNode.layoutHeight)

        view.measure(exactly(right - left), exactly(bottom - top))
        view.layout(left, top, right, bottom)
    }

    private fun applyContentLayout() {
        (view as? ScrollContainerView)?.let { scrollView ->
            val (width, height) = contentSize()
            scrollView.setContentSize(pixels(width), pixels(height))
        }

        (view as? TextView)?.setPadding(
            pixels(yogaNode.getLayoutPadding(YogaEdge.LEFT)),
            pixels(yogaNode.getLayoutPadding(YogaEdge.TOP)),
            pixels(yogaNode.getLayoutPadding(YogaEdge.RIGHT)),
            pixels(yogaNode.getLayoutPadding(YogaEdge.BOTTOM)),
        )
    }

    /** Children of a scroll view don't shrink, so they overflow it: the content is how far they reach. */
    private fun contentSize(): Pair<Float, Float> {
        var contentWidth = 0f
        var contentHeight = 0f

        for (index in 0 until yogaNode.childCount) {
            val child = yogaNode.getChildAt(index)
            contentWidth = maxOf(contentWidth, child.layoutX + child.layoutWidth + child.getLayoutMargin(YogaEdge.RIGHT))
            contentHeight = maxOf(contentHeight, child.layoutY + child.layoutHeight + child.getLayoutMargin(YogaEdge.BOTTOM))
        }

        return Pair(
            maxOf(contentWidth + yogaNode.getLayoutPadding(YogaEdge.RIGHT), yogaNode.layoutWidth),
            maxOf(contentHeight + yogaNode.getLayoutPadding(YogaEdge.BOTTOM), yogaNode.layoutHeight),
        )
    }

    private fun pixels(dp: Float): Int = (dp * density).roundToInt()

    private fun measure(
        node: YogaNode,
        width: Float,
        widthMode: YogaMeasureMode,
        height: Float,
        heightMode: YogaMeasureMode,
    ): Long {
        val horizontalPadding = view.paddingLeft + view.paddingRight
        val verticalPadding = view.paddingTop + view.paddingBottom
        view.measure(measureSpec(width, widthMode, horizontalPadding), measureSpec(height, heightMode, verticalPadding))

        return YogaMeasureOutput.make(
            (view.measuredWidth - horizontalPadding) / density,
            (view.measuredHeight - verticalPadding) / density,
        )
    }

    private fun measureSpec(size: Float, mode: YogaMeasureMode, padding: Int): Int {
        val pixels = if (size.isNaN()) 0 else (size * density).toInt() + padding

        return when (mode) {
            YogaMeasureMode.EXACTLY -> View.MeasureSpec.makeMeasureSpec(pixels, View.MeasureSpec.EXACTLY)
            YogaMeasureMode.AT_MOST -> View.MeasureSpec.makeMeasureSpec(pixels, View.MeasureSpec.AT_MOST)
            YogaMeasureMode.UNDEFINED -> View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
        }
    }

    private val density: Float
        get() = view.resources.displayMetrics.density

    companion object {
        private val yogaConfig = YogaConfigFactory.create()

        /** After every layout pass, of the root or of a modal's content: for @layout. */
        var onLayoutCalculated: () -> Unit = {}

        /** Rounds layouts to whole pixels; set before the first node is laid out. */
        fun setPixelDensity(density: Float) = yogaConfig.setPointScaleFactor(density)
    }
}

/** The platform's body text size, which a removed fontSize goes back to. */
const val DEFAULT_FONT_SIZE = 17f
