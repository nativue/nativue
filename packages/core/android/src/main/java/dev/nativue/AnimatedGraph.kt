package dev.nativue

import android.view.Choreographer
import android.view.View
import java.lang.ref.WeakReference
import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * Native side of Animated: values and their interpolations, the views whose opacity and transform
 * follow them, and the animations that move them on every frame (Choreographer), with no JS per frame.
 * Main thread only. Mirrors ios/AnimatedGraph.swift.
 */
class AnimatedGraph {
    private sealed interface Node {
        data class Value(val value: Double) : Node

        data class Interpolation(
            val parent: Int,
            val inputRange: List<Double>,
            val outputRange: List<Double>,
            val clamps: Boolean,
        ) : Node
    }

    /** Opacity and transform steps hold node ids; constant transform steps keep their value. */
    private class ViewBinding(view: View, val opacityNodeId: Int?, val transformSteps: List<TransformStep>?) {
        val view = WeakReference(view)
    }

    private data class TransformStep(val name: String, val nodeId: Int?, val value: Double)

    /** Called when an animation ends: its id, and whether it ran to the end (not stopped). */
    var onAnimationEnd: (animationId: Int, finished: Boolean) -> Unit = { _, _ -> }

    private val nodesById = HashMap<Int, Node>()
    private val bindingsByViewId = HashMap<Int, ViewBinding>()
    private val animationsByNodeId = HashMap<Int, ValueAnimation>()
    private var isFrameScheduled = false
    private val frameCallback = Choreographer.FrameCallback(::step)

    fun reset() {
        Choreographer.getInstance().removeFrameCallback(frameCallback)
        isFrameScheduled = false
        nodesById.clear()
        bindingsByViewId.clear()
        animationsByNodeId.clear()
    }

    fun createNode(id: Int, config: Map<*, *>) {
        if (config["type"] != "interpolation") {
            nodesById[id] = Node.Value(double(config["value"]) ?: 0.0)
            return
        }

        nodesById[id] = Node.Interpolation(
            parent = double(config["parent"])?.toInt() ?: 0,
            inputRange = doubles(config["inputRange"]),
            outputRange = doubles(config["outputRange"]),
            clamps = config["extrapolate"] == "clamp",
        )
    }

    /** From JS, a scroll or a gesture: wins over a running animation. */
    fun setValue(value: Double, nodeId: Int) {
        stopAnimation(nodeId)
        nodesById[nodeId] = Node.Value(value)
        updateBoundViews()
    }

    private fun value(nodeId: Int): Double = when (val node = nodesById[nodeId]) {
        is Node.Value -> node.value
        is Node.Interpolation -> interpolate(value(node.parent), node.inputRange, node.outputRange, node.clamps)
        null -> 0.0
    }

    /** [binding] is { opacity?: nodeId, transform?: [{ name, node } | { name, value }] }, or null to unbind. */
    fun bind(view: View, viewId: Int, binding: Map<*, *>?) {
        if (binding == null) {
            bindingsByViewId.remove(viewId)
            return
        }

        val steps = (binding["transform"] as? List<*>)?.filterIsInstance<Map<*, *>>()?.map { step ->
            TransformStep(step["name"] as? String ?: "", double(step["node"])?.toInt(), double(step["value"]) ?: 0.0)
        }
        bindingsByViewId[viewId] = ViewBinding(view, double(binding["opacity"])?.toInt(), steps)
        updateBoundViews()
    }

    fun drives(view: View): Boolean = bindingsByViewId.values.any { it.view.get() === view }

    // ---------- Animations ----------

    fun startAnimation(animationId: Int, nodeId: Int, config: Map<*, *>) {
        stopAnimation(nodeId)
        animationsByNodeId[nodeId] = ValueAnimation(animationId, value(nodeId), config)

        if (!isFrameScheduled) {
            isFrameScheduled = true
            Choreographer.getInstance().postFrameCallback(frameCallback)
        }
    }

    fun stopAnimation(nodeId: Int) {
        val animation = animationsByNodeId.remove(nodeId) ?: return

        onAnimationEnd(animation.id, false)
    }

    private fun step(frameTimeNanos: Long) {
        val time = frameTimeNanos / 1e9

        for ((nodeId, animation) in animationsByNodeId.toList()) {
            val isFinished = animation.advance(time)
            nodesById[nodeId] = Node.Value(animation.value)

            if (isFinished && !animation.restartIfRepeating()) {
                animationsByNodeId.remove(nodeId)
                onAnimationEnd(animation.id, true)
            }
        }

        updateBoundViews()

        isFrameScheduled = animationsByNodeId.isNotEmpty()
        if (isFrameScheduled) Choreographer.getInstance().postFrameCallback(frameCallback)
    }

