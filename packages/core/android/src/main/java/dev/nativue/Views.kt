package dev.nativue

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.LruCache
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.view.inputmethod.InputMethodManager
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.Switch
import java.io.File
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.abs

/**
 * A view whose children Yoga places (NativeNode.applyFrames): Android's own layout passes keep them
 * where they are. Children may draw outside it, like on iOS, until `overflow: 'hidden'`.
 */
open class ContainerView(context: Context) : ViewGroup(context) {
    init {
        clipChildren = false
    }

    /** Set while it reports @pan, @pinch or @rotate. */
    var gestureReporter: GestureReporter? = null

    /** A descendant took this touch (a scroll view scrolling, an inner gesture): its own gesture stands down. */
    private var isTouchClaimedByChild = false

    override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
        isTouchClaimedByChild = disallowIntercept
        super.requestDisallowInterceptTouchEvent(disallowIntercept)
    }

    /**
     * Children get each touch first, then the gesture sees it too, like iOS's gesture recognizers. Once
     * the gesture is recognized, onInterceptTouchEvent takes the touch: the child gets a cancel (a
     * <Pressable> doesn't fire @press).
     */
    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        val reporter = gestureReporter ?: return super.dispatchTouchEvent(event)
        if (event.actionMasked == MotionEvent.ACTION_DOWN) isTouchClaimedByChild = false

        super.dispatchTouchEvent(event)
        if (!isTouchClaimedByChild || reporter.isRecognizing) reporter.handle(event)

        return true
    }

    override fun onInterceptTouchEvent(event: MotionEvent): Boolean =
        gestureReporter?.isRecognizing == true || super.onInterceptTouchEvent(event)

    /** Without an exact size (inside a scroll view), the size set in its layout params. */
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(
            sizeOf(widthMeasureSpec, layoutParams?.width ?: 0),
            sizeOf(heightMeasureSpec, layoutParams?.height ?: 0),
        )

        for (index in 0 until childCount) {
            val child = getChildAt(index)
            child.measure(exactly(child.width), exactly(child.height))
        }
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        for (index in 0 until childCount) {
            val child = getChildAt(index)
            child.layout(child.left, child.top, child.right, child.bottom)
        }
    }

    private fun sizeOf(measureSpec: Int, requestedSize: Int): Int =
        if (MeasureSpec.getMode(measureSpec) == MeasureSpec.EXACTLY) MeasureSpec.getSize(measureSpec)
        else requestedSize.coerceAtLeast(0)
}

fun exactly(size: Int): Int = View.MeasureSpec.makeMeasureSpec(size, View.MeasureSpec.EXACTLY)

/** The app's root: each layout pass lays the node tree out first. */
class RootView(context: Context) : ContainerView(context) {
    var onLayoutPass: () -> Unit = {}

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        onLayoutPass()
        super.onLayout(changed, left, top, right, bottom)
    }
}

class SafeAreaView(context: Context) : ContainerView(context)

class KeyboardAvoidingView(context: Context) : ContainerView(context)

/** Reports pressin, pressout, press and (when asked) longpress; a scroll that takes over cancels it. */
class PressableView(context: Context) : ContainerView(context) {
    var onEvent: (eventName: String) -> Unit = {}
    var reportsLongPress = false

    private val longPressHandler = Handler(Looper.getMainLooper())
    private var didLongPress = false

    init {
        isClickable = true // so TalkBack can activate it
    }

    /** TalkBack's double tap. Touches don't come through here: onTouchEvent reports them. */
    override fun performClick(): Boolean {
        super.performClick()
        if (!isEnabled) return false

        onEvent("pressin")
        onEvent("pressout")
        onEvent("press")

        return true
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        // Consumed but ignored, as disabled Android buttons do: the touch doesn't reach a parent.
        if (!isEnabled) return true

        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> pressIn()
            MotionEvent.ACTION_UP -> pressOut(pressed = isInside(event))
            MotionEvent.ACTION_CANCEL -> pressOut(pressed = false)
        }

