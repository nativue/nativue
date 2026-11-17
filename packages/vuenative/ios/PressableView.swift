import UIKit

/// View behind <Pressable>: reports pressin / pressout / press / longpress. The pressed state lives in JS.
final class PressableView: UIControl {
    var onEvent: ((String) -> Void)?

    /// Like React Native: once a long press fires, the release is not a press.
    private var didLongPress = false

    private lazy var longPressRecognizer: UILongPressGestureRecognizer = {
        let recognizer = UILongPressGestureRecognizer(target: self, action: #selector(handleLongPress(_:)))
        recognizer.cancelsTouchesInView = false // keep tracking the touch, so pressout waits for the release

        return recognizer
    }()

    var reportsLongPress = false {
        didSet {
            if reportsLongPress { addGestureRecognizer(longPressRecognizer) }
            else { removeGestureRecognizer(longPressRecognizer) }
        }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)

        addAction(UIAction { [unowned self] _ in
            didLongPress = false
            onEvent?("pressin")
        }, for: .touchDown)

        addAction(UIAction { [unowned self] _ in
            onEvent?("pressout")
            if !didLongPress { onEvent?("press") }
        }, for: .touchUpInside)

        addAction(UIAction { [unowned self] _ in onEvent?("pressout") }, for: [.touchUpOutside, .touchCancel])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    /// Touches on plain children (containers, labels, images) press this control, like React Native's
    /// Pressable; interactive children (controls, scroll views, views with gestures) keep their touches.
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard let hitView = super.hitTest(point, with: event) else { return nil }

        return isInteractiveChild(hitView) ? hitView : self
    }

    private func isInteractiveChild(_ view: UIView) -> Bool {
        sequence(first: view, next: \.superview)
            .prefix { $0 !== self }
            .contains { $0 is UIControl || $0 is UIScrollView || !($0.gestureRecognizers ?? []).isEmpty }
    }

    @objc private func handleLongPress(_ recognizer: UILongPressGestureRecognizer) {
        guard recognizer.state == .began else { return }

        didLongPress = true
        onEvent?("longpress")
    }
}
