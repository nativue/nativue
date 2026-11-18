package dev.nativue

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.content.res.ColorStateList
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs
import kotlin.math.roundToInt

// The views behind <ScreenStack>, <Screen> and <TabBar>, in Material 3's look: a top app bar, screens
// that slide in, sheets that slide up and are dragged down, and a bottom navigation bar. JS owns the
// stack and the selected tab; what the user does natively (back, a dragged sheet, a tab tap) is
// reported so JS updates them.

private const val TRANSITION_DURATION_MS = 350L
private val emphasizedInterpolator = PathInterpolator(0.2f, 0f, 0f, 1f)
private const val SCRIM = 0x52000000

fun View.dp(value: Float): Int = (value * resources.displayMetrics.density).roundToInt()

/** Where [this] is inside [ancestor], ignoring transforms (a sliding screen's insets don't change). */
fun View.offsetIn(ancestor: View): Pair<Int, Int> {
    var x = 0
    var y = 0
    var view: View = this

    while (view !== ancestor) {
        x += view.left
        y += view.top
        val parent = view.parent as? View ?: break
        x -= parent.scrollX
        y -= parent.scrollY
        view = parent
    }

    return Pair(x, y)
}

/**
 * View behind <Screen>: [content] holds the screen's views (laid out by Yoga), [header] floats above it.
 * The screen's Yoga node is padded by the header's height, so the content starts below it.
 */
@SuppressLint("ViewConstructor")
class ScreenView(context: Context) : ContainerView(context), ThemeAware {
    val content = ContainerView(context)
    val header = ScreenHeader(context)

    var onEvent: (eventName: String, payload: Any?) -> Unit = { _, _ -> }

    var headerShown = true
        set(value) {
            field = value
            header.visibility = if (value) View.VISIBLE else View.GONE
        }

    /** "push", "modal", "formSheet" or "fullScreenModal". */
    var stackPresentation = "push"
        set(value) {
            field = value
            updateShape()
        }

    val isModal: Boolean
        get() = stackPresentation != "push"

    val isSheet: Boolean
        get() = stackPresentation == "modal" || stackPresentation == "formSheet"

    /** Tab bar item: { label, svg, systemImage, badge }. */
    var tabBarItem: Map<*, *> = emptyMap<String, Any>()
        set(value) {
            field = value
            (parent as? TabBarView)?.updateItems()
        }

    /** Pixels the status bar covers at the screen's top; the header extends under it. */
    var topInset = 0
        set(value) {
            field = value
            header.setPadding(0, value, 0, 0)
        }

    private val sheetDrag = SheetDrag(this) { onEvent("dismissed", null) }

    init {
        applyThemeColors()
        clipChildren = true
        addView(content)
        addView(header)
        header.onEvent = { eventName, payload -> onEvent(eventName, payload) }
    }

    override fun applyThemeColors() {
        background = GradientDrawable().apply { setColor(ThemeColors.surface) }
    }

    /** dp the content starts at: below the header, or at the top without one. */
    val contentTop: Float
        get() = if (headerShown) (topInset + header.barHeight) / resources.displayMetrics.density else 0f

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
        content.measure(exactly(measuredWidth), exactly(measuredHeight))
        header.measure(exactly(measuredWidth), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        content.layout(0, 0, right - left, bottom - top)
        header.layout(0, 0, right - left, header.measuredHeight)
    }

    override fun onInterceptTouchEvent(event: MotionEvent): Boolean =
        isSheet && sheetDrag.shouldIntercept(event, dragAreaBottom = (topInset + header.barHeight).toFloat())

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean = isSheet && sheetDrag.onTouchEvent(event)

    private fun updateShape() {
        val radius = if (isSheet) dp(28f).toFloat() else 0f
        (background as GradientDrawable).cornerRadii = floatArrayOf(radius, radius, radius, radius, 0f, 0f, 0f, 0f)
        clipToOutline = isSheet
        header.showsDragHandle = isSheet
    }
}

