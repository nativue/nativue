package dev.vuenative

import android.annotation.SuppressLint
import android.content.Context
import android.os.SystemClock
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.animation.OvershootInterpolator
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot

/**
 * Touch tracking behind @pan, @pinch and @rotate on any view. Every change goes to JS with the
 * gesture's state ("began", "changed", "ended", "cancelled"), so it can move the view through its
 * style; with Animated.event the values move natively and JS only hears the start and the end.
 * Numbers are in dp (and dp per second); rotation in radians. Mirrors ios/GestureReporter.swift.
 */
class GestureReporter(
    private val view: View,
    private val report: (eventName: String, payload: Map<String, Any>) -> Unit,
    private val setAnimatedValue: (nodeId: Int, value: Double) -> Unit,
) : View.OnTouchListener {
    private val reportedEvents = mutableSetOf<String>()

    /** From Animated.event: event field -> animated value id. */
    private val animatedMappingsByEvent = HashMap<String, Map<String, Int>>()

    private val density = view.resources.displayMetrics.density
    private val touchSlop = ViewConfiguration.get(view.context).scaledTouchSlop
    private var velocityTracker: VelocityTracker? = null

    // The centroid of the fingers, rebased when one is added or lifted so the pan doesn't jump.
    private var panOrigin = Pair(0f, 0f)
    private var panOffset = Pair(0f, 0f)
    private var isPanning = false
    private var lastTranslation = Pair(0f, 0f)

    private var startSpan = 0f
    private var startAngle = 0f
    private var scaleBase = 1f
    private var rotationBase = 0f
    private var isPinching = false
    private var isRotating = false
    private var lastScale = 1f
    private var lastRotation = 0f
    private var lastTime = 0L

    fun setReporting(eventName: String, isReporting: Boolean) {
        if (isReporting) reportedEvents.add(eventName) else reportedEvents.remove(eventName)
        view.setOnTouchListener(if (reportedEvents.isEmpty()) null else this)
    }

    fun setAnimatedMapping(eventName: String, mapping: Map<String, Int>?) {
        if (mapping == null) animatedMappingsByEvent.remove(eventName) else animatedMappingsByEvent[eventName] = mapping
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouch(touchedView: View, event: MotionEvent): Boolean {
        val tracker = velocityTracker ?: VelocityTracker.obtain().also { velocityTracker = it }
        // Raw coordinates: moving the view with a transform doesn't skew the numbers.
        val rawEvent = MotionEvent.obtain(event).apply { setLocation(event.rawX, event.rawY) }
        tracker.addMovement(rawEvent)
        rawEvent.recycle()

        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> panOrigin = centroid(event)
            MotionEvent.ACTION_POINTER_DOWN, MotionEvent.ACTION_POINTER_UP -> rebase(event)
            MotionEvent.ACTION_MOVE -> track(event)
            MotionEvent.ACTION_UP -> finish("ended")
            MotionEvent.ACTION_CANCEL -> finish("cancelled")
        }

        return true
    }

    private fun track(event: MotionEvent) {
        val (x, y) = centroid(event)
        val translationX = x - panOrigin.first + panOffset.first
        val translationY = y - panOrigin.second + panOffset.second

        if ("pan" in reportedEvents) {
            if (!isPanning && hypot(translationX, translationY) > touchSlop) {
                isPanning = true
                view.parent?.requestDisallowInterceptTouchEvent(true)
                sendPan("began", translationX, translationY)
            } else if (isPanning) {
                sendPan("changed", translationX, translationY)
            }
        }

        if (event.pointerCount >= 2) trackTwoFingers(event)
    }

    private fun trackTwoFingers(event: MotionEvent) {
        val span = hypot(event.getX(1) - event.getX(0), event.getY(1) - event.getY(0))
        val angle = atan2(event.getY(1) - event.getY(0), event.getX(1) - event.getX(0))
        if (startSpan == 0f) {
            startSpan = span
            startAngle = angle
            lastTime = SystemClock.uptimeMillis()
            view.parent?.requestDisallowInterceptTouchEvent(true)
        }

        val scale = scaleBase * span / startSpan
        val rotation = rotationBase + angle - startAngle
        val elapsedSeconds = ((SystemClock.uptimeMillis() - lastTime) / 1000f).coerceAtLeast(0.001f)

        if ("pinch" in reportedEvents) {
            val state = if (isPinching) "changed" else "began"
            isPinching = true
            send("pinch", state, mapOf("scale" to scale.toDouble(), "velocity" to ((scale - lastScale) / elapsedSeconds).toDouble()))
        }

        if ("rotate" in reportedEvents) {
            val state = if (isRotating) "changed" else "began"
            isRotating = true
            send("rotate", state, mapOf("rotation" to rotation.toDouble(), "velocity" to ((rotation - lastRotation) / elapsedSeconds).toDouble()))
        }

        lastScale = scale
        lastRotation = rotation
        lastTime = SystemClock.uptimeMillis()
    }

    /** A finger added or lifted moves the centroid: keep the translation so far, and start pinching over. */
    private fun rebase(event: MotionEvent) {
        val liftedIndex = if (event.actionMasked == MotionEvent.ACTION_POINTER_UP) event.actionIndex else -1
        val (x, y) = centroid(event)
        panOffset = Pair(x - panOrigin.first + panOffset.first, y - panOrigin.second + panOffset.second)
        panOrigin = centroid(event, excludingIndex = liftedIndex)

        scaleBase = lastScale
        rotationBase = lastRotation
        startSpan = 0f
    }

    private fun finish(state: String) {
        val (velocityX, velocityY) = velocities()

        if (isPanning) sendPan(state, lastTranslation.first, lastTranslation.second, velocityX, velocityY)
        if (isPinching) send("pinch", state, mapOf("scale" to lastScale.toDouble(), "velocity" to 0.0))
        if (isRotating) send("rotate", state, mapOf("rotation" to lastRotation.toDouble(), "velocity" to 0.0))

        isPanning = false
        isPinching = false
        isRotating = false
        panOffset = Pair(0f, 0f)
        scaleBase = 1f
        rotationBase = 0f
        lastScale = 1f
        lastRotation = 0f
        startSpan = 0f
        velocityTracker?.recycle()
        velocityTracker = null
    }

    private fun sendPan(state: String, translationX: Float, translationY: Float, velocityX: Float? = null, velocityY: Float? = null) {
        lastTranslation = Pair(translationX, translationY)
        val (currentVelocityX, currentVelocityY) = if (velocityX != null && velocityY != null) Pair(velocityX, velocityY) else velocities()

        send("pan", state, mapOf(
            "translationX" to (translationX / density).toDouble(),
            "translationY" to (translationY / density).toDouble(),
            "velocityX" to (currentVelocityX / density).toDouble(),
            "velocityY" to (currentVelocityY / density).toDouble(),
        ))
    }

    private fun velocities(): Pair<Float, Float> {
        val tracker = velocityTracker ?: return Pair(0f, 0f)
        tracker.computeCurrentVelocity(1000)

        return Pair(tracker.xVelocity, tracker.yVelocity)
    }

    /** A mapped gesture moves its values here; JS only hears when it starts and ends. */
    private fun send(eventName: String, state: String, payload: Map<String, Double>) {
        animatedMappingsByEvent[eventName]?.let { mapping ->
            for ((field, nodeId) in mapping) payload[field]?.let { setAnimatedValue(nodeId, it) }
            if (state == "changed") return
        }

        report(eventName, payload + ("state" to state))
    }

    private fun centroid(event: MotionEvent, excludingIndex: Int = -1): Pair<Float, Float> {
        var x = 0f
        var y = 0f
        var count = 0
        val offsetX = event.rawX - event.x
        val offsetY = event.rawY - event.y

        for (index in 0 until event.pointerCount) {
            if (index == excludingIndex) continue
            x += event.getX(index) + offsetX
            y += event.getY(index) + offsetY
            count++
        }

        return if (count == 0) Pair(0f, 0f) else Pair(x / count, y / count)
    }
}

