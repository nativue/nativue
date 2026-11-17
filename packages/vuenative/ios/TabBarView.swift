import UIKit

/// View behind <TabBar>: a UITabBarController whose tabs are the <Screen> children JS renders. JS owns
/// the selected tab; a tap on the bar is reported so JS switches to it.
final class TabBarView: UIView, ScreenContainer, UITabBarControllerDelegate {
    var onTabChange: ((Int) -> Void)?

    private let tabBarController = UITabBarController()
    private var screens: [ScreenController] = []
    private var selectedIndex = 0
    private var isSyncScheduled = false

    override init(frame: CGRect) {
        super.init(frame: frame)

        tabBarController.delegate = self
        tabBarController.view.frame = bounds
        tabBarController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(tabBarController.view)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()

        embedInNearestViewController(tabBarController)
    }

    /// Also called when JS reorders tabs, so it drops the old position first.
    func insertScreen(_ screen: ScreenController, at index: Int) {
        screens.removeAll { $0 === screen }
        screen.container = self
        screens.insert(screen, at: min(index, screens.count))
        scheduleSync()
    }

    func removeScreen(_ screen: ScreenController) {
        screens.removeAll { $0 === screen }
        scheduleSync()
    }

    var tabBar: UITabBar { tabBarController.tabBar }

    /// Through the appearance: the glass tab bar (iOS 26) ignores unselectedItemTintColor.
    func setInactiveTintColor(_ color: UIColor?) {
        let appearance = tabBar.standardAppearance.copy()
        for itemAppearance in [
            appearance.stackedLayoutAppearance,
            appearance.inlineLayoutAppearance,
            appearance.compactInlineLayoutAppearance,
        ] {
            itemAppearance.normal.iconColor = color
            itemAppearance.normal.titleTextAttributes = color.map { [.foregroundColor: $0] } ?? [:]
        }
        tabBar.standardAppearance = appearance
        tabBar.scrollEdgeAppearance = appearance
    }

    func select(index: Int) {
        selectedIndex = index
        scheduleSync()
    }

    /// One sync per batch, after the tabs and the selection of that batch are in.
    private func scheduleSync() {
        guard !isSyncScheduled else { return }

        isSyncScheduled = true
        DispatchQueue.main.async { [self] in
            isSyncScheduled = false

            if !(tabBarController.viewControllers ?? []).elementsEqual(screens, by: ===) {
                tabBarController.setViewControllers(screens, animated: false)
            }

            if screens.indices.contains(selectedIndex), tabBarController.selectedIndex != selectedIndex {
                tabBarController.selectedIndex = selectedIndex
            }
        }
    }

    func tabBarController(_ tabBarController: UITabBarController, didSelect viewController: UIViewController) {
        selectedIndex = tabBarController.selectedIndex
        onTabChange?(selectedIndex)
    }

    /// Tapping the selected tab again: UIKit already pops its stack to the first screen; on that first
    /// screen, scroll its list to the top instead (UIKit can't find our scroll views).
    func tabBarController(_ tabBarController: UITabBarController, shouldSelect viewController: UIViewController) -> Bool {
        if viewController === tabBarController.selectedViewController, !hasScreensToPop(viewController) {
            firstScrollView(in: viewController.view)?.scrollToTop()
        }

        return true
    }

    private func hasScreensToPop(_ viewController: UIViewController) -> Bool {
        let stack = viewController.children.lazy.compactMap { $0 as? UINavigationController }.first

        return (stack?.viewControllers.count ?? 0) > 1
    }

    /// Breadth-first, so the list of the screen wins over one nested deeper.
    private func firstScrollView(in root: UIView) -> VueScrollView? {
        var queue = [root]

        while !queue.isEmpty {
            let view = queue.removeFirst()
            if let scrollView = view as? VueScrollView { return scrollView }
            queue.append(contentsOf: view.subviews)
        }

        return nil
    }
}

private extension UIScrollView {
    func scrollToTop() {
        setContentOffset(CGPoint(x: contentOffset.x, y: -adjustedContentInset.top), animated: true)
    }
}