/** Drags a sheet down from its top area; far or fast enough dismisses it, otherwise it settles back. */
class SheetDrag(private val sheet: View, private val onDismiss: () -> Unit) {
    private val touchSlop = ViewConfiguration.get(sheet.context).scaledTouchSlop
    private var startY = 0f
    private var isDragging = false
    private var velocityTracker: VelocityTracker? = null

    fun shouldIntercept(event: MotionEvent, dragAreaBottom: Float): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                startY = event.rawY
                isDragging = false
                velocityTracker = VelocityTracker.obtain().also { it.addMovement(event) }
                return false
            }

            MotionEvent.ACTION_MOVE -> {
                velocityTracker?.addMovement(event)
                val startedInDragArea = startY - sheet.offsetOnScreenY() < dragAreaBottom
                isDragging = startedInDragArea && event.rawY - startY > touchSlop
            }
        }

        return isDragging
    }

    @SuppressLint("ClickableViewAccessibility")
    fun onTouchEvent(event: MotionEvent): Boolean {
        velocityTracker?.addMovement(event)

        when (event.actionMasked) {
            MotionEvent.ACTION_MOVE -> sheet.translationY = (event.rawY - startY).coerceAtLeast(0f)
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> finishDrag()
        }

        return true
    }

    private fun finishDrag() {
        val tracker = velocityTracker
        tracker?.computeCurrentVelocity(1000)
        val velocity = tracker?.yVelocity ?: 0f
        tracker?.recycle()
        velocityTracker = null
        isDragging = false

        if (sheet.translationY > sheet.height / 4f || velocity > sheet.dp(1000f)) onDismiss()
        else sheet.animate().translationY(0f).setDuration(250).setInterpolator(emphasizedInterpolator).start()
    }

    private fun View.offsetOnScreenY(): Float {
        val location = IntArray(2)
        getLocationOnScreen(location)

        return location[1].toFloat()
    }
}

/** Material 3's small top app bar (large with `headerLargeTitle`): back arrow, title and text actions. */
class ScreenHeader(context: Context) : LinearLayout(context), ThemeAware {
    var onEvent: (eventName: String, payload: Any?) -> Unit = { _, _ -> }

    private val dragHandle = View(context)
    private val row = LinearLayout(context)
    private val navigationButton = iconButton(ARROW_BACK)
    private val leftItems = LinearLayout(context)
    private val title = textView(22f, Typeface.NORMAL)
    private val rightItems = LinearLayout(context)
    private val largeTitle = textView(28f, Typeface.NORMAL)

    var tintColor: Int? = null
        set(value) {
            field = value
            navigationButton.color = value ?: ThemeColors.onSurface
            listOf(leftItems, rightItems).forEach { items ->
                for (index in 0 until items.childCount) tint(items.getChildAt(index))
            }
        }

    private val actionColor: Int
        get() = tintColor ?: ThemeColors.onSurfaceVariant

    var showsDragHandle = false
        set(value) {
            field = value
            dragHandle.visibility = if (value) View.VISIBLE else View.GONE
        }

    var isLarge = false
        set(value) {
            field = value
            title.visibility = if (value) View.INVISIBLE else View.VISIBLE
            largeTitle.visibility = if (value) View.VISIBLE else View.GONE
        }

    /** The bar's height without the status bar above it. */
    val barHeight: Int
        get() = dp(64f) + (if (isLarge) dp(88f) else 0) + (if (showsDragHandle) dp(22f) else 0)

    init {
        orientation = VERTICAL
        dragHandle.background = GradientDrawable().apply { cornerRadius = dp(2f).toFloat() }
        applyThemeColors()
        dragHandle.visibility = View.GONE
        addView(dragHandle, LayoutParams(dp(32f), dp(4f)).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            topMargin = dp(16f)
            bottomMargin = dp(2f)
        })