/**
 * View behind <Swipeable>: children are [left actions, right actions, row]. The row slides with a
 * horizontal drag, revealing the actions of the side it uncovers. Released past half of them (or
 * flicked), it stays open; a tap on the open row, or on an action, closes it. Driven natively, so the
 * row follows the finger without a round trip to JS. Mirrors ios/SwipeableView.swift.
 */
class SwipeableView(context: Context) : ContainerView(context) {
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    private var startX = 0f
    private var startY = 0f
    private var translationAtStart = 0f
    private var isDragging = false
    private var isOpen = false
    private var velocityTracker: VelocityTracker? = null

    private val leftActionsView: View? get() = if (childCount > 2) getChildAt(0) else null
    private val rightActionsView: View? get() = if (childCount > 2) getChildAt(1) else null
    private val rowView: View? get() = if (childCount > 2) getChildAt(2) else null
    private val leftActionsWidth: Float get() = leftActionsView?.width?.toFloat() ?: 0f
    private val rightActionsWidth: Float get() = rightActionsView?.width?.toFloat() ?: 0f
    private val translation: Float get() = rowView?.translationX ?: 0f

    init {
        clipChildren = true
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        showActions(translation)
    }

    /** Horizontal drags move the row (vertical ones scroll the list); an open row takes taps to close. */
    override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
        trackVelocity(event)

        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                startX = event.x
                startY = event.y
                translationAtStart = translation
                isDragging = false
                return isOpen && isOnRow(event)
            }

            MotionEvent.ACTION_MOVE -> {
                val deltaX = event.x - startX
                if (!isDragging && abs(deltaX) > touchSlop && abs(deltaX) > abs(event.y - startY)) {
                    isDragging = true
                    parent?.requestDisallowInterceptTouchEvent(true)
                }
            }

            // A tap on an action: its own press fires, and the row closes.
            MotionEvent.ACTION_UP -> if (isOpen && !isOnRow(event)) post { settle(0f) }
        }

        return isDragging
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        trackVelocity(event)

        when (event.actionMasked) {
            MotionEvent.ACTION_MOVE -> if (isDragging) {
                val target = translationAtStart + event.x - startX
                rowView?.translationX = target.coerceIn(-rightActionsWidth * 1.5f, leftActionsWidth * 1.5f)
                showActions(translation)
            }

            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                velocityTracker?.computeCurrentVelocity(1000)
                val velocity = (velocityTracker?.xVelocity ?: 0f) / resources.displayMetrics.density
                velocityTracker?.recycle()
                velocityTracker = null

                settle(if (isDragging) restingTranslation(velocity) else 0f)
                isDragging = false
            }
        }

        return true
    }

    private fun trackVelocity(event: MotionEvent) {
        val tracker = velocityTracker ?: VelocityTracker.obtain().also { velocityTracker = it }
        tracker.addMovement(event)
    }

    /** Open on the side being uncovered if dragged past half its actions or flicked that way (dp/s). */
    private fun restingTranslation(velocity: Float): Float {
        if (translation < 0 && (velocity < -500 || (translation < -rightActionsWidth / 2 && velocity < 500))) {
            return -rightActionsWidth
        }
        if (translation > 0 && (velocity > 500 || (translation > leftActionsWidth / 2 && velocity > -500))) {
            return leftActionsWidth
        }

        return 0f
    }

    private fun isOnRow(event: MotionEvent): Boolean {
        val row = rowView ?: return false

        return event.x >= row.left + row.translationX && event.x <= row.right + row.translationX
    }

    /** Only the uncovered side shows: the row's rounded corners would reveal the other. */
    private fun showActions(translation: Float) {
        leftActionsView?.visibility = if (translation > 0) View.VISIBLE else View.INVISIBLE
        rightActionsView?.visibility = if (translation < 0) View.VISIBLE else View.INVISIBLE
    }

    private fun settle(target: Float) {
        isOpen = target != 0f
        val row = rowView ?: return

        row.animate()
            .translationX(target)
            .setDuration(400)
            .setInterpolator(OvershootInterpolator(0.6f))
            .setUpdateListener { showActions(row.translationX) }
            .withEndAction { showActions(row.translationX) }
            .start()
    }
}