    // ---------- Views ----------

    private fun updateBoundViews() {
        val iterator = bindingsByViewId.values.iterator()

        while (iterator.hasNext()) {
            val binding = iterator.next()
            val view = binding.view.get()
            if (view == null) {
                iterator.remove()
                continue
            }

            binding.opacityNodeId?.let { view.alpha = value(it).toFloat() }
            binding.transformSteps?.let { steps ->
                view.applyTransform(steps.map { step -> mapOf(step.name to (step.nodeId?.let(::value) ?: step.value)) })
            }
        }
    }

    companion object {
        /** Piecewise linear; past the ends it extends the nearest segment unless clamped. */
        fun interpolate(input: Double, inputRange: List<Double>, outputRange: List<Double>, clamps: Boolean): Double {
            if (inputRange.size < 2 || inputRange.size != outputRange.size) return input

            val clampedInput = if (clamps) input.coerceIn(inputRange.first(), inputRange.last()) else input
            var segment = 1
            while (segment < inputRange.size - 1 && clampedInput > inputRange[segment]) segment++

            val inputStart = inputRange[segment - 1]
            val inputEnd = inputRange[segment]
            val progress = if (inputEnd == inputStart) 0.0 else (clampedInput - inputStart) / (inputEnd - inputStart)

            return outputRange[segment - 1] + progress * (outputRange[segment] - outputRange[segment - 1])
        }
    }
}

private fun double(value: Any?): Double? = (value as? Number)?.toDouble()

private fun doubles(value: Any?): List<Double> = (value as? List<*>)?.mapNotNull(::double) ?: emptyList()

/** One running timing or spring animation of a value. */
private class ValueAnimation(val id: Int, private val startValue: Double, private val config: Map<*, *>) {
    var value = startValue
        private set

    private val toValue = double(config["toValue"]) ?: 0.0
    private var remainingIterations = double(config["iterations"])?.toInt() ?: 1
    private var velocity = double(config["velocity"]) ?: 0.0
    private var startTime: Double? = null
    private var lastTime: Double? = null

    /** Returns whether this iteration reached its end. */
    fun advance(time: Double): Boolean {
        if (startTime == null) startTime = time

        return if (config["type"] == "spring") advanceSpring(time) else advanceTiming(time)
    }

    /** For loops: starts over from the starting value. Returns false when there's nothing left to run. */
    fun restartIfRepeating(): Boolean {
        if (remainingIterations == 1) return false

        if (remainingIterations > 1) remainingIterations--
        value = startValue
        velocity = double(config["velocity"]) ?: 0.0
        startTime = null
        lastTime = null

        return true
    }

    private fun advanceTiming(time: Double): Boolean {
        val duration = (double(config["duration"]) ?: 500.0) / 1000
        val progress = if (duration > 0) minOf(1.0, (time - startTime!!) / duration) else 1.0

        value = startValue + (toValue - startValue) * ease(progress, config["easing"] as? String)

        return progress >= 1
    }

    /** Damped spring, integrated in 1 ms steps; at rest when both speed and distance are negligible. */
    private fun advanceSpring(time: Double): Boolean {
        val stiffness = double(config["stiffness"]) ?: 100.0
        val damping = double(config["damping"]) ?: 10.0
        val mass = double(config["mass"]) ?: 1.0
        val elapsed = minOf(time - (lastTime ?: time), 1.0 / 30) // a stalled frame doesn't explode the spring
        lastTime = time

        repeat((elapsed * 1000).roundToInt()) {
            val acceleration = (-stiffness * (value - toValue) - damping * velocity) / mass
            velocity += acceleration * 0.001
            value += velocity * 0.001
        }

        if (abs(velocity) >= 0.001 || abs(value - toValue) >= 0.001) return false

        value = toValue

        return true
    }

    private fun ease(progress: Double, easing: String?): Double = when (easing) {
        "linear" -> progress
        "easeIn" -> progress * progress * progress
        "easeOut" -> 1 - (1 - progress).pow(3)
        else -> if (progress < 0.5) 4 * progress.pow(3) else 1 - (-2 * progress + 2).pow(3) / 2
    }
}