        return true
    }

    private fun pressIn() {
        didLongPress = false
        onEvent("pressin")

        if (reportsLongPress) {
            longPressHandler.postDelayed(::longPress, ViewConfiguration.getLongPressTimeout().toLong())
        }
    }

    private fun longPress() {
        didLongPress = true
        onEvent("longpress")
    }

    private fun pressOut(pressed: Boolean) {
        longPressHandler.removeCallbacksAndMessages(null)
        onEvent("pressout")

        if (pressed && !didLongPress) onEvent("press")
    }

    override fun setEnabled(enabled: Boolean) {
        super.setEnabled(enabled)
        if (!enabled) longPressHandler.removeCallbacksAndMessages(null)
    }

    private fun isInside(event: MotionEvent) = event.x in 0f..width.toFloat() && event.y in 0f..height.toFloat()
}

/**
 * Android scrolls one way per view, so this holds a ScrollView or a HorizontalScrollView, swapped on
 * `horizontal`. Children go into [content], sized by NativeNode to how far they reach.
 */
class ScrollContainerView(context: Context) : ContainerView(context) {
    val content = ContainerView(context)

    /** For JS (`@scroll`) and for Animated (`Animated.event`), in pixels. */
    var onScroll: ((x: Int, y: Int) -> Unit)? = null
    var onOffsetChange: ((x: Int, y: Int) -> Unit)? = null

    var pagingEnabled = false
        set(value) {
            field = value
            (scroller as PagingScroller).pagingEnabled = value
        }

    var showsHorizontalScrollIndicator = true
        set(value) {
            field = value
            scroller.isHorizontalScrollBarEnabled = value
        }

    var showsVerticalScrollIndicator = true
        set(value) {
            field = value
            scroller.isVerticalScrollBarEnabled = value
        }

    /** "on-drag" closes the keyboard when a drag scrolls. */
    var keyboardDismissMode = "none"

    /** keyboardShouldPersistTaps="never" (the default): a tap outside a text input closes the keyboard. */
    var dismissesKeyboardOnTap = true

    /** Set when JS listens to @refresh: pulling down from the top shows a spinner. JS owns `refreshing`. */
    var onRefresh: (() -> Unit)? = null

    private var scroller: FrameLayout = makeScroller(horizontal = false)
    private val refreshIndicator = RefreshIndicator(context)
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    private var touchStartY = 0f
    private var touchStartX = 0f
    private var isTouching = false
    private var isPullingToRefresh = false

    init {
        clipChildren = true // like a UIScrollView: scrolled content stays inside the list
        addView(scroller)
        addView(refreshIndicator)
    }

    fun setRefreshing(refreshing: Boolean) {
        refreshIndicator.setRefreshing(refreshing, restingTop = contentInsets[1])
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                touchStartX = event.x
                touchStartY = event.y
                isTouching = true
            }

            MotionEvent.ACTION_UP -> {
                isTouching = false
                val isTap = abs(event.x - touchStartX) < touchSlop && abs(event.y - touchStartY) < touchSlop
                if (isTap && dismissesKeyboardOnTap) dismissKeyboardUnlessTappingInput(event)
            }

