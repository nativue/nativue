import UIKit

/// View behind <KeyboardAvoidingView>: reports how much of it the keyboard covers, inside the keyboard's
/// own animation, so its content moves up in sync (React Native's behavior="padding").
final class KeyboardAvoidingView: UIView {
    var onKeyboardOverlapChange: ((CGFloat) -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillChangeFrame(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification,
            object: nil
        )
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    @objc private func keyboardWillChangeFrame(_ notification: Notification) {
        guard
            window != nil,
            let userInfo = notification.userInfo,
            let keyboardFrame = (userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue
        else { return }

        let keyboardTopInView = convert(keyboardFrame, from: nil).minY
        let overlap = max(0, bounds.maxY - keyboardTopInView)

        let duration = (userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        let curve = (userInfo[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt) ?? 7
        let options = UIView.AnimationOptions(rawValue: curve << 16)

        UIView.animate(withDuration: duration, delay: 0, options: options) { [weak self] in
            self?.onKeyboardOverlapChange?(overlap)
        }
    }
}