        row.gravity = Gravity.CENTER_VERTICAL
        row.setPadding(dp(4f), 0, dp(4f), 0)
        navigationButton.setOnClickListener { onEvent("dismissed", null) }
        row.addView(navigationButton, LayoutParams(dp(48f), dp(48f)))
        row.addView(leftItems)
        row.addView(title, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(12f) })
        row.addView(rightItems)
        addView(row, LayoutParams(LayoutParams.MATCH_PARENT, dp(64f)))

        largeTitle.visibility = View.GONE
        largeTitle.setPadding(dp(16f), 0, dp(16f), dp(28f))
        largeTitle.gravity = Gravity.BOTTOM
        addView(largeTitle, LayoutParams(LayoutParams.MATCH_PARENT, dp(88f)))
    }

    override fun applyThemeColors() {
        setBackgroundColor(ThemeColors.surface)
        (dragHandle.background as GradientDrawable).setColor(ThemeColors.onSurfaceVariant and 0x66FFFFFF)
        listOf(title, largeTitle).forEach { it.setTextColor(ThemeColors.onSurface) }
        tintColor = tintColor // repaints the navigation button and the items
    }

    fun setTitle(text: String?) {
        title.text = text
        largeTitle.text = text
    }

    /** Back arrow inside a stack, a close icon on a full screen modal, nothing on a group's first screen. */
    fun setNavigation(icon: List<List<Any>>?) {
        navigationButton.visibility = if (icon == null) View.GONE else View.VISIBLE
        icon?.let { navigationButton.elements = it }
        (title.layoutParams as LayoutParams).marginStart = dp(if (icon == null) 12f else 4f)
    }

    /**
     * [{ title?, svg?, systemImage? }]: an svg icon (@nativue/icons) shows as an icon button, otherwise the
     * title as a text button; SF Symbol names are iOS-only. Presses are reported with the side and index,
     * since the handlers live in JS.
     */
    fun setItems(value: Any?, side: String) {
        val items = if (side == "right") rightItems else leftItems
        items.removeAllViews()

        (value as? List<*>)?.filterIsInstance<Map<*, *>>()?.forEachIndexed { index, item ->
            val svg = item["svg"] as? Map<*, *>
            val button = if (svg != null) IconButton(context).apply { setSvg(svg) } else textButton(item["title"] as? String ?: "")
            val width = if (svg != null) dp(48f) else LayoutParams.WRAP_CONTENT

            tint(button)
            button.contentDescription = item["title"] as? String
            button.setOnClickListener { onEvent("headeritempress", mapOf("side" to side, "index" to index)) }
            items.addView(button, LayoutParams(width, if (svg != null) dp(48f) else dp(40f)))
        }
    }

    private fun textButton(title: String) = textView(14f, Typeface.BOLD).apply {
        text = title
        gravity = Gravity.CENTER
        setPadding(dp(12f), 0, dp(12f), 0)
        background = ripple(dp(20f).toFloat())
    }

    private fun tint(item: View) {
        (item as? TextView)?.setTextColor(actionColor)
        (item as? IconButton)?.color = actionColor
    }

    private fun textView(size: Float, style: Int) = TextView(context).apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
        setTextColor(ThemeColors.onSurface)
        typeface = Typeface.create(Typeface.DEFAULT, if (style == Typeface.BOLD) 500 else 400, false)
        isSingleLine = true
        ellipsize = android.text.TextUtils.TruncateAt.END
        includeFontPadding = false
    }

    private fun iconButton(elements: List<List<Any>>) = IconButton(context).apply {
        this.elements = elements
        color = ThemeColors.onSurface
    }

    companion object {
        val ARROW_BACK = listOf(listOf("path", mapOf("d" to "M19 12H5")), listOf("path", mapOf("d" to "m12 19-7-7 7-7")))
        val CLOSE = listOf(listOf("path", mapOf("d" to "M18 6 6 18")), listOf("path", mapOf("d" to "m6 6 12 12")))
    }
}

/** A 24dp icon in a 48dp round touch target with a ripple. */
class IconButton(context: Context) : FrameLayout(context) {
    private val icon = SvgView(context)

    var elements: List<*>
        get() = icon.elements
        set(value) {
            icon.elements = value
        }

    var color: Int
        get() = icon.color
        set(value) {
            icon.color = value
        }