            MotionEvent.ACTION_CANCEL -> isTouching = false
        }

        return super.dispatchTouchEvent(event)
    }

    /** At the top, a pull down is the refresh gesture's, not the scroll view's. */
    override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
        if (onRefresh == null || scroller !is ScrollView || refreshIndicator.isRefreshing) return false

        if (event.actionMasked == MotionEvent.ACTION_MOVE) {
            isPullingToRefresh = event.y - touchStartY > touchSlop && !scroller.canScrollVertically(-1)
        }

        return isPullingToRefresh
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (!isPullingToRefresh) return false

        val pull = (event.y - touchStartY - touchSlop).coerceAtLeast(0f) / 2
        when (event.actionMasked) {
            MotionEvent.ACTION_MOVE -> refreshIndicator.showPull(pull, restingTop = contentInsets[1])
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                isPullingToRefresh = false
                if (refreshIndicator.isPastThreshold(pull)) {
                    refreshIndicator.setRefreshing(true, restingTop = contentInsets[1])
                    onRefresh?.invoke()
                } else {
                    refreshIndicator.setRefreshing(false, restingTop = contentInsets[1])
                }
            }
        }

        return true
    }

    private fun dismissKeyboardUnlessTappingInput(event: MotionEvent) {
        val focused = rootView.findFocus() as? android.widget.EditText ?: return
        val (inputX, inputY) = focused.offsetIn(rootView)
        val (ownX, ownY) = offsetIn(rootView)
        val tapX = event.x + ownX
        val tapY = event.y + ownY
        val tappedInput = tapX >= inputX && tapX <= inputX + focused.width && tapY >= inputY && tapY <= inputY + focused.height
        if (!tappedInput) hideKeyboard(focused)
    }

    fun setHorizontal(horizontal: Boolean) {
        if (horizontal == scroller is HorizontalScrollView) return

        scroller.removeAllViews()
        removeView(scroller)
        scroller = makeScroller(horizontal)
        addView(scroller)
        applyContentInsets()
    }

    /** Pads the scrollable area by the system bars it overlaps (contentInsetAdjustmentBehavior). */
    fun setContentInsets(left: Int, top: Int, right: Int, bottom: Int) {
        contentInsets = listOf(left, top, right, bottom)
        applyContentInsets()
    }

    fun scrollToTop() {
        (scroller as? ScrollView)?.smoothScrollTo(0, 0)
        (scroller as? HorizontalScrollView)?.smoothScrollTo(0, 0)
    }

    private var contentInsets = listOf(0, 0, 0, 0)

    private fun applyContentInsets() {
        val (left, top, right, bottom) = contentInsets
        if (scroller.paddingLeft == left && scroller.paddingTop == top && scroller.paddingRight == right && scroller.paddingBottom == bottom) return

        val bottomGrew = bottom > scroller.paddingBottom
        scroller.clipToPadding = false
        scroller.setPadding(left, top, right, bottom)
        if (bottomGrew) revealFocusedInput()
    }

    /** When the keyboard pads the bottom, scrolls up just enough for the focused input to sit above it. */
    private fun revealFocusedInput() {
        val focusedView = scroller.findFocus() ?: return
        val inputRect = Rect()
        focusedView.getDrawingRect(inputRect)
        scroller.offsetDescendantRectToMyCoords(focusedView, inputRect)

        val visibleBottom = scroller.scrollY + scroller.height - scroller.paddingBottom
        if (inputRect.bottom > visibleBottom) scroller.scrollBy(0, inputRect.bottom - visibleBottom)
    }

    fun setContentSize(width: Int, height: Int) {
        val layoutParams = content.layoutParams
        if (layoutParams.width == width && layoutParams.height == height) return

        layoutParams.width = width
        layoutParams.height = height
        content.requestLayout()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(View.MeasureSpec.getSize(widthMeasureSpec), View.MeasureSpec.getSize(heightMeasureSpec))
        scroller.measure(exactly(measuredWidth), exactly(measuredHeight))
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        scroller.layout(0, 0, right - left, bottom - top)

        val size = refreshIndicator.size
        val indicatorLeft = (right - left - size) / 2
        refreshIndicator.measure(exactly(size), exactly(size))
        refreshIndicator.layout(indicatorLeft, -size, indicatorLeft + size, 0)
    }

    private fun makeScroller(horizontal: Boolean): FrameLayout {
        val scroller = if (horizontal) PagingHorizontalScrollView(context) else PagingVerticalScrollView(context)
        (scroller as PagingScroller).pagingEnabled = pagingEnabled
        scroller.isHorizontalScrollBarEnabled = showsHorizontalScrollIndicator
        scroller.isVerticalScrollBarEnabled = showsVerticalScrollIndicator
        scroller.clipChildren = false
        scroller.addView(content, FrameLayout.LayoutParams(content.layoutParams?.width ?: 0, content.layoutParams?.height ?: 0))
        scroller.setOnScrollChangeListener { _, x, y, _, _ ->
            onOffsetChange?.invoke(x, y)
            onScroll?.invoke(x, y)
            if (isTouching && keyboardDismissMode != "none") rootView.findFocus()?.let(::hideKeyboard)
        }

        return scroller
    }
}

