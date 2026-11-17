import UIKit
import yoga

// ponytail: removed properties arrive as null and keep their last value; reset them when it matters.
extension NativeNode {
    /// Receives only the properties that changed: the JS renderer diffs style objects before sending.
    func applyStyle(_ changes: [String: Any]) {
        for (property, value) in changes where !(value is NSNull) {
            if view is SafeAreaView, property.hasPrefix("padding") {
                continue // the safe area insets own the padding
            }

            if let applyLayoutProperty = layoutPropertySetters[property] {
                applyLayoutProperty(yogaNode, value)
            } else {
                applyVisualProperty(property, value)
            }
        }

        if changes["fontSize"] != nil || changes["fontWeight"] != nil {
            applyFont(changes)
        }
    }

    private func applyVisualProperty(_ property: String, _ value: Any) {
        switch property {
        case "backgroundColor":
            view.backgroundColor = UIColor(cssHex: value)

        case "borderRadius":
            view.layer.cornerRadius = CGFloat(number(value) ?? 0)

        case "borderWidth":
            view.layer.borderWidth = CGFloat(number(value) ?? 0)

        case "borderColor":
            view.layer.borderColor = UIColor(cssHex: value)?.cgColor

        case "opacity":
            view.alpha = CGFloat(number(value) ?? 1)

        case "overflow":
            view.clipsToBounds = (value as? String) == "hidden"

        case "color":
            let color = UIColor(cssHex: value)
            (view as? UILabel)?.textColor = color
            (view as? UIButton)?.setTitleColor(color, for: .normal)

        case "textAlign":
            (view as? UILabel)?.textAlignment = textAlignments[value as? String ?? ""] ?? .natural

        default:
            break
        }
    }

    /// Font size and weight can change independently, so the node remembers both.
    private func applyFont(_ changes: [String: Any]) {
        if let size = number(changes["fontSize"] as Any) {
            fontSize = CGFloat(size)
        }

        if let weightName = changes["fontWeight"], !(weightName is NSNull) {
            fontWeight = fontWeights[String(describing: weightName)] ?? .regular
        }

        let font = UIFont.systemFont(ofSize: fontSize, weight: fontWeight)
        (view as? UILabel)?.font = font
        (view as? UIButton)?.titleLabel?.font = font

        markContentChanged()
    }
}

// MARK: - Layout properties (Yoga)

private typealias LayoutPropertySetter = (YGNodeRef, Any) -> Void

private let layoutPropertySetters: [String: LayoutPropertySetter] = {
    var setters: [String: LayoutPropertySetter] = [
        "flexDirection": enumSetter(flexDirections, YGNodeStyleSetFlexDirection),
        "justifyContent": enumSetter(justifications, YGNodeStyleSetJustifyContent),
        "alignItems": enumSetter(alignments, YGNodeStyleSetAlignItems),
        "alignSelf": enumSetter(alignments, YGNodeStyleSetAlignSelf),
        "alignContent": enumSetter(alignments, YGNodeStyleSetAlignContent),
        "flexWrap": enumSetter(wraps, YGNodeStyleSetFlexWrap),
        "position": enumSetter(positionTypes, YGNodeStyleSetPositionType),
        "display": enumSetter(displays, YGNodeStyleSetDisplay),
        "overflow": enumSetter(overflows, YGNodeStyleSetOverflow),

        "flex": numberSetter(YGNodeStyleSetFlex),
        "flexGrow": numberSetter(YGNodeStyleSetFlexGrow),
        "flexShrink": numberSetter(YGNodeStyleSetFlexShrink),
        "aspectRatio": numberSetter(YGNodeStyleSetAspectRatio),

        "flexBasis": lengthSetter(YGNodeStyleSetFlexBasis, YGNodeStyleSetFlexBasisPercent, YGNodeStyleSetFlexBasisAuto),
        "width": lengthSetter(YGNodeStyleSetWidth, YGNodeStyleSetWidthPercent, YGNodeStyleSetWidthAuto),
        "height": lengthSetter(YGNodeStyleSetHeight, YGNodeStyleSetHeightPercent, YGNodeStyleSetHeightAuto),
        "minWidth": lengthSetter(YGNodeStyleSetMinWidth, YGNodeStyleSetMinWidthPercent),
        "minHeight": lengthSetter(YGNodeStyleSetMinHeight, YGNodeStyleSetMinHeightPercent),
        "maxWidth": lengthSetter(YGNodeStyleSetMaxWidth, YGNodeStyleSetMaxWidthPercent),
        "maxHeight": lengthSetter(YGNodeStyleSetMaxHeight, YGNodeStyleSetMaxHeightPercent),

        "gap": gapSetter(.all),
        "rowGap": gapSetter(.row),
        "columnGap": gapSetter(.column),
    ]

    for (suffix, edge) in edgesBySuffix {
        setters["padding" + suffix] = lengthSetter(
            { node, points in YGNodeStyleSetPadding(node, edge, points) },
            { node, percent in YGNodeStyleSetPaddingPercent(node, edge, percent) }
        )
        setters["margin" + suffix] = lengthSetter(
            { node, points in YGNodeStyleSetMargin(node, edge, points) },
            { node, percent in YGNodeStyleSetMarginPercent(node, edge, percent) },
            { node in YGNodeStyleSetMarginAuto(node, edge) }
        )
    }

    for (property, edge) in positionEdges {
        setters[property] = lengthSetter(
            { node, points in YGNodeStyleSetPosition(node, edge, points) },
            { node, percent in YGNodeStyleSetPositionPercent(node, edge, percent) }
        )
    }

    return setters
}()