    init {
        background = ripple(dp(24f).toFloat())
        addView(icon, LayoutParams(dp(24f), dp(24f), Gravity.CENTER))
    }

    /** An icon from @nativue/icons: { viewBox, elements }. */
    fun setSvg(svg: Map<*, *>) {
        icon.elements = svg["elements"] as? List<*> ?: emptyList<Any>()
        SvgView.rect(svg["viewBox"])?.let { icon.viewBox = it }
    }
}

/** A bounded press ripple, clipped to a rounded rectangle. */
fun ripple(cornerRadius: Float): RippleDrawable {
    val mask = GradientDrawable().apply {
        setColor(0xFFFFFFFF.toInt())
        this.cornerRadius = cornerRadius
    }

    return RippleDrawable(ColorStateList.valueOf(ThemeColors.ripple), null, mask)
}

/**
 * View behind <ScreenStack>: its <Screen> children, the top one showing. A screen added on top slides
 * in (a modal slides up), one removed from the top slides out; the screens under the top one hide.
 * A modal screen starts a group: the screens after it open inside it.
 */
class ScreenStackView(context: Context) : ContainerView(context) {
    private val screens: List<ScreenView>
        get() = screenChildren()

    init {
        clipChildren = true
    }

    /** Whether the system back gesture has something to pop here. */
    val canGoBack: Boolean
        get() = screens.size > 1

    /** The top screen asks JS to go; JS removes it, which slides it out. */
    fun goBack() {
        screens.lastOrNull()?.onEvent?.invoke("dismissed", null)
    }

    override fun onViewAdded(child: View) {
        updateHeaders()

        val screen = child as? ScreenView ?: return
        val previous = screens.getOrNull(screens.size - 2) ?: return
        if (!isLaidOut || screens.last() !== screen) return showTopScreens()

        slideIn(screen, previous)
    }

    /** Called instead of removeView for a screen: the top one slides out first. */
    fun removeScreen(screen: ScreenView) {
        val isTop = screens.lastOrNull() === screen
        val previous = screens.getOrNull(screens.size - 2)

        if (!isTop || previous == null || !isLaidOut) {
            removeView(screen)
            updateHeaders()
            showTopScreens()
            return
        }

        startViewTransition(screen)
        removeView(screen)
        updateHeaders()
        previous.visibility = View.VISIBLE

        animateTransition(screen, entering = false, previous) {
            endViewTransition(screen)
            showTopScreens()
        }
    }

    private fun slideIn(screen: ScreenView, previous: ScreenView) {
        previous.visibility = View.VISIBLE
        animateTransition(screen, entering = true, previous) { showTopScreens() }
    }

    /**
     * Pushes slide horizontally, the previous screen moving a quarter of the way; modals slide up over
     * the previous screen, which stays.
     */
    private fun animateTransition(screen: ScreenView, entering: Boolean, previous: ScreenView, onEnd: () -> Unit) {
        val distance = if (screen.isModal) height.toFloat() else width.toFloat()
        val startOffset = if (screen.isModal) screen.translationY.takeIf { !entering } ?: distance else if (entering) distance else 0f
        val endOffset = if (entering) 0f else distance
        val previousShift = if (screen.isModal) 0f else -width / 4f

        fun moveScreens(progress: Float) {
            val offset = startOffset + (endOffset - startOffset) * progress
            if (screen.isModal) screen.translationY = offset else screen.translationX = offset
            // Covered (offset 0), the previous screen sits a quarter to the left; uncovered, in place.
            previous.translationX = previousShift * (1 - offset / distance)
            invalidate() // the scrim follows the sheet
        }

        moveScreens(0f) // before the first frame draws, or the entering screen flashes in place
        ValueAnimator.ofFloat(0f, 1f).apply {
            duration = TRANSITION_DURATION_MS
            interpolator = emphasizedInterpolator
            addUpdateListener { animator -> moveScreens(animator.animatedValue as Float) }
            doOnEnd(onEnd)
            start()
        }
    }

