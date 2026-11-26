import Nativue
import UIKit
import UserNotifications

/// Notifications.* (src/index.ts), on UNUserNotificationCenter.
public final class NotificationsPlugin: NativuePlugin, NotificationCenterListener {
    private let center = UNUserNotificationCenter.current()
    private var foregroundPresentation: UNNotificationPresentationOptions = [.banner, .list, .sound]
    /// The last tap, kept until JavaScript reads it: one that opens the app comes before JavaScript runs.
    private var lastResponse: [String: Any]?
    private weak var registry: PluginRegistry?

    public init() {}

    public func register(in registry: PluginRegistry) {
        self.registry = registry

        registry.addAsyncFunction("notifications.getPermission") { [unowned self] _ in await permission() }

        registry.addAsyncFunction("notifications.requestPermission") { [unowned self] arguments in
            let options = arguments.first as? [String: Any]
            let provisional = options?["provisional"] as? Bool ?? false
            let authorization: UNAuthorizationOptions = provisional ? [.alert, .sound, .badge, .provisional] : [.alert, .sound, .badge]

            _ = try? await center.requestAuthorization(options: authorization)

            return await permission()
        }

        registry.addAsyncFunction("notifications.openSettings") { _ in
            var settings = UIApplication.openSettingsURLString

            if #available(iOS 16, *) { settings = UIApplication.openNotificationSettingsURLString }

            await UIApplication.shared.open(URL(string: settings)!)

            return nil
        }

        registry.addAsyncFunction("notifications.schedule") { [unowned self] arguments in
            guard let notification = arguments.first as? [String: Any], let id = notification["id"] as? String else {
                throw PluginError(code: "ERR_INVALID_ARGUMENT", message: "schedule takes a notification")
            }

            let request = UNNotificationRequest(
                identifier: id,
                content: content(of: notification),
                trigger: trigger(arguments.count > 1 ? arguments[1] as? [String: Any] : nil)
            )

            try await center.add(request)

            return id
        }

        registry.addAsyncFunction("notifications.cancel") { [unowned self] arguments in
            let id = arguments.first as? String ?? ""

            center.removePendingNotificationRequests(withIdentifiers: [id])

            return nil
        }

        registry.addAsyncFunction("notifications.cancelAll") { [unowned self] _ in
            center.removeAllPendingNotificationRequests()

            return nil
        }

        registry.addAsyncFunction("notifications.getScheduled") { [unowned self] _ in
            await center.pendingNotificationRequests().map { request in
                [
                    "id": request.identifier,
                    "content": dictionary(of: request.content),
                    "trigger": dictionary(of: request.trigger) as Any? ?? NSNull(),
                ]
            }
        }

        registry.addAsyncFunction("notifications.getLastResponse") { [unowned self] _ in
            await MainActor.run {
                defer { lastResponse = nil }

                return lastResponse as Any? ?? NSNull()
            }
        }

        registry.addFunction("notifications.setForegroundPresentation") { [unowned self] arguments in
            let presentation = arguments.first as? [String: Any] ?? [:]
            var options: UNNotificationPresentationOptions = []

            if presentation["banner"] as? Bool ?? true { options.formUnion([.banner, .list]) }
            if presentation["sound"] as? Bool ?? true { options.insert(.sound) }
            DispatchQueue.main.async { [unowned self] in foregroundPresentation = options }

            return nil
        }

        // Android's: iOS has no channels.
        registry.addAsyncFunction("notifications.setChannel") { _ in nil }
    }

    // These come off the main thread: the state they share with JavaScript's calls stays on it.
    public func willPresent(_ notification: UNNotification) async -> UNNotificationPresentationOptions? {
        registry?.sendEvent("notifications.received", notificationDictionary(notification))

        return await MainActor.run { foregroundPresentation }
    }

    public func didReceive(_ response: UNNotificationResponse) async {
        let tap: [String: Any] = [
            "notification": notificationDictionary(response.notification),
            "tapId": UUID().uuidString,
        ]

        await MainActor.run { lastResponse = tap }
        registry?.sendEvent("notifications.response", tap)
    }

    private func permission() async -> [String: Any] {
        switch await center.notificationSettings().authorizationStatus {
        case .authorized, .ephemeral: permissionResponse(.granted)
        case .provisional: permissionResponse(.granted, extra: ["provisional": true])
        case .notDetermined: permissionResponse(.undetermined)
        default: permissionResponse(.denied)
        }
    }

    private func content(of notification: [String: Any]) -> UNNotificationContent {
        let content = UNMutableNotificationContent()

        content.title = notification["title"] as? String ?? ""
        content.body = notification["body"] as? String ?? ""
        if notification["sound"] as? Bool ?? true { content.sound = .default }
        if let data = notification["data"] as? String { content.userInfo = ["data": data] }

        return content
    }

    private func trigger(_ trigger: [String: Any]?) -> UNNotificationTrigger? {
        switch trigger?["type"] as? String {
        case "seconds":
            let seconds = (trigger?["seconds"] as? NSNumber)?.doubleValue ?? 1

            return UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: trigger?["repeats"] as? Bool ?? false)
        case "date":
            let timestamp = (trigger?["timestamp"] as? NSNumber)?.doubleValue ?? 0
            let date = Date(timeIntervalSince1970: timestamp / 1000)
            let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)

            return UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        case "daily":
            let components = DateComponents(hour: trigger?["hour"] as? Int, minute: trigger?["minute"] as? Int)

            return UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
        default:
            return nil
        }
    }

    private func dictionary(of content: UNNotificationContent) -> [String: Any] {
        [
            "title": content.title,
            "body": content.body,
            "data": content.userInfo["data"] as? String ?? NSNull(),
            "sound": content.sound != nil,
            "channelId": "default",
        ]
    }

    private func dictionary(of trigger: UNNotificationTrigger?) -> [String: Any]? {
        if let trigger = trigger as? UNTimeIntervalNotificationTrigger {
            return ["type": "seconds", "seconds": trigger.timeInterval, "repeats": trigger.repeats]
        }
        guard let trigger = trigger as? UNCalendarNotificationTrigger else { return nil }

        if trigger.repeats {
            return ["type": "daily", "hour": trigger.dateComponents.hour ?? 0, "minute": trigger.dateComponents.minute ?? 0]
        }

        let timestamp = (Calendar.current.date(from: trigger.dateComponents)?.timeIntervalSince1970 ?? 0) * 1000

        return ["type": "date", "timestamp": timestamp]
    }

    private func notificationDictionary(_ notification: UNNotification) -> [String: Any] {
        dictionary(of: notification.request.content).merging(["id": notification.request.identifier]) { $1 }
    }
}
