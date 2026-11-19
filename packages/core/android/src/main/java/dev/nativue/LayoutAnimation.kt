package dev.nativue

import android.animation.ArgbEvaluator
import android.animation.ValueAnimator
import android.view.View
import android.view.animation.Interpolator
import android.view.animation.LinearInterpolator
import android.view.animation.PathInterpolator
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * LayoutAnimation: JS configures it before a state change, and every frame, opacity, background color
 * and transform that change in that batch animate natively, with no JS per frame. Views that appear
 * fade in where they land. Mirrors ios/LayoutAnimation.swift.
 *
 * config: { type?: 'easeInEaseOut' | 'linear' | 'spring', duration? (ms), springDamping? }
 */
class LayoutAnimation(config: Map<*, *>) {
    private val type = config["type"] as? String ?: "easeInEaseOut"
    private val duration = (config["duration"] as? Number)?.toLong() ?: 300
    private val springDamping = (config["springDamping"] as? Number)?.toFloat() ?: 0.7f

    private class State(view: View, val box: BoxDrawable?) {
        val left = view.left
        val top = view.top
        val right = view.right
        val bottom = view.bottom
        val alpha = view.alpha
        val translationX = view.translationX
        val translationY = view.translationY
        val scaleX = view.scaleX
        val scaleY = view.scaleY
        val rotation = view.rotation
        val backgroundColor = box?.backgroundColor ?: 0
        val isPlaced = view.width > 0 || view.height > 0
    }

    private var statesByView = HashMap<View, State>()

    /** Call before the batch's changes. */
    fun captureStart(nodes: Collection<NativeNode>) {
        statesByView = HashMap(nodes.associate { node -> node.view to State(node.view, node.view.background as? BoxDrawable) })
    }

    /**
     * Call after the batch is applied and laid out: animates every view from where it was. The opacity
     * and transform of a view an Animated value drives are left to it: animating them here too would
     * overwrite its frames, and end on the value captured now.
     */
    fun animateChanges(nodes: Collection<NativeNode>, isDrivenByAnimated: (View) -> Boolean) {
        val changes = nodes.mapNotNull { node ->
            val start = statesByView[node.view]?.takeIf { it.isPlaced }
            val end = State(node.view, node.view.background as? BoxDrawable)
            Triple(node.view, start, end).takeIf { start == null || !start.sameAs(end) }
        }
        if (changes.isEmpty()) return

        val drivenViews = changes.map { it.first }.filterTo(HashSet(), isDrivenByAnimated)
        changes.forEach { (view, start, end) -> apply(view, start, end, 0f, view in drivenViews) }

        ValueAnimator.ofFloat(0f, 1f).apply {
            duration = this@LayoutAnimation.duration
            interpolator = interpolator()
            addUpdateListener { animator ->
                val progress = animator.animatedValue as Float
                changes.forEach { (view, start, end) -> apply(view, start, end, progress, view in drivenViews) }
            }
            start()
        }
    }

    /** A view without a start state (new, or never placed) only fades in. */
    private fun apply(view: View, start: State?, end: State, progress: Float, isDrivenByAnimated: Boolean) {
        if (start == null) {
            if (!isDrivenByAnimated) view.alpha = end.alpha * progress
            return
        }

        val left = lerp(start.left, end.left, progress)
        val top = lerp(start.top, end.top, progress)
        val right = lerp(start.right, end.right, progress)
        val bottom = lerp(start.bottom, end.bottom, progress)
        if (left != view.left || top != view.top || right != view.right || bottom != view.bottom) {
            view.measure(exactly(right - left), exactly(bottom - top))
            view.layout(left, top, right, bottom)
        }

        if (!isDrivenByAnimated) {
            view.alpha = lerp(start.alpha, end.alpha, progress)
            view.translationX = lerp(start.translationX, end.translationX, progress)
            view.translationY = lerp(start.translationY, end.translationY, progress)
            view.scaleX = lerp(start.scaleX, end.scaleX, progress)
            view.scaleY = lerp(start.scaleY, end.scaleY, progress)
            view.rotation = lerp(start.rotation, end.rotation, progress)
        }

        end.box?.takeIf { start.backgroundColor != end.backgroundColor }?.let { box ->
            box.backgroundColor = argbEvaluator.evaluate(progress.coerceIn(0f, 1f), start.backgroundColor, end.backgroundColor) as Int
            box.invalidateSelf()
        }
    }

    private fun State.sameAs(other: State) =
        left == other.left && top == other.top && right == other.right && bottom == other.bottom &&
            alpha == other.alpha && translationX == other.translationX && translationY == other.translationY &&
            scaleX == other.scaleX && scaleY == other.scaleY && rotation == other.rotation &&
            backgroundColor == other.backgroundColor

    private fun interpolator(): Interpolator = when (type) {
        "linear" -> LinearInterpolator()
        "spring" -> SpringInterpolator(springDamping)
        else -> PathInterpolator(0.42f, 0f, 0.58f, 1f) // UIKit's ease in ease out
    }

    private companion object {
        val argbEvaluator = ArgbEvaluator()

        fun lerp(start: Int, end: Int, progress: Float) = (start + (end - start) * progress).toInt()

        fun lerp(start: Float, end: Float, progress: Float) = start + (end - start) * progress
    }
}

/**
 * A damped spring settling by the end of the animation, like UIView's spring animation: the lower the
 * damping ratio, the more it overshoots and oscillates.
 */
private class SpringInterpolator(private val dampingRatio: Float) : Interpolator {
    override fun getInterpolation(input: Float): Float {
        val ratio = dampingRatio.coerceIn(0.05f, 0.99f).toDouble()
        val frequency = 6.5 / ratio // e^(-ratio * frequency) ~ 0.0015: at rest when the animation ends
        val dampedFrequency = frequency * sqrt(1 - ratio * ratio)
        val time = input.toDouble()
        val envelope = exp(-ratio * frequency * time)

        return (1 - envelope * (cos(dampedFrequency * time) + ratio * frequency / dampedFrequency * sin(dampedFrequency * time))).toFloat()
    }
}
