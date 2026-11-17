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

    @objc private func handleTap(_ recognizer: UITapGestureRecognizer) {
        guard dismissesKeyboardOnTap else { return }

        let tappedView = hitTest(recognizer.location(in: self), with: nil)
        let tappedTextInput = sequence(first: tappedView, next: { $0?.superview }).contains { $0 is UITextField }
        guard !tappedTextInput else { return }

        window?.endEditing(true)
    }
}
