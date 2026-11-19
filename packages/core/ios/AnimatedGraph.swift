import QuartzCore
import UIKit

/// Native side of Animated: values and their interpolations, the views
/// whose opacity and transform follow them, and the animations that move them on every frame
/// (CADisplayLink), with no JS per frame. Main thread only.
final class AnimatedGraph {
    private enum Node {
        case value(Double)
        case interpolation(parent: Int, inputRange: [Double], outputRange: [Double], clamps: Bool)
    }

    /// opacity / transform steps hold node ids; constant transform steps keep their value.
    private struct ViewBinding {
        weak var view: UIView?
        let opacityNodeId: Int?
        let transformSteps: [(name: String, nodeId: Int?, value: Double)]?
    }

    /// Called when an animation ends: its id, and whether it ran to the end (not stopped).
    var onAnimationEnd: ((Int, Bool) -> Void)?

    private var nodesById: [Int: Node] = [:]
    private var bindingsByViewId: [Int: ViewBinding] = [:]
    private var animationsByNodeId: [Int: ValueAnimation] = [:]
    private var displayLink: CADisplayLink?

    func reset() {
        displayLink?.invalidate()
        displayLink = nil
        nodesById = [:]
        bindingsByViewId = [:]
        animationsByNodeId = [:]
    }

    func createNode(id: Int, config: [String: Any]) {
        guard config["type"] as? String == "interpolation" else {
            nodesById[id] = .value(config["value"] as? Double ?? 0)
            return
        }

        nodesById[id] = .interpolation(
            parent: config["parent"] as? Int ?? 0,
            inputRange: config["inputRange"] as? [Double] ?? [],
            outputRange: config["outputRange"] as? [Double] ?? [],
            clamps: config["extrapolate"] as? String == "clamp"
        )
    }

    /// From JS, a scroll or a gesture: wins over a running animation.
    func setValue(_ value: Double, ofNode id: Int) {
        stopAnimation(ofNode: id)
        nodesById[id] = .value(value)
        updateBoundViews()
    }

    func value(ofNode id: Int) -> Double {
        switch nodesById[id] {
        case .value(let value):
            value
        case .interpolation(let parent, let inputRange, let outputRange, let clamps):
            Self.interpolate(value(ofNode: parent), inputRange, outputRange, clamps: clamps)
        case nil:
            0
        }
    }

    /// `binding` is { opacity?: nodeId, transform?: [{ name, node } | { name, value }] }, or nil to unbind.
    func bind(view: UIView, viewId: Int, binding: [String: Any]?) {
        guard let binding else {
            bindingsByViewId[viewId] = nil
            return
        }

        let steps = (binding["transform"] as? [[String: Any]])?.map { step in
            (name: step["name"] as? String ?? "", nodeId: step["node"] as? Int, value: step["value"] as? Double ?? 0)
        }
        bindingsByViewId[viewId] = ViewBinding(
            view: view, opacityNodeId: binding["opacity"] as? Int, transformSteps: steps
        )
        updateBoundViews()
    }

    /// Whether an Animated value sets this view's opacity or transform.
    func drives(_ view: UIView) -> Bool {
        bindingsByViewId.values.contains { $0.view === view }
    }

    // MARK: - Animations

