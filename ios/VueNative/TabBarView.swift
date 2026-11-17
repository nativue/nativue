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
}