fun hideKeyboard(focused: View) {
    focused.context.getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(focused.windowToken, 0)
    focused.clearFocus()
}

/** Material's pull-to-refresh spinner: a circle that follows the pull, then spins while refreshing. */
private class RefreshIndicator(context: Context) : FrameLayout(context) {
    val size = dp(40f)
    var isRefreshing = false
        private set

    private val spinner = ProgressBar(context)

    init {
        background = android.graphics.drawable.GradientDrawable().apply {
            shape = android.graphics.drawable.GradientDrawable.OVAL
            setColor(ThemeColors.surface)
        }
        elevation = dp(6f).toFloat()
        val spinnerSize = dp(24f)
        addView(spinner, LayoutParams(spinnerSize, spinnerSize, android.view.Gravity.CENTER))
        visibility = View.INVISIBLE
    }

    fun isPastThreshold(pull: Float) = pull > dp(64f)

    /** Follows the finger, turning as it goes. */
    fun showPull(pull: Float, restingTop: Int) {
        visibility = View.VISIBLE
        translationY = restingTop + minOf(pull, dp(96f).toFloat()) + size / 4f
        rotation = pull
        alpha = (pull / dp(64f)).coerceIn(0.3f, 1f)
    }

    fun setRefreshing(refreshing: Boolean, restingTop: Int) {
        isRefreshing = refreshing

        if (refreshing) {
            visibility = View.VISIBLE
            alpha = 1f
            animate().translationY(restingTop + dp(16f).toFloat() + size).setDuration(200).start()
        } else {
            animate().translationY(0f).alpha(0f).setDuration(200).withEndAction { visibility = View.INVISIBLE }.start()
        }
    }
}

/**
 * With `pagingEnabled`, a scroll ends on a whole page: the next or previous one after a fling, the
 * nearest one after a slow drag.
 */
private interface PagingScroller {
    var pagingEnabled: Boolean
}

private class PagingHorizontalScrollView(context: Context) : HorizontalScrollView(context), PagingScroller {
    override var pagingEnabled = false
    private var didFling = false

    override fun fling(velocityX: Int) {
        if (!pagingEnabled) return super.fling(velocityX)

        didFling = true
        smoothScrollTo(pageOffset(scrollX, width, velocityX), 0)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        didFling = false
        val handled = super.onTouchEvent(event)
        if (pagingEnabled && isTouchEnd(event) && !didFling) smoothScrollTo(pageOffset(scrollX, width, 0), 0)

        return handled
    }
}

private class PagingVerticalScrollView(context: Context) : ScrollView(context), PagingScroller {
    override var pagingEnabled = false
    private var didFling = false

    override fun fling(velocityY: Int) {
        if (!pagingEnabled) return super.fling(velocityY)

        didFling = true
        smoothScrollTo(0, pageOffset(scrollY, height, velocityY))
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        didFling = false
        val handled = super.onTouchEvent(event)
        if (pagingEnabled && isTouchEnd(event) && !didFling) smoothScrollTo(0, pageOffset(scrollY, height, 0))

        return handled
    }
}

private fun isTouchEnd(event: MotionEvent) =
    event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL

/** The offset of the page to end on: the one in the fling's direction, or the nearest one. */
private fun pageOffset(offset: Int, pageSize: Int, velocity: Int): Int {
    if (pageSize == 0) return offset

    val page = offset.toFloat() / pageSize
    val targetPage = when {
        velocity > 0 -> kotlin.math.floor(page) + 1
        velocity < 0 -> kotlin.math.floor(page)
        else -> kotlin.math.round(page)
    }

    return targetPage.toInt() * pageSize
}

