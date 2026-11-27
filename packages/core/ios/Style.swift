import UIKit
import yoga

extension NativeNode {
    /// Receives only the properties that changed: the JS renderer diffs style objects before sending. A
    /// removed property arrives as null and goes back to its default, as in CSS.
    func applyStyle(_ changes: [String: Any]) {
        for (property, value) in changes {
            if isDrivenByNativeView(property) { continue }

            if let applyLayoutProperty = layoutPropertySetters[property] {
                applyLayoutProperty(yogaNode, value is NSNull ? layoutDefaults[property] ?? undefinedLayoutValue : value)
            }
            // Some properties are both: overflow also clips the view.
            applyVisualProperty(property, value)
        }

        if changes["fontSize"] != nil || changes["fontWeight"] != nil {
            applyFont(changes)
        }
    }

    /// Safe area insets and the keyboard drive these paddings, so style values would fight them.
    private func isDrivenByNativeView(_ property: String) -> Bool {
        if view is SafeAreaView { return property.hasPrefix("padding") }
        if view is KeyboardAvoidingView { return property == "paddingBottom" }

        return false
    }

    private func applyVisualProperty(_ property: String, _ value: Any) {
        switch property {
        case "backgroundColor":
            view.backgroundColor = UIColor(rgba: value)

        case "backgroundImage":
            view.setBackgroundGradients(value as? [[String: Any]] ?? [])

        case "borderRadius", "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius":
            var radii = view.layer.value(forKey: UIView.requestedCornerRadiiKey) as? [String: CGFloat] ?? [:]
            radii[property] = number(value).map { CGFloat($0) }
            view.layer.setValue(radii, forKey: UIView.requestedCornerRadiiKey)
            view.applyCornerRadius()
            view.applyBackgroundGradients()

        case "borderWidth":
            view.layer.borderWidth = CGFloat(number(value) ?? 0)

        case "borderColor":
            view.layer.borderColor = UIColor(rgba: value)?.cgColor

        case "opacity":
            view.alpha = CGFloat(number(value) ?? 1)

        case "transform":
            view.transform = Self.affineTransform(value)

        case "overflow":
            view.clipsToBounds = (value as? String) == "hidden"

        // Shadows; overflow: 'hidden' clips them.
        case "shadowColor":
            view.layer.shadowColor = UIColor(rgba: value)?.cgColor

        case "shadowOpacity":
            view.layer.shadowOpacity = Float(number(value) ?? 0)

        case "shadowRadius":
            view.layer.shadowRadius = CGFloat(number(value) ?? 3)

        case "shadowOffset":
            let offset = value as? [String: Any]
            view.layer.shadowOffset = CGSize(
                width: CGFloat(number(offset?["width"] as Any) ?? 0),
                height: CGFloat(number(offset?["height"] as Any) ?? -3)
            )

        case "color":
            let color = UIColor(rgba: value)
            (view as? UILabel)?.textColor = color
            (view as? UITextField)?.textColor = color
            (view as? UIButton)?.setTitleColor(color, for: .normal)

        case "textAlign":
            let alignment = textAlignments[value as? String ?? ""] ?? .natural
            (view as? UILabel)?.textAlignment = alignment
            (view as? UITextField)?.textAlignment = alignment

        case "textDecorationLine":
            textDecorationLine = value as? String ?? "none"
            updateTextAttributes()

        case "letterSpacing":
            letterSpacing = value is NSNull ? nil : value
            updateTextAttributes()

        case "lineHeight":
            lineHeight = value is NSNull ? nil : value
            updateTextAttributes()

        case "fontStyle":
            isItalic = value as? String == "italic"
            updateFont()

        case "lineClamp":
            let lines = Int(number(value) ?? 0)
            (view as? UILabel)?.numberOfLines = lines
            (view as? UILabel)?.lineBreakMode = lines > 0 ? .byTruncatingTail : .byWordWrapping
            markContentChanged()

        default:
            break
        }
    }

    /// UILabel has no underline, letter spacing or line height of its own: they're attributes of its text,
    /// which setting `text` drops, so setText calls this again. Later color and alignment changes keep them;
    /// a font change calls it, as ems depend on the font's size.
    func updateTextAttributes() {
        guard let label = view as? UILabel, let text = label.text else { return }

        let font = label.font ?? UIFont.systemFont(ofSize: fontSize)
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.alignment = label.textAlignment

        var attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: label.textColor as Any,
            .paragraphStyle: paragraphStyle,
        ]
        if textDecorationLine.contains("underline") { attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue }
        if textDecorationLine.contains("line-through") { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
        if let spacing = points(letterSpacing, font: font) { attributes[.kern] = spacing }
        if let height = points(lineHeight, font: font) {
            paragraphStyle.minimumLineHeight = height
            paragraphStyle.maximumLineHeight = height
            // The extra space goes above the text: half of it below instead, as CSS centers a line.
            attributes[.baselineOffset] = (height - font.lineHeight) / 2
        }

        let lineBreakMode = label.lineBreakMode
        label.attributedText = NSAttributedString(string: text, attributes: attributes)
        label.lineBreakMode = lineBreakMode
        markContentChanged()
    }

    /// A number of points, or ems of the font's size ("1.5em").
    private func points(_ value: Any?, font: UIFont) -> CGFloat? {
        if let text = value as? String, text.hasSuffix("em") {
            return Double(text.dropLast(2)).map { CGFloat($0) * font.pointSize }
        }

        return number(value as Any).map { CGFloat($0) }
    }