    /** The top screen and, under a sheet, the screen it covers show; the rest hide. */
    private fun showTopScreens() {
        val screens = screens
        val topIndex = screens.lastIndex
        val coveredIndex = if (screens.lastOrNull()?.isSheet == true) topIndex - 1 else topIndex

        screens.forEachIndexed { index, screen ->
            screen.visibility = if (index >= coveredIndex) View.VISIBLE else View.INVISIBLE
            screen.translationX = 0f
            if (index != topIndex || !screen.isModal) screen.translationY = 0f
        }
    }

    /** A back arrow on screens pushed inside a group; a close icon on a full screen modal. */
    private fun updateHeaders() {
        screens.forEachIndexed { index, screen ->
            val icon = when {
                screen.stackPresentation == "fullScreenModal" -> ScreenHeader.CLOSE
                index == 0 || screen.isModal -> null
                else -> ScreenHeader.ARROW_BACK
            }
            screen.header.setNavigation(icon)
        }
    }

    /** A sheet dims what's under it, more as it comes in. */
    override fun drawChild(canvas: Canvas, child: View, drawingTime: Long): Boolean {
        if (child is ScreenView && child.isSheet && child.visibility == View.VISIBLE && height > 0) {
            val progress = 1 - (child.translationY / height).coerceIn(0f, 1f)
            canvas.drawColor(((SCRIM ushr 24) * progress).toInt() shl 24)
        }

        return super.drawChild(canvas, child, drawingTime)
    }
}

private fun ValueAnimator.doOnEnd(action: () -> Unit) {
    addListener(object : android.animation.AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: android.animation.Animator) = action()
    })
}

/**
 * View behind <TabBar>: its <Screen> children above a Material 3 navigation bar, the selected one
 * showing. A tap on the bar is reported so JS switches; a tap on the selected tab goes back to its first
 * screen, or scrolls it to the top.
 */
class TabBarView(context: Context) : ContainerView(context), ThemeAware {
    var onTabChange: (index: Int) -> Unit = {}

    var selectedIndex = 0
        set(value) {
            field = value
            showSelectedScreen()
            updateItems()
        }

    var activeTintColor: Int? = null
        set(value) {
            field = value
            updateItems()
        }

    var inactiveTintColor: Int? = null
        set(value) {
            field = value
            updateItems()
        }

    /** Material's surface container by default. */
    var barBackgroundColor: Int? = null
        set(value) {
            field = value
            bar.setBackgroundColor(value ?: ThemeColors.barBackground)
        }

    /** Pixels the system navigation bar covers; the bar extends under it. */
    var bottomInset = 0
        set(value) {
            if (field == value) return
            field = value
            bar.setPadding(0, 0, 0, value)
            requestLayout()
        }

    /** The bar's height in dp, which the screens stop above. */
    val barHeight: Float
        get() = (dp(80f) + bottomInset) / resources.displayMetrics.density

    private val bar = LinearLayout(context)

    private val screens: List<ScreenView>
        get() = screenChildren()

    init {
        clipChildren = true
        bar.setBackgroundColor(ThemeColors.barBackground)
        addView(bar)
    }

    override fun applyThemeColors() {
        barBackgroundColor = barBackgroundColor
        updateItems()
    }

    override fun onViewAdded(child: View) {
        if (child === bar) return

        bringChildToFront(bar)
        showSelectedScreen()
        updateItems()
    }

    override fun onViewRemoved(child: View) {
        showSelectedScreen()
        updateItems()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
        bar.measure(exactly(measuredWidth), exactly(dp(80f) + bottomInset))
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        bar.layout(0, bottom - top - bar.measuredHeight, right - left, bottom - top)
    }

    private fun showSelectedScreen() {
        screens.forEachIndexed { index, screen ->
            screen.visibility = if (index == selectedIndex) View.VISIBLE else View.INVISIBLE
        }
    }

    fun updateItems() {
        bar.removeAllViews()

        screens.forEachIndexed { index, screen ->
            val item = TabItemView(context)
            item.update(screen.tabBarItem, isSelected = index == selectedIndex, activeTintColor, inactiveTintColor)
            item.setOnClickListener { select(index) }
            bar.addView(item, LinearLayout.LayoutParams(0, dp(80f), 1f))
        }
    }

