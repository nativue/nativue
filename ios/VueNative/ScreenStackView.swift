import UIKit

/// Children of the native tree that are laid out as their own Yoga root, inside a view controller.
protocol ContentRoot: AnyObject {
    func layoutContent()
}

/// Native views whose <Screen> children are view controllers (<ScreenStack>, <TabBar>), not subviews.
protocol ScreenContainer: AnyObject {
    func insertScreen(_ screen: ScreenController, at index: Int)
    func removeScreen(_ screen: ScreenController)
}

extension UIView {
    /// View controller containment, so an embedded controller gets appearance and trait updates.
    /// Call from didMoveToWindow.
    func embedInNearestViewController(_ controller: UIViewController) {
        guard window != nil else {
            controller.willMove(toParent: nil)
            controller.removeFromParent()
            return
        }

        let nearestViewController = sequence(first: next, next: { $0?.next })
            .lazy
            .compactMap { $0 as? UIViewController }
            .first
        guard controller.parent == nil, let parent = nearestViewController else { return }

        parent.addChild(controller)
        controller.didMove(toParent: parent)
    }
}

/// View behind <ScreenStack>: a UINavigationController whose view controllers mirror the <Screen> children
/// JS renders. JS owns the stack; a pop started natively (back button, edge swipe) is reported back so JS
/// drops the screen too (like react-native-screens).
final class ScreenStackView: UIView, ScreenContainer, UINavigationControllerDelegate {
    private let navigationController = UINavigationController()
    private var screens: [ScreenController] = []
    private var isSyncScheduled = false

    override init(frame: CGRect) {
        super.init(frame: frame)

        navigationController.delegate = self
        navigationController.navigationBar.prefersLargeTitles = true // screens opt in per navigationItem
        navigationController.view.frame = bounds
        navigationController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(navigationController.view)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()

        embedInNearestViewController(navigationController)
    }

    /// Also called when JS moves a screen, so it drops the old position first.
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

    var navigationBarBottom: CGFloat { navigationController.navigationBar.frame.maxY }

    func screenDidChangeHeaderVisibility(_ screen: ScreenController) {
        guard navigationController.topViewController === screen else { return }

        navigationController.setNavigationBarHidden(!screen.headerShown, animated: true)
    }

    /// One sync per batch: a push and a pop in the same update become a single animated transition.
    private func scheduleSync() {
        guard !isSyncScheduled else { return }

        isSyncScheduled = true
        DispatchQueue.main.async { [self] in
            isSyncScheduled = false
            syncViewControllers()
        }
    }

    private func syncViewControllers() {
        updateBackButtonTitles()

        guard !navigationController.viewControllers.elementsEqual(screens, by: ===) else { return }

        let animated = !navigationController.viewControllers.isEmpty && window != nil
        navigationController.setViewControllers(screens, animated: animated)
    }

    /// iOS reads the back button title from the previous screen; expo-router sets it on the current one.
    private func updateBackButtonTitles() {
        for (index, screen) in screens.enumerated().dropFirst() {
            screens[index - 1].navigationItem.backButtonTitle = screen.headerBackTitle
        }
    }

    // MARK: - UINavigationControllerDelegate

    func navigationController(
        _ navigationController: UINavigationController,
        willShow viewController: UIViewController,
        animated: Bool
    ) {
        let screen = viewController as? ScreenController
        let hidesHeader = !(screen?.headerShown ?? true)

        // Touching the bar during an interactive pop (edge swipe) commits its transition at once, so the
        // previous screen's large title would jump in as soon as the swipe starts: only change what changes.
        if navigationController.isNavigationBarHidden != hidesHeader {
            if hidesHeader, let coordinator = navigationController.transitionCoordinator, coordinator.isInteractive {
                hideHeaderWhenSwipeCompletes(coordinator: coordinator)
            } else {
                navigationController.setNavigationBarHidden(hidesHeader, animated: animated)
            }
        }

        let navigationBar = navigationController.navigationBar
        guard navigationBar.tintColor != screen?.headerTintColor else { return }

        // Alongside the transition, so a cancelled swipe restores the color too.
        let previousTintColor = navigationBar.tintColor
        guard let transitionCoordinator = navigationController.transitionCoordinator else {
            navigationBar.tintColor = screen?.headerTintColor
            return
        }

        transitionCoordinator.animate(alongsideTransition: { _ in
            navigationBar.tintColor = screen?.headerTintColor
        }, completion: { context in
            if context.isCancelled { navigationBar.tintColor = previousTintColor }
        })
    }

    /// Hiding the bar during an edge swipe makes UIKit re-layout its buttons, and a cancelled swipe then
    /// jumps them back. Instead the bar fades out with the swipe and is hidden only once it completes (the
    /// revealed screen ignores the bar anyway, see ScreenController.ignoreHeaderInSafeArea).
    private func hideHeaderWhenSwipeCompletes(coordinator: UIViewControllerTransitionCoordinator) {
        let navigationBar = navigationController.navigationBar

        coordinator.animate(alongsideTransition: { _ in
            navigationBar.alpha = 0
        }, completion: { [navigationController] context in
            navigationBar.alpha = 1
            if !context.isCancelled { navigationController.setNavigationBarHidden(true, animated: false) }
        })
    }

    /// Screens that left the navigation controller without JS asking were popped natively.
    func navigationController(
        _ navigationController: UINavigationController,
        didShow viewController: UIViewController,
        animated: Bool
    ) {
        let shownScreens = navigationController.viewControllers
        let poppedScreens = screens.filter { screen in !shownScreens.contains { $0 === screen } }
        guard !poppedScreens.isEmpty else { return }

        screens.removeAll { screen in poppedScreens.contains { $0 === screen } }
        poppedScreens.forEach { $0.onEvent?("dismissed", nil) }
    }
}