    /// Font size and weight can change independently, so the node remembers both.
    private func applyFont(_ changes: [String: Any]) {
        if let size = changes["fontSize"] {
            fontSize = number(size).map { CGFloat($0) } ?? defaultFontSize
        }

        if let weightName = changes["fontWeight"] {
            fontWeight = fontWeights[String(describing: weightName)] ?? .regular
        }

        updateFont()
    }

    /// The node's font, scaled to the system's text size (Dynamic Type) like the platform's own text. Called
    /// again when that size changes.
    func updateFont() {
        guard view is UILabel || view is UITextField || view is UIButton else { return }

        let systemFont = UIFont.systemFont(ofSize: fontSize, weight: fontWeight)
        let italicTraits = systemFont.fontDescriptor.symbolicTraits.union(.traitItalic)
        let styledFont = isItalic
            ? systemFont.fontDescriptor.withSymbolicTraits(italicTraits).map { UIFont(descriptor: $0, size: fontSize) } ?? systemFont
            : systemFont
        let font = UIFontMetrics.default.scaledFont(for: styledFont)
        (view as? UILabel)?.font = font
        (view as? UITextField)?.font = font
        (view as? UIButton)?.titleLabel?.font = font

        if hasTextAttributes { updateTextAttributes() }
        markContentChanged()
    }
}

// MARK: - Layout properties (Yoga)

private typealias LayoutPropertySetter = (YGNodeRef, Any) -> Void

/// What a removed property goes back to: Yoga's defaults. The others are undefined (unset).
private let layoutDefaults: [String: Any] = [
    "flexDirection": "column",
    "justifyContent": "flex-start",
    "alignItems": "stretch",
    "alignSelf": "auto",
    "alignContent": "flex-start",
    "flexWrap": "nowrap",
    "position": "relative",
    "display": "flex",
    "overflow": "visible",
    "flexBasis": "auto",
    "width": "auto",
    "height": "auto",
]
private let undefinedLayoutValue = NSNumber(value: Float.nan)

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
    /// Colors arrive as 0xRRGGBBAA numbers: the JS side (src/colors.js) parses every CSS format.
    public convenience init?(rgba value: Any) {
        guard let rgba = (value as? NSNumber)?.uint32Value else { return nil }

        self.init(
            red: CGFloat(rgba >> 24 & 0xFF) / 255,
            green: CGFloat(rgba >> 16 & 0xFF) / 255,
            blue: CGFloat(rgba >> 8 & 0xFF) / 255,
            alpha: CGFloat(rgba & 0xFF) / 255
        )
    }
}

extension NativeNode {
    /// A transform list: [{ translateX }, { translateY }, { scale }, { scaleX }, { scaleY },
    /// { rotate: '45deg' | '1rad' }], applied in order.
    static func affineTransform(_ value: Any) -> CGAffineTransform {
        let steps = value as? [[String: Any]] ?? []

        return steps.reduce(.identity) { transform, step in
            guard let (name, amount) = step.first else { return transform }

            return transform.concatenating(affineTransformStep(name, amount))
        }
    }

    private static func affineTransformStep(_ name: String, _ amount: Any) -> CGAffineTransform {
        let value = CGFloat((amount as? Double) ?? 0)

        switch name {
        case "translateX": return CGAffineTransform(translationX: value, y: 0)
        case "translateY": return CGAffineTransform(translationX: 0, y: value)
        case "scale": return CGAffineTransform(scaleX: value, y: value)
        case "scaleX": return CGAffineTransform(scaleX: value, y: 1)
        case "scaleY": return CGAffineTransform(scaleX: 1, y: value)
        case "rotate": return CGAffineTransform(rotationAngle: radians(amount))
        default: return .identity
        }
    }

    private static func radians(_ angle: Any) -> CGFloat {
        guard let text = angle as? String else { return CGFloat((angle as? Double) ?? 0) }

        let number = CGFloat(Double(text.trimmingCharacters(in: .letters)) ?? 0)

        return text.hasSuffix("deg") ? number * .pi / 180 : number
    }
}

extension UIView {
    /// borderRadius and the corners' own, as styles set them.
    static let requestedCornerRadiiKey = "nativueCornerRadii"

    /// A radius over half the view's side (rounded-full is 9999) makes Core Animation draw nothing:
    /// capped to a circle's, and applied again as the frame changes. Core Animation rounds every chosen
    /// corner alike: corners with their own radius share the largest.
    func applyCornerRadius() {
        guard let radii = layer.value(forKey: Self.requestedCornerRadiiKey) as? [String: CGFloat] else { return }

        let radius = radii["borderRadius"] ?? 0
        let corners: [(CACornerMask, CGFloat)] = [
            (.layerMinXMinYCorner, radii["borderTopLeftRadius"] ?? radius),
            (.layerMaxXMinYCorner, radii["borderTopRightRadius"] ?? radius),
            (.layerMinXMaxYCorner, radii["borderBottomLeftRadius"] ?? radius),
            (.layerMaxXMaxYCorner, radii["borderBottomRightRadius"] ?? radius),
        ]
        let largest = corners.map(\.1).max() ?? 0

        layer.cornerRadius = min(largest, min(bounds.width, bounds.height) / 2)
        layer.maskedCorners = CACornerMask(corners.filter { $0.1 > 0 }.map(\.0))
    }
}
