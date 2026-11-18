import Nativue
import UIKit

/// Haptics.impact, .notification and .selection (src/index.ts).
public final class HapticsPlugin: NativuePlugin {
    private static let impactStyles: [String: UIImpactFeedbackGenerator.FeedbackStyle] = [
        "light": .light,
        "medium": .medium,
        "heavy": .heavy,
    ]
    private static let notificationTypes: [String: UINotificationFeedbackGenerator.FeedbackType] = [
        "success": .success,
        "warning": .warning,
        "error": .error,
    ]

    public init() {}

    public func register(in registry: PluginRegistry) {
        registry.addFunction("haptics.impact") { arguments in
            let style = Self.impactStyles[arguments.first as? String ?? ""] ?? .medium
            DispatchQueue.main.async { UIImpactFeedbackGenerator(style: style).impactOccurred() }

            return nil
        }

        registry.addFunction("haptics.notification") { arguments in
            let type = Self.notificationTypes[arguments.first as? String ?? ""] ?? .success
            DispatchQueue.main.async { UINotificationFeedbackGenerator().notificationOccurred(type) }

            return nil
        }

        registry.addFunction("haptics.selection") { _ in
            DispatchQueue.main.async { UISelectionFeedbackGenerator().selectionChanged() }

            return nil
        }
    }
}
