import UIKit

/// Scroll view behind <ScrollView>.
final class VueScrollView: UIScrollView {
    static let keyboardDismissModes: [String: UIScrollView.KeyboardDismissMode] = [
        "none": .none,
        "on-drag": .onDrag,
        "interactive": .interactive,
    ]

    /// React Native's keyboardShouldPersistTaps="never" (its default): a tap outside a text input
    /// closes the keyboard. "always" / "handled" turn it off.
    var dismissesKeyboardOnTap = true

    /// Set when JS listens to @scroll. Called on every scroll step and size change (FlatList windowing).
    // ponytail: one JS call per frame while scrolling; coalesce / add scrollEventThrottle if JS falls behind.
    var onScroll: ((CGRect) -> Void)? {
        didSet { lastReportedBounds = nil }
    }

    private var lastReportedBounds: CGRect?

    override init(frame: CGRect) {
        super.init(frame: frame)

        contentInsetAdjustmentBehavior = .never // like React Native: <SafeAreaView> handles it
        alwaysBounceVertical = true

        let tapRecognizer = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        tapRecognizer.cancelsTouchesInView = false // buttons inside still receive their taps
        addGestureRecognizer(tapRecognizer)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    // UIKit lays out a scroll view on every scroll step, so this sees both scrolling and resizing.
    override func layoutSubviews() {
        super.layoutSubviews()

        guard let onScroll, bounds != lastReportedBounds else { return }

        lastReportedBounds = bounds
        onScroll(bounds)
    }

    /// UIScrollView refuses to cancel touches on UIControls, so a drag starting on a Pressable or Button
    /// wouldn't scroll. React Native scrolls in that case too.
    override func touchesShouldCancel(in view: UIView) -> Bool {
        true
    }

    @objc private func handleTap(_ recognizer: UITapGestureRecognizer) {
        guard dismissesKeyboardOnTap else { return }

        let tappedView = hitTest(recognizer.location(in: self), with: nil)
        let tappedTextInput = sequence(first: tappedView, next: { $0?.superview }).contains { $0 is UITextField }
        guard !tappedTextInput else { return }

        window?.endEditing(true)
    }
}