/**
 * Image view behind <Image>. Loads `data:` URIs (bundled images) and http(s) URLs off the main thread.
 * Mirrors ios/ImageView.swift: with `cache` "disk" (the default), downloads are kept on disk and decoded
 * images in memory; "memory" keeps only the decoded images; "none" keeps nothing.
 */
class RemoteImageView(context: Context) : ImageView(context) {
    /** The image changed, and with it the size the view measures. */
    var onImageChange: () -> Unit = {}

    /** "disk", "memory" or "none". Read when a download finishes, so it applies even when set after `source`. */
    var cachePolicy = "disk"

    private var source: String? = null
    private var bitmap: Bitmap? = null

    init {
        scaleType = ScaleType.CENTER_CROP
    }

    fun load(source: String?) {
        if (source == this.source) return

        this.source = source
        show(if (source != null && cachePolicy != "none") decodedImages.get(source) else null)
        if (source == null || bitmap != null) return

        val diskCache = ImageDiskCache(context.cacheDir)
        val readsDisk = cachePolicy == "disk"
        loader.execute {
            val cachedBytes = if (readsDisk) diskCache.read(source) else null
            val downloadedBytes = if (cachedBytes == null) runCatching { download(source) }.getOrNull() else null
            val bytes = cachedBytes ?: downloadedBytes ?: return@execute
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return@execute

            post {
                store(bitmap, downloadedBytes, source, diskCache)
                if (source == this.source) show(bitmap)
            }
        }
    }

    private fun store(bitmap: Bitmap, downloadedBytes: ByteArray?, source: String, diskCache: ImageDiskCache) {
        if (cachePolicy == "none") return

        decodedImages.put(source, bitmap)
        if (cachePolicy != "disk" || downloadedBytes == null || source.startsWith("data:")) return

        loader.execute { diskCache.write(source, downloadedBytes) }
    }

    private fun show(nextBitmap: Bitmap?) {
        if (nextBitmap === bitmap) return

        bitmap = nextBitmap
        setImageBitmap(nextBitmap)
        onImageChange()
    }

    /**
     * Without a width or height, the image takes its own size, a pixel per dp; given one of them, the other
     * follows its aspect ratio, as on the web.
     */
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val density = resources.displayMetrics.density
        val naturalWidth = (bitmap?.width ?: 0) * density
        val naturalHeight = (bitmap?.height ?: 0) * density
        val widthMode = MeasureSpec.getMode(widthMeasureSpec)
        val heightMode = MeasureSpec.getMode(heightMeasureSpec)
        val width = MeasureSpec.getSize(widthMeasureSpec).toFloat()
        val height = MeasureSpec.getSize(heightMeasureSpec).toFloat()
        val maxWidth = if (widthMode == MeasureSpec.UNSPECIFIED) Float.POSITIVE_INFINITY else width
        val maxHeight = if (heightMode == MeasureSpec.UNSPECIFIED) Float.POSITIVE_INFINITY else height
        val aspectRatio = naturalWidth / naturalHeight

        val (measuredWidth, measuredHeight) = when {
            widthMode == MeasureSpec.EXACTLY && heightMode == MeasureSpec.EXACTLY -> width to height
            naturalWidth == 0f || naturalHeight == 0f ->
                (if (widthMode == MeasureSpec.EXACTLY) width else 0f) to (if (heightMode == MeasureSpec.EXACTLY) height else 0f)
            widthMode == MeasureSpec.EXACTLY -> width to min(width / aspectRatio, maxHeight)
            heightMode == MeasureSpec.EXACTLY -> min(height * aspectRatio, maxWidth) to height
            else -> {
                val scale = minOf(1f, maxWidth / naturalWidth, maxHeight / naturalHeight)
                naturalWidth * scale to naturalHeight * scale
            }
        }
        setMeasuredDimension(measuredWidth.roundToInt(), measuredHeight.roundToInt())
    }

    private fun download(source: String): ByteArray {
        if (source.startsWith("data:")) return Base64.decode(source.substringAfter(","), Base64.DEFAULT)

        return URL(source).openStream().use { it.readBytes() }
    }

    companion object {
        private val loader = Executors.newFixedThreadPool(4)

        /** Decoded images, an eighth of the app's memory at most: one that comes back on screen shows at once. */
        private val decodedImages = object : LruCache<String, Bitmap>((Runtime.getRuntime().maxMemory() / 8).toInt()) {
            override fun sizeOf(key: String, value: Bitmap) = value.byteCount
        }

        val scaleTypes = mapOf(
            "cover" to ScaleType.CENTER_CROP,
            "contain" to ScaleType.FIT_CENTER,
            "stretch" to ScaleType.FIT_XY,
            "center" to ScaleType.CENTER_INSIDE,
        )
    }
}