private func enumSetter<Value>(
    _ valuesByName: [String: Value],
    _ apply: @escaping (YGNodeRef, Value) -> Void
) -> LayoutPropertySetter {
    return { node, value in
        guard let name = value as? String, let mapped = valuesByName[name] else { return }
        apply(node, mapped)
    }
}

private func numberSetter(_ apply: @escaping (YGNodeRef, Float) -> Void) -> LayoutPropertySetter {
    return { node, value in
        guard let number = number(value) else { return }
        apply(node, number)
    }
}

private func gapSetter(_ gutter: YGGutter) -> LayoutPropertySetter {
    return { node, value in
        guard let number = number(value) else { return }
        YGNodeStyleSetGap(node, gutter, number)
    }
}

/// Lengths accept points (`16`), percentages (`'50%'`) and, where supported, `'auto'`.
private func lengthSetter(
    _ setPoints: @escaping (YGNodeRef, Float) -> Void,
    _ setPercent: @escaping (YGNodeRef, Float) -> Void,
    _ setAuto: ((YGNodeRef) -> Void)? = nil
) -> LayoutPropertySetter {
    return { node, value in
        if let points = number(value) {
            setPoints(node, points)
            return
        }

        guard let text = value as? String else { return }

        if text == "auto" {
            setAuto?(node)
        } else if text.hasSuffix("%"), let percent = Float(text.dropLast()) {
            setPercent(node, percent)
        }
    }
}

private func number(_ value: Any) -> Float? {
    (value as? NSNumber)?.floatValue
}

// MARK: - CSS value tables

private let edgesBySuffix: [String: YGEdge] = [
    "": .all,
    "Horizontal": .horizontal,
    "Vertical": .vertical,
    "Top": .top,
    "Bottom": .bottom,
    "Left": .left,
    "Right": .right,
    "Start": .start,
    "End": .end,
]

private let positionEdges: [String: YGEdge] = [
    "top": .top,
    "bottom": .bottom,
    "left": .left,
    "right": .right,
    "start": .start,
    "end": .end,
]

private let flexDirections: [String: YGFlexDirection] = [
    "row": .row,
    "row-reverse": .rowReverse,
    "column": .column,
    "column-reverse": .columnReverse,
]

private let justifications: [String: YGJustify] = [
    "flex-start": .flexStart,
    "center": .center,
    "flex-end": .flexEnd,
    "space-between": .spaceBetween,
    "space-around": .spaceAround,
    "space-evenly": .spaceEvenly,
]

private let alignments: [String: YGAlign] = [
    "auto": .auto,
    "flex-start": .flexStart,
    "center": .center,
    "flex-end": .flexEnd,
    "stretch": .stretch,
    "baseline": .baseline,
    "space-between": .spaceBetween,
    "space-around": .spaceAround,
    "space-evenly": .spaceEvenly,
]

private let wraps: [String: YGWrap] = [
    "nowrap": .noWrap,
    "wrap": .wrap,
    "wrap-reverse": .wrapReverse,
]

private let positionTypes: [String: YGPositionType] = [
    "relative": .relative,
    "absolute": .absolute,
    "static": YGPositionType.static,
]

private let displays: [String: YGDisplay] = [
    "flex": YGDisplay.flex,
    "none": YGDisplay.none,
]

private let overflows: [String: YGOverflow] = [
    "visible": .visible,
    "hidden": .hidden,
    "scroll": .scroll,
]

private let textAlignments: [String: NSTextAlignment] = [
    "auto": .natural,
    "left": .left,
    "center": .center,
    "right": .right,
    "justify": .justified,
]

private let fontWeights: [String: UIFont.Weight] = [
    "normal": .regular,
    "bold": .bold,
    "100": .ultraLight,
    "200": .thin,
    "300": .light,
    "400": .regular,
    "500": .medium,
    "600": .semibold,
    "700": .bold,
    "800": .heavy,
    "900": .black,
]

extension UIColor {
    /// Parses `#rrggbb`.
    convenience init?(cssHex value: Any) {
        guard let hexString = value as? String, hexString.hasPrefix("#") else { return nil }

        let digits = hexString.dropFirst()
        guard digits.count == 6, let rgb = Int(digits, radix: 16) else { return nil }

        self.init(
            red: CGFloat(rgb >> 16 & 0xFF) / 255,
            green: CGFloat(rgb >> 8 & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: 1
        )
    }
}
