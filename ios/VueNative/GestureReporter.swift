import UIKit

/// Native recognizers behind @pan, @pinch and @rotate on any view. Every change goes to JS with the
/// gesture's state, so it can move the view through its style.
final class GestureReporter: NSObject, UIGestureRecognizerDelegate {
    private static let stateNames: [UIGestureRecognizer.State: String] = [
        .began: "began", .changed: "changed", .ended: "ended", .cancelled: "cancelled", .failed: "failed",
    ]

    private let report: (String, [String: Any]) -> Void
    private var recognizersByEvent: [String: UIGestureRecognizer] = [:]

    init(report: @escaping (String, [String: Any]) -> Void) {
        self.report = report
    }

    func setReporting(_ event: String, _ isReporting: Bool, on view: UIView) {
        if !isReporting, let recognizer = recognizersByEvent.removeValue(forKey: event) {
            view.removeGestureRecognizer(recognizer)
        }

        guard isReporting, recognizersByEvent[event] == nil, let recognizer = makeRecognizer(event) else { return }

        recognizer.delegate = self
        view.addGestureRecognizer(recognizer)
        recognizersByEvent[event] = recognizer
    }

    private func makeRecognizer(_ event: String) -> UIGestureRecognizer? {
        switch event {
        case "pan": UIPanGestureRecognizer(target: self, action: #selector(handlePan))
        case "pinch": UIPinchGestureRecognizer(target: self, action: #selector(handlePinch))
        case "rotate": UIRotationGestureRecognizer(target: self, action: #selector(handleRotation))
        default: nil
        }
    }

    /// In the superview's coordinates, so moving the view with a transform doesn't skew the numbers.
    @objc private func handlePan(_ recognizer: UIPanGestureRecognizer) {
        let translation = recognizer.translation(in: recognizer.view?.superview)
        let velocity = recognizer.velocity(in: recognizer.view?.superview)

        send("pan", recognizer, [
            "translationX": translation.x, "translationY": translation.y,
            "velocityX": velocity.x, "velocityY": velocity.y,
        ])
    }

    @objc private func handlePinch(_ recognizer: UIPinchGestureRecognizer) {
        send("pinch", recognizer, ["scale": recognizer.scale, "velocity": recognizer.velocity])
    }

    /// `rotation` is in radians.
    @objc private func handleRotation(_ recognizer: UIRotationGestureRecognizer) {
        send("rotate", recognizer, ["rotation": recognizer.rotation, "velocity": recognizer.velocity])
    }

    private func send(_ event: String, _ recognizer: UIGestureRecognizer, _ payload: [String: Any]) {
        guard let state = Self.stateNames[recognizer.state] else { return }

        report(event, payload.merging(["state": state]) { current, _ in current })
    }

    // Pinch and rotate (and a pan) at the same time, like moving a photo with two fingers.
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        true
    }
}
