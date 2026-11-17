import UIKit

/// React Native's LayoutAnimation: JS configures it before a state change, and every frame, opacity, color
/// and transform that change in that batch animate natively, with no JS per frame.
struct LayoutAnimation {
    let type: String
    let duration: TimeInterval
    let springDamping: CGFloat

    /// { type?: 'easeInEaseOut' | 'linear' | 'spring', duration? (ms), springDamping? }
    init(config: [String: Any]) {
        type = config["type"] as? String ?? "easeInEaseOut"
        duration = (config["duration"] as? Double ?? 300) / 1000
        springDamping = config["springDamping"] as? CGFloat ?? 0.7
    }

    func perform(_ changes: @escaping () -> Void) {
        let options: UIView.AnimationOptions = [.allowUserInteraction, .beginFromCurrentState]

        if type == "spring" {
            UIView.animate(
                withDuration: duration, delay: 0, usingSpringWithDamping: springDamping,
                initialSpringVelocity: 0, options: options, animations: changes
            )
        } else {
            let curve: UIView.AnimationOptions = type == "linear" ? .curveLinear : .curveEaseInOut
            UIView.animate(withDuration: duration, delay: 0, options: options.union(curve), animations: changes)
        }
    }
}