    private fun select(index: Int) {
        if (index != selectedIndex) return onTabChange(index)

        val stack = screens.getOrNull(index)?.let { findFirst<ScreenStackView>(it) }
        if (stack != null && stack.canGoBack) stack.popToFirst()
        else screens.getOrNull(index)?.let { findFirst<ScrollContainerView>(it) }?.scrollToTop()
    }

    /** Breadth-first, so the screen's own list wins over one nested deeper. */
    private inline fun <reified Target : View> findFirst(root: View): Target? {
        val queue = ArrayDeque(listOf(root))

        while (queue.isNotEmpty()) {
            val view = queue.removeFirst()
            if (view is Target && view !== root) return view
            if (view is ViewGroup) for (index in 0 until view.childCount) queue.add(view.getChildAt(index))
        }

        return null
    }
}

/** Every screen above the first asks JS to go. */
fun ScreenStackView.popToFirst() {
    for (index in childCount - 1 downTo 1) (getChildAt(index) as? ScreenView)?.onEvent?.invoke("dismissed", null)
}

/** One destination of the navigation bar: an icon in a pill when selected, a label and a badge. */
private class TabItemView(context: Context) : LinearLayout(context) {
    private val indicator = FrameLayout(context)
    private val icon = SvgView(context)
    private val label = TextView(context)
    private val badge = TextView(context)

    init {
        orientation = VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        setPadding(0, dp(12f), 0, dp(16f))
        clipChildren = false

        indicator.addView(icon, FrameLayout.LayoutParams(dp(24f), dp(24f), Gravity.CENTER))
        badge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
        badge.setTextColor(0xFFFFFFFF.toInt())
        badge.gravity = Gravity.CENTER
        badge.setPadding(dp(4f), 0, dp(4f), 0)
        badge.minWidth = dp(16f)
        badge.background = GradientDrawable().apply {
            setColor(0xFFB3261E.toInt())
            cornerRadius = dp(8f).toFloat()
        }
        indicator.addView(badge, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, dp(16f)).apply {
            leftMargin = dp(34f)
            topMargin = dp(2f)
        })
        indicator.clipChildren = false
        addView(indicator, LayoutParams(dp(64f), dp(32f)))

        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        label.typeface = Typeface.create(Typeface.DEFAULT, 500, false)
        label.gravity = Gravity.CENTER
        label.isSingleLine = true
        addView(label, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply { topMargin = dp(4f) })

        background = RippleDrawable(ColorStateList.valueOf(ThemeColors.ripple), null, null)
    }

    /** Only svg icons (@nativue/icons) draw on Android; SF Symbol names are iOS-only. */
    fun update(item: Map<*, *>, isSelected: Boolean, activeTintColor: Int?, inactiveTintColor: Int?) {
        val activeColor = activeTintColor ?: ThemeColors.onSurface
        val color = if (isSelected) activeColor else inactiveTintColor ?: ThemeColors.onSurfaceVariant
        val svg = item["svg"] as? Map<*, *>

        icon.elements = svg?.get("elements") as? List<*> ?: emptyList<Any>()
        SvgView.rect(svg?.get("viewBox"))?.let { icon.viewBox = it }
        icon.color = color
        label.text = item["label"] as? String ?: ""
        label.setTextColor(color)

        indicator.background = if (!isSelected) null else GradientDrawable().apply {
            setColor((activeColor and 0xFFFFFF) or 0x29000000)
            cornerRadius = dp(16f).toFloat()
        }

        val badgeText = item["badge"]?.let { if (it is Number) it.toInt().toString() else it.toString() }
        badge.text = badgeText
        badge.visibility = if (badgeText.isNullOrEmpty()) View.GONE else View.VISIBLE
    }
}

/** The screens among a container's children, in order. */
private fun ViewGroup.screenChildren(): List<ScreenView> = (0 until childCount).mapNotNull { getChildAt(it) as? ScreenView }
