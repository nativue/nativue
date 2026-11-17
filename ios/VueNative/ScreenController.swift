import UIKit
import yoga

/// View controller behind <Screen>: its view is the root of the screen's content (a Yoga root), and its
/// navigationItem is the native header.
final class ScreenController: UIViewController, ContentRoot {
    let contentNode = NativeNode(view: UIView(), measuresContent: false)
    /// The <ScreenStack> or <TabBar> showing this screen.
    weak var container: ScreenContainer?

    var onEvent: ((String, Any?) -> Void)?
    var headerTintColor: UIColor?
    var headerBackTitle: String?

    var headerShown = true {
        didSet {
            (container as? ScreenStackView)?.screenDidChangeHeaderVisibility(self)
            layoutContent()
        }
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
    /// starts below a visible header. Without one (header hidden, a tab, a nested navigator) the content
    /// fills the screen and <SafeAreaView> opts into the insets, like React Native.
    func layoutContent() {
        guard isViewLoaded else { return }

        updateTopPadding()
        contentNode.calculateLayout(width: view.bounds.width, height: view.bounds.height)
    }

    /// From this screen's own `headerShown`, never from the bar's current state: the bar belongs to the
    /// screen on top and is shown or hidden mid-transition, which would move the screens below it. The
    /// bar keeps its frame while hidden, so its bottom edge is stable.
    private func updateTopPadding() {
        let headerBottom = headerShown ? navigationController?.navigationBar.frame.maxY ?? 0 : 0

        YGNodeStyleSetPadding(contentNode.yogaNode, .top, Float(headerBottom))
    }

    /// Only used when the screen is a tab: `systemImage` is an SF Symbol name.
    func setTabBarItem(label: String?, systemImage: String?, badge: String?) {
        tabBarItem.title = label ?? tabBarItem.title
        tabBarItem.image = systemImage.flatMap { UIImage(systemName: $0) } ?? tabBarItem.image
        tabBarItem.badgeValue = badge
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()

        ignoreHeaderInSafeArea()
        layoutContent()
    }

    /// A screen without a header must not move while the stack's bar is still visible over it (an edge
    /// swipe back to it): its safe area excludes whatever the bar adds over the window's.
    private func ignoreHeaderInSafeArea() {
        guard let window = view.window else { return }

        let insetWithoutAdjustment = view.safeAreaInsets.top - additionalSafeAreaInsets.top
        let headerOverlap = headerShown ? 0 : max(0, insetWithoutAdjustment - window.safeAreaInsets.top)

        if additionalSafeAreaInsets.top != -headerOverlap { additionalSafeAreaInsets.top = -headerOverlap }
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
