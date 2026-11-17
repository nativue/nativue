import UIKit
import yoga

/// Pads its content by the safe area insets (status bar, notch, home indicator), like React Native's
/// SafeAreaView: padding set in its style is replaced by the insets.
final class SafeAreaView: UIView {
    var onSafeAreaInsetsChange: (() -> Void)?

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        onSafeAreaInsetsChange?()
    }
}

extension NativeNode {
    /// Returns whether the padding changed, so callers only re-layout when needed
    /// (the new layout can move the view, which fires another insets change).
    func applySafeAreaPadding() -> Bool {
        let insets = view.safeAreaInsets
        let paddingByEdge: [(YGEdge, CGFloat)] = [
            (.top, insets.top),
            (.left, insets.left),
            (.bottom, insets.bottom),
            (.right, insets.right),
        ]

        var changed = false

        for (edge, inset) in paddingByEdge where YGNodeStyleGetPadding(yogaNode, edge).value != Float(inset) {
            YGNodeStyleSetPadding(yogaNode, edge, Float(inset))
            changed = true
        }

        return changed
    }
}
