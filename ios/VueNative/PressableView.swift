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

    @objc private func handleLongPress(_ recognizer: UILongPressGestureRecognizer) {
        guard recognizer.state == .began else { return }

        didLongPress = true
        onEvent?("longpress")
    }
}
