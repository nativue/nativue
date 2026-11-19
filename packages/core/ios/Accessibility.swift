import UIKit

extension NativeNode {
    private static let traitsByRole: [String: UIAccessibilityTraits] = [
        "button": .button,
        "link": .link,
        "heading": .header,
        "img": .image,
        "text": .staticText,
        "switch": toggleTraits,
        "checkbox": toggleTraits,
    ]

    /// Before iOS 17, VoiceOver has no toggle trait: a button that says its state is the closest.
    private static var toggleTraits: UIAccessibilityTraits {
        if #available(iOS 17, *) { return .toggleButton }

        return .button
    }

    /// role, alt and aria-*, from the renderer: all of them, whenever one changes.
    func applyAccessibility(_ attributes: [String: Any]) {
        let role = attributes["role"] as? String
        let label = attributes["label"] as? String
        let isHidden = attributes["hidden"] != nil
        let isElement = !isHidden && role != "none" && (role != nil || label != nil || defaultAccessibility.isElement)

        view.accessibilityElementsHidden = isHidden
        view.isAccessibilityElement = isElement
        view.accessibilityLabel = label
        view.accessibilityHint = attributes["hint"] as? String
        view.accessibilityTraits = traits(role: role, attributes: attributes)
        // A container read as one element says the text inside it, as a <button> does on the web.
        let readsTextInside = isElement && label == nil && !defaultAccessibility.isElement
        if #available(iOS 17, *) {
            view.accessibilityLabelBlock = readsTextInside
                ? { [weak view] in view.map { Self.labels(inside: $0).joined(separator: ", ") } }
                : nil
        } else if readsTextInside {
            // ponytail: before iOS 17 the label is read once, here: text changed later inside keeps the old one.
            view.accessibilityLabel = Self.labels(inside: view).joined(separator: ", ")
        }

        if role == "switch" || role == "checkbox" {
            view.accessibilityValue = attributes["checked"] != nil ? "1" : "0"
        }
    }

    private func traits(role: String?, attributes: [String: Any]) -> UIAccessibilityTraits {
        var traits = defaultAccessibility.traits
        if let role, let roleTraits = Self.traitsByRole[role] { traits.formUnion(roleTraits) }
        if attributes["disabled"] != nil { traits.insert(.notEnabled) }
        if attributes["selected"] != nil { traits.insert(.selected) }

        return traits
    }

    private static func labels(inside view: UIView) -> [String] {
        view.subviews.flatMap { subview -> [String] in
            if subview.isHidden || subview.accessibilityElementsHidden { return [] }
            if subview.isAccessibilityElement, let label = subview.accessibilityLabel, !label.isEmpty { return [label] }

            return labels(inside: subview)
        }
    }
}

/// What a screen reader needs to know about the system, for AccessibilityInfo. Read on the main thread.
struct AccessibilityStatus {
    var screenReaderEnabled = UIAccessibility.isVoiceOverRunning
    var reduceMotionEnabled = UIAccessibility.isReduceMotionEnabled

    static let changeNotifications = [
        UIAccessibility.voiceOverStatusDidChangeNotification,
        UIAccessibility.reduceMotionStatusDidChangeNotification,
    ]

    var dictionary: [String: Bool] {
        ["screenReaderEnabled": screenReaderEnabled, "reduceMotionEnabled": reduceMotionEnabled]
    }
}
