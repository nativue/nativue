import UIKit

/// Presents the content of a <Modal>. The <Modal> itself is a hidden placeholder in the tree; its children
/// live in this controller's view, laid out as a separate Yoga root (the node's `contentNode`).
final class ModalController: UIViewController, ContentRoot, UIAdaptivePresentationControllerDelegate {
    static let presentationStyles: [String: UIModalPresentationStyle] = [
        "fullScreen": .fullScreen,
        "pageSheet": .pageSheet,
        "formSheet": .formSheet,
        "overFullScreen": .overFullScreen,
    ]

    let contentNode = NativeNode(view: UIView(), measuresContent: false)
    let placeholderView = UIView()

    var onEvent: ((String) -> Void)?
    /// The app's window: the placeholder's is nil while a full-screen modal covers it.
    var hostWindow: () -> UIWindow? = { nil }
    /// The placeholder is in the window, or covered by a full-screen modal: not in a screen pushed under
    /// another, an unselected tab or a deactivated <KeepAlive>.
    var isPlaceholderOnScreen: () -> Bool = { false }
    var animationType = "none"
    var presentationStyleName = "fullScreen"
    var transparent = false

    private var isPresented: Bool { presentingViewController != nil }
    /// What JS last asked for; applied again when a running transition ends, which UIKit would ignore.
    private var wantsVisible = false
    private var isTransitioning = false

    override func loadView() {
        view = contentNode.view
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()

        layoutContent()
    }

    func layoutContent() {
        guard isViewLoaded else { return }

        contentNode.calculateLayout(width: view.bounds.width, height: view.bounds.height)
    }

    /// Deferred to after the current batch, so the placeholder is already on screen when presenting.
    func setVisible(_ visible: Bool) {
        wantsVisible = visible
        DispatchQueue.main.async { [self] in applyVisibility() }
    }

    /// The <Modal> left the tree (an ancestor's v-if): its content must go too.
    func detach() {
        wantsVisible = false
        applyVisibility()
    }

    /// Closed while its placeholder is off screen (a tab switched, a <KeepAlive> deactivated), and shown
    /// again when it's back, if JS still wants it.
    func followPlaceholder() {
        guard !isTransitioning else { return }

        if !isPlaceholderOnScreen() { dismissIfPresented() } else if wantsVisible && !isPresented { present() }
    }

    private func applyVisibility() {
        guard !isTransitioning else { return }

        if wantsVisible { present() } else { dismissIfPresented() }
    }

    private func present() {
        guard !isPresented, isPlaceholderOnScreen(), let presenter = topViewController() else { return }

        view.backgroundColor = transparent ? .clear : .systemBackground
        modalPresentationStyle = transparent
            ? .overFullScreen
            : Self.presentationStyles[presentationStyleName] ?? .fullScreen
        modalTransitionStyle = animationType == "fade" ? .crossDissolve : .coverVertical

        isTransitioning = true
        presenter.present(self, animated: animationType != "none") { [self] in
            isTransitioning = false
            onEvent?("show")
            applyVisibility()
        }
        presentationController?.delegate = self
    }

    private func dismissIfPresented() {
        guard isPresented else { return }

        isTransitioning = true
        dismiss(animated: animationType != "none") { [self] in
            isTransitioning = false
            onEvent?("dismiss")
            applyVisibility()
        }
    }

    private func topViewController() -> UIViewController? {
        var top = hostWindow()?.rootViewController

        while let presented = top?.presentedViewController, presented !== self {
            top = presented
        }

        return top
    }

    // A sheet swiped down is already gone; JS is expected to set `visible` to false.
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        onEvent?("requestclose")
        onEvent?("dismiss")
    }
}
