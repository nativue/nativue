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
/// JS renders. JS owns the stack; a pop started natively (back button, edge swipe, sheet swiped down) is
/// reported back so JS drops the screen too.
///
/// A modal screen (`stackPresentation`) starts a group: it and the screens pushed after it live in their own
/// navigation controller, presented over the previous group's.
final class ScreenStackView: UIView, ScreenContainer, UINavigationControllerDelegate,
    UIAdaptivePresentationControllerDelegate
{
    static let modalPresentationStyles: [String: UIModalPresentationStyle] = [
        "modal": .automatic,
        "formSheet": .formSheet,
        "fullScreenModal": .fullScreen,
    ]

    private let navigationController = UINavigationController()
    private var modalNavigationControllers: [UINavigationController] = []
    private var screens: [ScreenController] = []
    private var isSyncScheduled = false
    /// Presenting or dismissing: UIKit refuses another until it completes, which syncs again.
    private var isPresentationChanging = false

    private var navigationControllers: [UINavigationController] { [navigationController] + modalNavigationControllers }

    override init(frame: CGRect) {
        super.init(frame: frame)

        configure(navigationController)
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

    private func configure(_ navigationController: UINavigationController) {
        navigationController.delegate = self
        navigationController.navigationBar.prefersLargeTitles = true // screens opt in per navigationItem
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

    /// Read through the stack, since a screen being swiped away has already left its navigation controller.
    func navigationBarBottom(for screen: ScreenController) -> CGFloat {
        let groupIndex = screenGroups().firstIndex { group in group.contains { $0 === screen } } ?? 0
        let navigationController = navigationControllers.indices.contains(groupIndex)
            ? navigationControllers[groupIndex]
            : navigationController

        return navigationController.navigationBar.frame.maxY
    }

    func screenDidChangeHeaderVisibility(_ screen: ScreenController) {
        guard let navigationController = screen.navigationController,
              navigationController.topViewController === screen else { return }

        navigationController.setNavigationBarHidden(!screen.headerShown, animated: true)
    }

    /// One sync per batch: a push and a pop in the same update become a single animated transition.
    func scheduleSync() {
        guard !isSyncScheduled else { return }

        isSyncScheduled = true
        DispatchQueue.main.async { [self] in
            isSyncScheduled = false
            syncViewControllers()
        }
    }

    private func screenGroups() -> [[ScreenController]] {
        var groups: [[ScreenController]] = [[]]

        for screen in screens {
            if screen.isModal && !groups[groups.count - 1].isEmpty { groups.append([]) }
            groups[groups.count - 1].append(screen)
        }

        return groups
    }

    private func syncViewControllers() {
        updateBackButtonTitles()

        let groups = screenGroups()
        setScreens(groups[0], in: navigationController)

        guard !isPresentationChanging else { return }

        syncModals(Array(groups.dropFirst()))
    }

    private func setScreens(_ group: [ScreenController], in navigationController: UINavigationController) {
        guard !navigationController.viewControllers.elementsEqual(group, by: ===) else { return }

        let animated = !navigationController.viewControllers.isEmpty && window != nil
        navigationController.setViewControllers(group, animated: animated)
    }

    /// Modals whose first screen is gone are dismissed (with everything above them); then the remaining
    /// groups are updated and new ones presented, one at a time.
    private func syncModals(_ groups: [[ScreenController]]) {
        let keptCount = zip(modalNavigationControllers, groups)
            .prefix { navigationController, group in navigationController.viewControllers.first === group.first }
            .count

        if keptCount < modalNavigationControllers.count {
            return dismissModals(from: keptCount)
        }

        for (navigationController, group) in zip(modalNavigationControllers, groups) {
            setScreens(group, in: navigationController)
        }

        if groups.count > modalNavigationControllers.count {
            presentModal(groups[modalNavigationControllers.count])
        }
    }

    private func dismissModals(from index: Int) {
        let presenter = modalNavigationControllers[index].presentingViewController
        modalNavigationControllers.removeSubrange(index...)

        changePresentation { completion in presenter?.dismiss(animated: true, completion: completion) }
    }

    private func presentModal(_ group: [ScreenController]) {
        let modalNavigationController = UINavigationController()
        let presenter = modalNavigationControllers.last ?? navigationController

        configure(modalNavigationController)
        modalNavigationController.setViewControllers(group, animated: false)
        modalNavigationController.modalPresentationStyle =
            Self.modalPresentationStyles[group[0].stackPresentation] ?? .automatic
        modalNavigationController.presentationController?.delegate = self
        modalNavigationControllers.append(modalNavigationController)

        changePresentation { completion in
            presenter.present(modalNavigationController, animated: true, completion: completion)
        }
    }

    private func changePresentation(_ change: (@escaping () -> Void) -> Void) {
        isPresentationChanging = true
        change { [weak self] in
            self?.isPresentationChanging = false
            self?.scheduleSync()
        }
    }

    /// iOS reads the back button title from the previous screen; headerBackTitle is set on the current one.
    private func updateBackButtonTitles() {
        for (index, screen) in screens.enumerated().dropFirst() {
            screens[index - 1].navigationItem.backButtonTitle = screen.headerBackTitle
        }
    }

    private func reportDismissed(_ dismissedScreens: [ScreenController]) {
        guard !dismissedScreens.isEmpty else { return }

        screens.removeAll { screen in dismissedScreens.contains { $0 === screen } }
        dismissedScreens.forEach { $0.onEvent?("dismissed", nil) }
    }

    // MARK: - UIAdaptivePresentationControllerDelegate

    /// A sheet swiped down took its group, and any modal above it, with it.
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        guard let index = modalNavigationControllers.firstIndex(where: {
            $0 === presentationController.presentedViewController
        }) else { return }

        let dismissedScreens = modalNavigationControllers[index...].flatMap(\.viewControllers)
        modalNavigationControllers.removeSubrange(index...)
        reportDismissed(dismissedScreens.compactMap { $0 as? ScreenController })
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
                hideHeaderWhenSwipeCompletes(in: navigationController, coordinator: coordinator)
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
    private func hideHeaderWhenSwipeCompletes(
        in navigationController: UINavigationController,
        coordinator: UIViewControllerTransitionCoordinator
    ) {
        let navigationBar = navigationController.navigationBar

        coordinator.animate(alongsideTransition: { _ in
            navigationBar.alpha = 0
        }, completion: { context in
            navigationBar.alpha = 1
            if !context.isCancelled { navigationController.setNavigationBarHidden(true, animated: false) }
        })
    }

    /// Screens of this navigation controller's group that left it without JS asking were popped natively.
    func navigationController(
        _ navigationController: UINavigationController,
        didShow viewController: UIViewController,
        animated: Bool
    ) {
        guard let groupIndex = navigationControllers.firstIndex(where: { $0 === navigationController }) else { return }

        let groups = screenGroups()
        guard groups.indices.contains(groupIndex) else { return }

        let shownScreens = navigationController.viewControllers
        reportDismissed(groups[groupIndex].filter { screen in !shownScreens.contains { $0 === screen } })
    }
}
