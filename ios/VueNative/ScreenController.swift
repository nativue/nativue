import UIKit
import yoga

/// View controller behind <Screen>: its view is the root of the screen's content (a Yoga root), and its
/// navigationItem is the native header.
final class ScreenController: UIViewController, ContentRoot {
    let contentNode = NativeNode(view: UIView(), measuresContent: false)
    weak var stack: ScreenStackView?

    var onEvent: ((String, Any?) -> Void)?
    var headerTintColor: UIColor?
    var headerBackTitle: String?

    var headerShown = true {
        didSet { stack?.screenDidChangeHeaderVisibility(self) }
    }

    init() {
        super.init(nibName: nil, bundle: nil)

        navigationItem.largeTitleDisplayMode = .never
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func loadView() {
        view = contentNode.view
        view.backgroundColor = .systemBackground
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()

        layoutContent()
    }

    /// The view extends under the header, so its background is there during transitions; the content
    /// starts below it (only the top: the bottom inset is <SafeAreaView>'s job, like everywhere else).
    func layoutContent() {
        guard isViewLoaded else { return }

        YGNodeStyleSetPadding(contentNode.yogaNode, .top, Float(view.safeAreaInsets.top))
        contentNode.calculateLayout(width: view.bounds.width, height: view.bounds.height)
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()

        layoutContent()
    }

    /// `items` are [{ title?, systemImage? }]; presses are reported with the side and index, since the
    /// handlers live in JS.
    func setHeaderItems(_ items: Any?, side: String) {
        let descriptions = items as? [[String: Any]] ?? []
        let barButtonItems = descriptions.enumerated().map { index, description in
            makeBarButtonItem(description, side: side, index: index)
        }

        if side == "right" {
            navigationItem.rightBarButtonItems = barButtonItems
        } else {
            navigationItem.leftBarButtonItems = barButtonItems
            navigationItem.leftItemsSupplementBackButton = true
        }
    }

    private func makeBarButtonItem(_ description: [String: Any], side: String, index: Int) -> UIBarButtonItem {
        let title = description["title"] as? String ?? ""
        let image = (description["systemImage"] as? String).flatMap { UIImage(systemName: $0) }

        let action = UIAction(title: title, image: image) { [unowned self] _ in
            onEvent?("headeritempress", ["side": side, "index": index])
        }

        return UIBarButtonItem(primaryAction: action)
    }
}