/**
 * Downloaded images by url, in the app's cache folder, which Android may empty when storage runs low. Past
 * its limit, the images used least recently go first.
 */
private class ImageDiskCache(cacheDirectory: File) {
    private val directory = File(cacheDirectory, "nativue-images")

    fun read(source: String): ByteArray? {
        val file = fileFor(source)
        if (!file.exists()) return null

        file.setLastModified(System.currentTimeMillis())

        return runCatching { file.readBytes() }.getOrNull()
    }

    fun write(source: String, bytes: ByteArray) {
        directory.mkdirs()
        val partialFile = File(directory, "${fileFor(source).name}.partial")
        partialFile.writeBytes(bytes)
        partialFile.renameTo(fileFor(source)) // whole files only: a reader never sees half an image
        trim()
    }

    private fun fileFor(source: String): File {
        val hash = MessageDigest.getInstance("SHA-256").digest(source.toByteArray())

        return File(directory, hash.joinToString("") { "%02x".format(it) })
    }

    private fun trim() {
        val files = directory.listFiles()?.sortedBy(File::lastModified) ?: return
        var totalSize = files.sumOf(File::length)

        for (file in files) {
            if (totalSize <= MAX_BYTE_COUNT) break

            totalSize -= file.length()
            file.delete()
        }
    }

    companion object {
        const val MAX_BYTE_COUNT = 100L * 1024 * 1024
    }
}

/** Single-line text field behind <TextInput>. Mirrors ios/TextInputView.swift. */
class TextInputView(context: Context) : android.widget.EditText(context), ThemeAware {
    /** Without a `color` style, the text follows the theme. */
    var styleColor: Int? = null
        set(value) {
            field = value
            applyThemeColors()
        }

    // Limitation: A value JS sets on purpose that equals text typed earlier in the same editing session is
    // ignored too; tag each change with a counter if that ever matters.
    private val textsSentToJavaScript = mutableSetOf<String>()
    var isSettingTextFromJavaScript = false
        private set

    override fun applyThemeColors() {
        setTextColor(styleColor ?: ThemeColors.text)
        setHintTextColor(ThemeColors.placeholder)
    }

    fun recordTextSentToJavaScript() {
        textsSentToJavaScript.add(text.toString())
    }

    override fun onFocusChanged(focused: Boolean, direction: Int, previouslyFocusedRect: android.graphics.Rect?) {
        super.onFocusChanged(focused, direction, previouslyFocusedRect)
        if (!focused) textsSentToJavaScript.clear()
    }

    /**
     * JS echoes every keystroke back (v-model / :value). A late echo would overwrite characters typed
     * meanwhile, so values this field already sent are ignored; only real changes from JS are applied.
     */
    fun setTextFromJavaScript(newText: String) {
        if (newText == text.toString() || newText in textsSentToJavaScript) return

        isSettingTextFromJavaScript = true
        setText(newText)
        setSelection(newText.length)
        isSettingTextFromJavaScript = false
    }
}

/** A Switch that tells JS's own changes (v-model) apart from the user's. */
class ToggleSwitch(context: Context) : Switch(context) {
    var isSettingFromJavaScript = false
        private set

    fun setCheckedFromJavaScript(checked: Boolean) {
        isSettingFromJavaScript = true
        isChecked = checked
        isSettingFromJavaScript = false
    }
}