    func startAnimation(id: Int, nodeId: Int, config: [String: Any]) {
        stopAnimation(ofNode: nodeId)
        animationsByNodeId[nodeId] = ValueAnimation(id: id, from: value(ofNode: nodeId), config: config)

        if displayLink == nil {
            displayLink = CADisplayLink(target: self, selector: #selector(step))
            displayLink?.add(to: .main, forMode: .common) // keeps running while a scroll view tracks
        }
    }

    func stopAnimation(ofNode nodeId: Int) {
        guard let animation = animationsByNodeId.removeValue(forKey: nodeId) else { return }

        onAnimationEnd?(animation.id, false)
    }

    @objc private func step(_ displayLink: CADisplayLink) {
        for (nodeId, var animation) in animationsByNodeId {
            let isFinished = animation.advance(to: displayLink.targetTimestamp)
            nodesById[nodeId] = .value(animation.value)

            if !isFinished {
                animationsByNodeId[nodeId] = animation
            } else if !animation.restartIfRepeating() {
                animationsByNodeId[nodeId] = nil
                onAnimationEnd?(animation.id, true)
            } else {
                animationsByNodeId[nodeId] = animation
            }
        }

        updateBoundViews()

        if animationsByNodeId.isEmpty {
            displayLink.invalidate()
            self.displayLink = nil
        }
    }

    // MARK: - Views

    /// Never animated by UIKit: a binding made in a layout animation's batch would hold the view at
    /// its first value until the layout animation ends.
    private func updateBoundViews() {
        UIView.performWithoutAnimation {
            for (viewId, binding) in bindingsByViewId {
                guard let view = binding.view else {
                    bindingsByViewId[viewId] = nil
                    continue
                }

                if let opacityNodeId = binding.opacityNodeId {
                    view.alpha = CGFloat(value(ofNode: opacityNodeId))
                }
                if let steps = binding.transformSteps {
                    let resolvedSteps = steps.map { step in [step.name: step.nodeId.map(value(ofNode:)) ?? step.value] }
                    view.transform = NativeNode.affineTransform(resolvedSteps)
                }
            }
        }
    }

    /// Piecewise linear; past the ends it extends the nearest segment
    /// unless clamped.
    static func interpolate(_ input: Double, _ inputRange: [Double], _ outputRange: [Double], clamps: Bool) -> Double {
        guard inputRange.count >= 2, inputRange.count == outputRange.count else { return input }

        let input = clamps ? min(max(input, inputRange[0]), inputRange[inputRange.count - 1]) : input
        var segment = 1
        while segment < inputRange.count - 1 && input > inputRange[segment] { segment += 1 }

        let (inputStart, inputEnd) = (inputRange[segment - 1], inputRange[segment])
        let (outputStart, outputEnd) = (outputRange[segment - 1], outputRange[segment])
        let progress = inputEnd == inputStart ? 0 : (input - inputStart) / (inputEnd - inputStart)

        return outputStart + progress * (outputEnd - outputStart)
    }
}

/// One running timing or spring animation of a value.
private struct ValueAnimation {
    let id: Int
    private(set) var value: Double

    private let config: [String: Any]
    private let startValue: Double
    private let toValue: Double
    private var remainingIterations: Int
    private var startTime: CFTimeInterval?
    private var lastTime: CFTimeInterval?
    private var velocity: Double

    init(id: Int, from startValue: Double, config: [String: Any]) {
        self.id = id
        self.config = config
        self.startValue = startValue
        value = startValue
        toValue = config["toValue"] as? Double ?? 0
        remainingIterations = config["iterations"] as? Int ?? 1
        velocity = config["velocity"] as? Double ?? 0
    }

    /// Returns whether this iteration reached its end.
    mutating func advance(to time: CFTimeInterval) -> Bool {
        if startTime == nil { startTime = time }

        return config["type"] as? String == "spring" ? advanceSpring(to: time) : advanceTiming(to: time)
    }

    /// For loops: starts over from the starting value. Returns false when there's nothing left to run.
    mutating func restartIfRepeating() -> Bool {
        guard remainingIterations != 1 else { return false }

        if remainingIterations > 1 { remainingIterations -= 1 }
        value = startValue
        velocity = config["velocity"] as? Double ?? 0
        startTime = nil
        lastTime = nil

        return true
    }

    private mutating func advanceTiming(to time: CFTimeInterval) -> Bool {
        let duration = (config["duration"] as? Double ?? 500) / 1000
        let progress = duration > 0 ? min(1, (time - startTime!) / duration) : 1

        value = startValue + (toValue - startValue) * Self.ease(progress, config["easing"] as? String)

        return progress >= 1
    }

    /// Damped spring, integrated in 1 ms steps; at rest when both speed and distance are negligible.
    private mutating func advanceSpring(to time: CFTimeInterval) -> Bool {
        let stiffness = config["stiffness"] as? Double ?? 100
        let damping = config["damping"] as? Double ?? 10
        let mass = config["mass"] as? Double ?? 1
        let elapsed = min(time - (lastTime ?? time), 1.0 / 30) // a stalled frame doesn't explode the spring
        lastTime = time

        for _ in 0..<Int((elapsed * 1000).rounded()) {
            let acceleration = (-stiffness * (value - toValue) - damping * velocity) / mass
            velocity += acceleration * 0.001
            value += velocity * 0.001
        }

        guard abs(velocity) < 0.001 && abs(value - toValue) < 0.001 else { return false }

        value = toValue

        return true
    }

    private static func ease(_ progress: Double, _ easing: String?) -> Double {
        switch easing {
        case "linear":
            progress
        case "easeIn":
            progress * progress * progress
        case "easeOut":
            1 - pow(1 - progress, 3)
        default:
            progress < 0.5 ? 4 * pow(progress, 3) : 1 - pow(-2 * progress + 2, 3) / 2
        }
    }
}
