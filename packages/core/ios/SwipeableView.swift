import UIKit

/// View behind <Swipeable>: children are [left actions, right actions, row]. The row slides with a
/// horizontal drag, revealing the actions of the side it uncovers. Released past half of them (or
/// flicked), it stays open; a tap on the open row, or on an action, closes it. Driven natively, so the
/// row follows the finger without a round trip to JS.
final class SwipeableView: UIView, UIGestureRecognizerDelegate {
    private lazy var panRecognizer = UIPanGestureRecognizer(target: self, action: #selector(handlePan))
    private lazy var rowTapRecognizer = UITapGestureRecognizer(target: self, action: #selector(close))
    private lazy var actionTapRecognizer = UITapGestureRecognizer(target: self, action: #selector(close))
    private var translationAtStart: CGFloat = 0

    private var leftActionsView: UIView? { subviews.count > 2 ? subviews[0] : nil }
    private var rightActionsView: UIView? { subviews.count > 2 ? subviews[1] : nil }
    private var rowView: UIView? { subviews.count > 2 ? subviews[2] : nil }
    private var leftActionsWidth: CGFloat { leftActionsView?.bounds.width ?? 0 }
    private var rightActionsWidth: CGFloat { rightActionsView?.bounds.width ?? 0 }
    private var translation: CGFloat { rowView?.transform.tx ?? 0 }

    override init(frame: CGRect) {
        super.init(frame: frame)

        clipsToBounds = true
        actionTapRecognizer.cancelsTouchesInView = false // the action's own press still fires

        for recognizer in [panRecognizer, rowTapRecognizer, actionTapRecognizer] {
            recognizer.delegate = self
            addGestureRecognizer(recognizer)
        }
        setOpen(false)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func layoutSubviews() {
        super.layoutSubviews()

        showActions(for: translation)
    }

    @objc private func handlePan(_ recognizer: UIPanGestureRecognizer) {
        switch recognizer.state {
        case .began:
            translationAtStart = translation

        case .changed:
            let target = translationAtStart + recognizer.translation(in: self).x
            moveRow(to: min(max(target, -rightActionsWidth * 1.5), leftActionsWidth * 1.5))
            showActions(for: translation)

        case .ended, .cancelled:
            settle(at: restingTranslation(velocity: recognizer.velocity(in: self).x))

        default:
            break
        }
    }

    /// Open on the side being uncovered if dragged past half its actions or flicked that way.
    private func restingTranslation(velocity: CGFloat) -> CGFloat {
        if translation < 0, velocity < -500 || (translation < -rightActionsWidth / 2 && velocity < 500) {
            return -rightActionsWidth
        }
        if translation > 0, velocity > 500 || (translation > leftActionsWidth / 2 && velocity > -500) {
            return leftActionsWidth
        }

        return 0
    }

    @objc private func close() {
        settle(at: 0)
    }

    private func moveRow(to translation: CGFloat) {
        rowView?.transform = CGAffineTransform(translationX: translation, y: 0)
    }

    /// Only the uncovered side shows: the row's rounded corners would reveal the other.
    private func showActions(for translation: CGFloat) {
        leftActionsView?.isHidden = translation <= 0
        rightActionsView?.isHidden = translation >= 0
    }

    private func settle(at target: CGFloat) {
        setOpen(target != 0)

        UIView.animate(
            withDuration: 0.4, delay: 0, usingSpringWithDamping: 0.85, initialSpringVelocity: 0,
            options: [.allowUserInteraction, .beginFromCurrentState]
        ) { [self] in
            moveRow(to: target)
        } completion: { [self] _ in
            showActions(for: translation)
        }
    }

    /// While open, the row ignores touches: a tap on it closes instead of pressing it.
    private func setOpen(_ isOpen: Bool) {
        rowView?.isUserInteractionEnabled = !isOpen
        rowTapRecognizer.isEnabled = isOpen
        actionTapRecognizer.isEnabled = isOpen
    }

    // MARK: - UIGestureRecognizerDelegate

    /// Only horizontal drags: vertical ones scroll the list.
    override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer === panRecognizer else { return true }

        let velocity = panRecognizer.velocity(in: self)

        return abs(velocity.x) > abs(velocity.y)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        let isOnRow = rowView?.frame.contains(touch.location(in: self)) ?? false

        if gestureRecognizer === rowTapRecognizer { return isOnRow }
        if gestureRecognizer === actionTapRecognizer { return !isOnRow }

        return true
    }

    /// The action tap runs alongside the action's press.
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        gestureRecognizer === actionTapRecognizer
    }
}
