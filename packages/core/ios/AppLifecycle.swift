import UIKit
import UserNotifications

/// A plugin that hears from the app: a push token, a remote notification, a URL. Implement only what
/// you need; the rest do nothing.
public protocol AppLifecycleListener: AnyObject {
    func didFinishLaunching(options: [UIApplication.LaunchOptionsKey: Any]?)
    func didRegisterForRemoteNotifications(deviceToken: Data)
    func didFailToRegisterForRemoteNotifications(error: Error)
    /// Every listener's runs at once; the app gets `newData` if any had new data.
    func didReceiveRemoteNotification(_ userInfo: [AnyHashable: Any]) async -> UIBackgroundFetchResult
    /// Custom schemes and universal links, before JavaScript's onOpenURL and the router. true: taken.
    func open(url: URL) -> Bool
}

public extension AppLifecycleListener {
    func didFinishLaunching(options: [UIApplication.LaunchOptionsKey: Any]?) {}
    func didRegisterForRemoteNotifications(deviceToken: Data) {}
    func didFailToRegisterForRemoteNotifications(error: Error) {}
    func didReceiveRemoteNotification(_ userInfo: [AnyHashable: Any]) async -> UIBackgroundFetchResult { .noData }
    func open(url: URL) -> Bool { false }
}

/// nativue is the notification center's delegate, so packages share it: never set it yourself.
public protocol NotificationCenterListener: AnyObject {
    /// How to show a notification while the app is open; nil leaves it to the others. The answers add up;
    /// with none, it isn't shown.
    func willPresent(_ notification: UNNotification) async -> UNNotificationPresentationOptions?
    func didReceive(_ response: UNNotificationResponse) async
}

public extension NotificationCenterListener {
    func willPresent(_ notification: UNNotification) async -> UNNotificationPresentationOptions? { nil }
    func didReceive(_ response: UNNotificationResponse) async {}
}

/// The app's delegate (`@UIApplicationDelegateAdaptor` in App.swift): passes the app's events to the
/// plugins that listen for them.
public final class NativueAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    /// Set by App.swift before any of the app's events.
    public static var plugins: [NativuePlugin] = []

    private var lifecycleListeners: [AppLifecycleListener] {
        Self.plugins.compactMap { $0 as? AppLifecycleListener }
    }

    private var notificationCenterListeners: [NotificationCenterListener] {
        Self.plugins.compactMap { $0 as? NotificationCenterListener }
    }

    /// Before launch finishes, or a notification that opened the app is missed.
    public func application(
        _ application: UIApplication,
        willFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self

        return true
    }

    public func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        lifecycleListeners.forEach { $0.didFinishLaunching(options: launchOptions) }

        return true
    }

    public func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        lifecycleListeners.forEach { $0.didRegisterForRemoteNotifications(deviceToken: deviceToken) }
    }

    public func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        lifecycleListeners.forEach { $0.didFailToRegisterForRemoteNotifications(error: error) }
    }

    public func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any]
    ) async -> UIBackgroundFetchResult {
        let results = await answers(from: lifecycleListeners) { await $0.didReceiveRemoteNotification(userInfo) }

        if results.contains(.newData) { return .newData }
        if results.contains(.failed) { return .failed }

        return .noData
    }

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        let options = await answers(from: notificationCenterListeners) { await $0.willPresent(notification) }

        return options.compactMap { $0 }.reduce([]) { $0.union($1) }
    }

    public func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        _ = await answers(from: notificationCenterListeners) { await $0.didReceive(response) }
    }

    /// Asks the plugins first; false: JavaScript's onOpenURL and the router get it.
    static func open(_ url: URL, plugins: [NativuePlugin]) -> Bool {
        plugins.compactMap { $0 as? AppLifecycleListener }.contains { $0.open(url: url) }
    }
}

/// iOS ends an app that hasn't answered in 30 seconds: stop waiting at 25, with the answers in by then.
private let answersDeadline: UInt64 = 25_000_000_000

private func answers<Listener, Answer>(
    from listeners: [Listener],
    _ ask: @escaping (Listener) async -> Answer
) async -> [Answer] {
    guard !listeners.isEmpty else { return [] }

    let collector = AnswerCollector<Answer>(expected: listeners.count)

    return await withCheckedContinuation { continuation in
        collector.continuation = continuation
        collector.deadline = Task {
            try? await Task.sleep(nanoseconds: answersDeadline)
            collector.finish()
        }
        // On the main thread, like the app's other events.
        for listener in listeners {
            Task { @MainActor in collector.add(await ask(listener)) }
        }
    }
}

/// Not a task group: one waits for its tasks, so a listener that never returns would block the deadline.
private final class AnswerCollector<Answer> {
    private let lock = NSLock()
    private let expected: Int
    private var collected: [Answer] = []
    var continuation: CheckedContinuation<[Answer], Never>?
    var deadline: Task<Void, Never>?

    init(expected: Int) {
        self.expected = expected
    }

    func add(_ answer: Answer) {
        lock.lock()
        collected.append(answer)
        let isComplete = collected.count == expected
        lock.unlock()

        if isComplete { finish() }
    }

    func finish() {
        lock.lock()
        let continuation = continuation
        self.continuation = nil
        let answers = collected
        let deadline = deadline
        lock.unlock()

        deadline?.cancel()
        continuation?.resume(returning: answers)
    }
}
