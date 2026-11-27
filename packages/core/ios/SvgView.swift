import UIKit

/// View behind <svg>: draws what JS sends as `drawing`, [tag, attributes, children or text] (src/svg.ts),
/// scaled from the root's viewBox like preserveAspectRatio="xMidYMid meet" (or "none"). Icons send
/// `elements` instead, Lucide's [tag, attributes] pairs, stroked with `color`.
/// Limitation: no clipPath, mask, filter, pattern or image; text is a single line, filled with a color.
final class SvgView: UIView {
    var viewBox = CGRect(x: 0, y: 0, width: 24, height: 24) {
        didSet { updateIconDrawing() }
    }

    var strokeWidth: CGFloat = 2 {
        didSet { updateIconDrawing() }
    }

    /// currentColor.
    var color: UIColor = .black {
        didSet { setNeedsDisplay() }
    }

    var elements: [[Any]] = [] {
        didSet { updateIconDrawing() }
    }

    /// From JS (an <svg>'s content). An icon's `elements` draw instead, when it has them.
    var drawing: Any? {
        didSet {
            drawingRoot = SvgElement(drawing as Any)
            rootDidChange()
        }
    }

    /// The ids of the elements pressed, innermost first, and where (in the view).
    var onElementPress: ((_ nodeIds: [Int], _ location: CGPoint) -> Void)?

    private var drawingRoot: SvgElement?
    private var iconRoot: SvgElement?
    private var root: SvgElement? { elements.isEmpty ? drawingRoot : iconRoot }
    /// Pressable shapes as last drawn, in view coordinates, topmost last.
    private var pressTargets: [SvgPressTarget] = []
    /// What the touch that began on an element is pressing.
    private var pressedTarget: SvgPressTarget?

    override init(frame: CGRect) {
        super.init(frame: frame)

        isOpaque = false
        contentMode = .redraw
        isUserInteractionEnabled = false // a press on an icon presses what contains it
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    /// [minX, minY, width, height], as sent from JS.
    static func rect(fromViewBox value: Any?) -> CGRect? {
        let numbers = (value as? [NSNumber])?.map { CGFloat($0.doubleValue) } ?? []
        guard numbers.count == 4 else { return nil }

        return CGRect(x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3])
    }

    /// A tab bar or header item's icon: `systemImage` is an SF Symbol name, `svg` ({ viewBox, elements }) an
    /// icon from @nativue/icons.
    static func iconImage(_ item: [String: Any], size: CGFloat = 25) -> UIImage? {
        if let name = item["systemImage"] as? String { return UIImage(systemName: name) }
        guard let svg = item["svg"] as? [String: Any] else { return nil }

        return templateImage(elements: svg["elements"] as? [[Any]] ?? [], viewBox: svg["viewBox"], size: size)
    }

    /// The elements drawn into a template image (tinted by its container, like SF Symbols), sized like
    /// a tab bar icon.
    static func templateImage(elements: [[Any]], viewBox: Any?, size: CGFloat = 25) -> UIImage {
        let svgView = SvgView(frame: CGRect(x: 0, y: 0, width: size, height: size))
        if let rect = rect(fromViewBox: viewBox) { svgView.viewBox = rect }
        svgView.elements = elements

        let image = UIGraphicsImageRenderer(bounds: svgView.bounds).image { context in
            svgView.draw(in: context.cgContext)
        }

        return image.withRenderingMode(.alwaysTemplate)
    }

    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext() else { return }

        draw(in: context)
    }

    private func draw(in context: CGContext) {
        guard let root else { return }

        var renderer = SvgRenderer(context: context, currentColor: color.cgColor, gradients: root.gradientsById())
        context.concatenate(root.viewBoxTransform(in: bounds))
        renderer.draw(root, style: SvgStyle(), pressableAncestors: [])
        pressTargets = renderer.pressTargets
    }

    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        pressTarget(at: point) != nil
    }

    // A touch on an element is the element's: not passed on to a <Pressable> around the <svg>.
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        pressedTarget = touches.first.flatMap { pressTarget(at: $0.location(in: self)) }
        if pressedTarget == nil { super.touchesBegan(touches, with: event) }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        if pressedTarget == nil { super.touchesMoved(touches, with: event) }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let target = pressedTarget else { return super.touchesEnded(touches, with: event) }

        pressedTarget = nil
        guard let location = touches.first?.location(in: self), target.contains(location) else { return }

        onElementPress?(target.nodeIds, location)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard pressedTarget != nil else { return super.touchesCancelled(touches, with: event) }

        pressedTarget = nil
    }

    private func rootDidChange() {
        isUserInteractionEnabled = root?.hasPressableElements ?? false
        setNeedsDisplay()
    }

    private func pressTarget(at point: CGPoint) -> SvgPressTarget? {
        pressTargets.last { $0.contains(point) }
    }

    /// An icon: its elements, stroked with currentColor (round caps and joins, as icon sets expect), and
    /// filled with it when their fill isn't "none".
    private func updateIconDrawing() {
        defer { rootDidChange() }
        guard !elements.isEmpty else { return }

        let rootAttributes: [String: Any] = [
            "viewBox": [viewBox.minX, viewBox.minY, viewBox.width, viewBox.height],
            "fill": "none",
            "stroke": "currentColor",
            "stroke-width": strokeWidth,
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
        ]
        let children = elements.map { element -> [Any] in
            var attributes = element.last as? [String: Any] ?? [:]

            if let fill = attributes["fill"], "\(fill)" != "none" { attributes["fill"] = "currentColor" }

            return [element.first ?? "", attributes, [Any]()]
        }
        iconRoot = SvgElement(["svg", rootAttributes, children])
    }
}

/// One element of a drawing.
private struct SvgElement {
    let tag: String
    let attributes: SvgAttributes
    let children: [SvgElement]
    let text: String

    init?(_ value: Any) {
        guard let parts = value as? [Any], let tag = parts.first as? String else { return nil }

        self.tag = tag
        attributes = SvgAttributes(values: parts.count > 1 ? parts[1] as? [String: Any] ?? [:] : [:])
        children = (parts.count > 2 ? parts[2] as? [Any] ?? [] : []).compactMap(SvgElement.init)
        text = parts.count > 2 ? parts[2] as? String ?? "" : ""
    }

    var hasPressableElements: Bool {
        attributes.values["nodeId"] != nil || children.contains { $0.hasPressableElements }
    }

    func gradientsById() -> [String: SvgElement] {
        var gradients: [String: SvgElement] = [:]

        if tag == "linearGradient" || tag == "radialGradient", let id = attributes.values["id"] as? String {
            gradients[id] = self
        }
        for child in children { gradients.merge(child.gradientsById()) { first, _ in first } }

        return gradients
    }

    /// The root's viewBox fitted into the view: centered and scaled to fit, or stretched with "none".
    func viewBoxTransform(in bounds: CGRect) -> CGAffineTransform {
        let numbers = (attributes.values["viewBox"] as? [Any])?.compactMap { ($0 as? NSNumber).map { CGFloat($0.doubleValue) } }
        guard let numbers, numbers.count == 4, numbers[2] > 0, numbers[3] > 0 else { return .identity }

        let viewBox = CGRect(x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3])
        if attributes.text("preserveAspectRatio") == "none" {
            return CGAffineTransform(scaleX: bounds.width / viewBox.width, y: bounds.height / viewBox.height)
                .translatedBy(x: -viewBox.minX, y: -viewBox.minY)
        }

        let scale = min(bounds.width / viewBox.width, bounds.height / viewBox.height)

        return CGAffineTransform(
            translationX: (bounds.width - viewBox.width * scale) / 2,
            y: (bounds.height - viewBox.height * scale) / 2
        )
        .scaledBy(x: scale, y: scale)
        .translatedBy(x: -viewBox.minX, y: -viewBox.minY)
    }

    /// Its own transform attribute, [a, b, c, d, tx, ty].
    var transform: CGAffineTransform? {
        guard let values = attributes.values["transform"] as? [NSNumber], values.count == 6 else { return nil }

        let numbers = values.map { CGFloat($0.doubleValue) }

        return CGAffineTransform(
            a: numbers[0], b: numbers[1], c: numbers[2], d: numbers[3], tx: numbers[4], ty: numbers[5]
        )
    }
}

/// fill and stroke: none, a color, currentColor, or a gradient (url(#id)).
private enum SvgPaint {
    case none
    case color(CGColor)
    case currentColor
    case gradient(id: String)

    init?(_ value: Any?) {
        switch value {
        case let number as NSNumber:
            guard let color = UIColor(rgba: number) else { return nil }
            self = .color(color.cgColor)
        case let text as String where text == "none":
            self = .none
        case let text as String where text == "currentColor":
            self = .currentColor
        case let text as String where text.hasPrefix("url(#"):
            self = .gradient(id: String(text.dropFirst(5).dropLast()))
        default:
            return nil
        }
    }
}

/// What children inherit, as SVG's presentation attributes cascade.
private struct SvgStyle {
    var fill: SvgPaint = .color(UIColor.black.cgColor)
    var stroke: SvgPaint = .none
    var strokeWidth: CGFloat = 1
    var fillOpacity: CGFloat = 1
    var strokeOpacity: CGFloat = 1
    var lineCap: CGLineCap = .butt
    var lineJoin: CGLineJoin = .miter
    var dashes: [CGFloat] = []
    var isEvenOdd = false
    var fontSize: CGFloat = 16
    var fontWeight: UIFont.Weight = .regular
    var fontFamily: String?
    var textAnchor = "start"

    func inheriting(_ attributes: SvgAttributes) -> SvgStyle {
        var style = self

        if let fill = SvgPaint(attributes.values["fill"]) { style.fill = fill }
        if let stroke = SvgPaint(attributes.values["stroke"]) { style.stroke = stroke }
        if let width = attributes.optionalNumber("stroke-width") { style.strokeWidth = width }
        if let opacity = attributes.optionalNumber("fill-opacity") { style.fillOpacity = opacity }
        if let opacity = attributes.optionalNumber("stroke-opacity") { style.strokeOpacity = opacity }
        if let dashes = attributes.values["stroke-dasharray"] as? [NSNumber] {
            style.dashes = dashes.map { CGFloat($0.doubleValue) }
        }
        if let fontSize = attributes.optionalNumber("font-size") { style.fontSize = fontSize }
        if let family = attributes.values["font-family"] as? String { style.fontFamily = family }
        if let anchor = attributes.values["text-anchor"] as? String { style.textAnchor = anchor }
        if let weight = attributes.values["font-weight"] { style.fontWeight = Self.fontWeight("\(weight)") }
        switch attributes.values["stroke-linecap"] as? String {
        case "round": style.lineCap = .round
        case "square": style.lineCap = .square
        case "butt": style.lineCap = .butt
        default: break
        }
        switch attributes.values["stroke-linejoin"] as? String {
        case "round": style.lineJoin = .round
        case "bevel": style.lineJoin = .bevel
        case "miter": style.lineJoin = .miter
        default: break
        }
        if let rule = attributes.values["fill-rule"] as? String { style.isEvenOdd = rule == "evenodd" }

        return style
    }

    private static func fontWeight(_ value: String) -> UIFont.Weight {
        switch value {
        case "bold", "700": .bold
        case "600": .semibold
        case "500": .medium
        case "800", "900": .heavy
        case "300": .light
        case "100", "200": .thin
        default: .regular
        }
    }
}

private struct SvgPressTarget {
    let path: CGPath
    let nodeIds: [Int]

    func contains(_ point: CGPoint) -> Bool {
        path.contains(point)
    }
}

/// Draws elements into a context already scaled to the viewBox, and notes what can be pressed.
private struct SvgRenderer {
    let context: CGContext
    let currentColor: CGColor
    let gradients: [String: SvgElement]
    /// The view's coordinates, before the viewBox scales them: where press targets are kept.
    let viewTransform: CGAffineTransform
    var pressTargets: [SvgPressTarget] = []

    init(context: CGContext, currentColor: CGColor, gradients: [String: SvgElement]) {
        self.context = context
        self.currentColor = currentColor
        self.gradients = gradients
        viewTransform = context.ctm
    }

    /// From the element's coordinates to the view's.
    private var toView: CGAffineTransform {
        context.ctm.concatenating(viewTransform.inverted())
    }

    mutating func draw(_ element: SvgElement, style inherited: SvgStyle, pressableAncestors: [Int]) {
        guard !["defs", "linearGradient", "radialGradient", "stop"].contains(element.tag) else { return }

        let style = inherited.inheriting(element.attributes)
        let nodeIds = (element.attributes.values["nodeId"] as? NSNumber).map { [$0.intValue] } ?? []
        let pressable = nodeIds + pressableAncestors
        let opacity = element.attributes.optionalNumber("opacity") ?? 1

        context.saveGState()
        if let transform = element.transform { context.concatenate(transform) }
        // Opacity applies to the element as a whole, overlaps included: drawn apart, then blended.
        if opacity < 1 {
            context.setAlpha(opacity)
            context.beginTransparencyLayer(auxiliaryInfo: nil)
        }

        switch element.tag {
        case "svg", "g":
            // An <svg @press>: anywhere in it, under its elements.
            if element.tag == "svg", !nodeIds.isEmpty {
                var toView = toView
                let viewport = CGPath(rect: context.boundingBoxOfClipPath, transform: &toView)
                pressTargets.append(SvgPressTarget(path: viewport, nodeIds: nodeIds))
            }
            for child in element.children { draw(child, style: style, pressableAncestors: pressable) }
        case "text":
            drawText(element, style: style, pressable: pressable)
        default:
            if let shape = SvgShapes.path(element.tag, element.attributes) {
                drawShape(shape, style: style, pressable: pressable)
            }
        }

        if opacity < 1 { context.endTransparencyLayer() }
        context.restoreGState()
    }

    private mutating func drawShape(_ shape: CGPath, style: SvgStyle, pressable: [Int]) {
        paint(style.fill, opacity: style.fillOpacity, path: shape) { context in
            context.fillPath(using: style.isEvenOdd ? .evenOdd : .winding)
        }

        let stroked = shape.copy(
            strokingWithWidth: style.strokeWidth,
            lineCap: style.lineCap,
            lineJoin: style.lineJoin,
            miterLimit: 4
        )
        let outline = style.dashes.isEmpty ? stroked : shape.copy(dashingWithPhase: 0, lengths: style.dashes)
            .copy(strokingWithWidth: style.strokeWidth, lineCap: style.lineCap, lineJoin: style.lineJoin, miterLimit: 4)
        paint(style.stroke, opacity: style.strokeOpacity, path: outline) { context in context.fillPath() }

        guard !pressable.isEmpty else { return }

        var toView = toView
        let scale = max(hypot(toView.a, toView.b), 0.01)
        let area = CGMutablePath()

        if case .none = style.fill {} else { area.addPath(shape) }
        area.addPath(stroked)
        // A thin line is hard to hit: at least 44 points wide, as Apple's guidelines ask for targets.
        area.addPath(shape.copy(strokingWithWidth: 44 / scale, lineCap: .round, lineJoin: .round, miterLimit: 4))
        pressTargets.append(SvgPressTarget(path: area.copy(using: &toView) ?? area, nodeIds: pressable))
    }

    private mutating func drawText(_ element: SvgElement, style: SvgStyle, pressable: [Int]) {
        guard case let .color(color) = resolved(style.fill) else { return }

        let font = style.fontFamily.flatMap { UIFont(name: $0, size: style.fontSize) }
            ?? UIFont.systemFont(ofSize: style.fontSize, weight: style.fontWeight)
        let text = NSAttributedString(string: element.text, attributes: [
            .font: font,
            .foregroundColor: UIColor(cgColor: color.copy(alpha: color.alpha * style.fillOpacity) ?? color),
        ])
        let width = text.size().width
        let anchorOffset = style.textAnchor == "middle" ? width / 2 : style.textAnchor == "end" ? width : 0
        // y is the baseline.
        let origin = CGPoint(
            x: element.attributes.number("x") + element.attributes.number("dx") - anchorOffset,
            y: element.attributes.number("y") + element.attributes.number("dy") - font.ascender
        )

        UIGraphicsPushContext(context)
        text.draw(at: origin)
        UIGraphicsPopContext()

        guard !pressable.isEmpty else { return }

        var toView = toView
        let box = CGPath(rect: CGRect(origin: origin, size: text.size()), transform: &toView)
        pressTargets.append(SvgPressTarget(path: box, nodeIds: pressable))
    }

    private func resolved(_ paint: SvgPaint) -> SvgPaint {
        if case .currentColor = paint { return .color(currentColor) }

        return paint
    }

    /// Fills `path` (already outlined, for a stroke) with a color or a gradient.
    private func paint(_ paint: SvgPaint, opacity: CGFloat, path: CGPath, fill: (CGContext) -> Void) {
        switch resolved(paint) {
        case .none, .currentColor:
            return
        case let .color(color):
            context.setFillColor(color.copy(alpha: color.alpha * opacity) ?? color)
            context.addPath(path)
            fill(context)
        case let .gradient(id):
            guard let gradient = gradients[id] else { return }

            context.saveGState()
            context.addPath(path)
            context.clip()
            context.setAlpha(opacity)
            SvgGradients.draw(gradient, in: context, bounds: path.boundingBoxOfPath)
            context.restoreGState()
        }
    }
}

/// <linearGradient> and <radialGradient>: coordinates in the shape's box (objectBoundingBox, the default) or
/// in the drawing's (userSpaceOnUse).
private enum SvgGradients {
    static func draw(_ element: SvgElement, in context: CGContext, bounds: CGRect) {
        let stops = element.children.filter { $0.tag == "stop" }
        let colors = stops.map { stop -> CGColor in
            let color = (SvgPaint(stop.attributes.values["stop-color"]).flatMap { paint -> CGColor? in
                if case let .color(color) = paint { return color }
                return nil
            }) ?? UIColor.black.cgColor

            return color.copy(alpha: color.alpha * (stop.attributes.optionalNumber("stop-opacity") ?? 1)) ?? color
        }
        let locations = stops.map { $0.attributes.optionalNumber("offset") ?? 0 }
        guard
            !colors.isEmpty,
            let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: locations)
        else { return }

        let attributes = element.attributes
        if attributes.text("gradientUnits") != "userSpaceOnUse" {
            context.translateBy(x: bounds.minX, y: bounds.minY)
            context.scaleBy(x: bounds.width, y: bounds.height)
        }
        if let values = attributes.values["gradientTransform"] as? [NSNumber], values.count == 6 {
            let numbers = values.map { CGFloat($0.doubleValue) }
            context.concatenate(CGAffineTransform(a: numbers[0], b: numbers[1], c: numbers[2], d: numbers[3], tx: numbers[4], ty: numbers[5]))
        }

        let extend: CGGradientDrawingOptions = [.drawsBeforeStartLocation, .drawsAfterEndLocation]
        if element.tag == "linearGradient" {
            let start = CGPoint(x: attributes.optionalNumber("x1") ?? 0, y: attributes.optionalNumber("y1") ?? 0)
            let end = CGPoint(x: attributes.optionalNumber("x2") ?? 1, y: attributes.optionalNumber("y2") ?? 0)
            context.drawLinearGradient(gradient, start: start, end: end, options: extend)
        } else {
            let center = CGPoint(x: attributes.optionalNumber("cx") ?? 0.5, y: attributes.optionalNumber("cy") ?? 0.5)
            let focus = CGPoint(x: attributes.optionalNumber("fx") ?? center.x, y: attributes.optionalNumber("fy") ?? center.y)
            let radius = attributes.optionalNumber("r") ?? 0.5
            context.drawRadialGradient(gradient, startCenter: focus, startRadius: 0, endCenter: center, endRadius: radius, options: extend)
        }
    }
}

private enum SvgShapes {
    static func path(_ tag: String, _ attributes: SvgAttributes) -> CGPath? {
        switch tag {
        case "path":
            var parser = SvgPathParser(attributes.text("d"))
            return parser.parse()

        case "circle":
            let radius = attributes.number("r")
            return CGPath(ellipseIn: ellipseBounds(attributes, radiusX: radius, radiusY: radius), transform: nil)

        case "ellipse":
            let bounds = ellipseBounds(attributes, radiusX: attributes.number("rx"), radiusY: attributes.number("ry"))
            return CGPath(ellipseIn: bounds, transform: nil)

        case "rect":
            return roundedRect(attributes)

        case "line":
            let path = CGMutablePath()
            path.move(to: CGPoint(x: attributes.number("x1"), y: attributes.number("y1")))
            path.addLine(to: CGPoint(x: attributes.number("x2"), y: attributes.number("y2")))
            return path

        case "polyline", "polygon":
            let path = CGMutablePath()
            var parser = SvgPathParser(attributes.text("points"))
            path.addLines(between: parser.points())
            if tag == "polygon" { path.closeSubpath() }
            return path

        default:
            return nil
        }
    }

    private static func ellipseBounds(_ attributes: SvgAttributes, radiusX: CGFloat, radiusY: CGFloat) -> CGRect {
        CGRect(
            x: attributes.number("cx") - radiusX,
            y: attributes.number("cy") - radiusY,
            width: radiusX * 2,
            height: radiusY * 2
        )
    }

    /// rx and ry default to each other, and can't exceed half the side (like SVG).
    private static func roundedRect(_ attributes: SvgAttributes) -> CGPath {
        let rect = CGRect(
            x: attributes.number("x"),
            y: attributes.number("y"),
            width: attributes.number("width"),
            height: attributes.number("height")
        )
        let radiusX = attributes.optionalNumber("rx") ?? attributes.optionalNumber("ry") ?? 0
        let radiusY = attributes.optionalNumber("ry") ?? radiusX

        return CGPath(
            roundedRect: rect,
            cornerWidth: min(radiusX, rect.width / 2),
            cornerHeight: min(radiusY, rect.height / 2),
            transform: nil
        )
    }
}

/// Attribute values arrive as strings ("12") or numbers.
private struct SvgAttributes {
    let values: [String: Any]

    func text(_ name: String) -> String {
        values[name].map { "\($0)" } ?? ""
    }

    func optionalNumber(_ name: String) -> CGFloat? {
        if let number = values[name] as? NSNumber { return CGFloat(number.doubleValue) }

        return (values[name] as? String).flatMap(Double.init).map { CGFloat($0) }
    }

    func number(_ name: String) -> CGFloat {
        optionalNumber(name) ?? 0
    }
}

/// Parses SVG path data ("M12 2a10 10 0 1 0 0 20z"): every command, absolute and relative, including
/// the compact forms optimizers emit ("l.486.9", arc flags written "01").
private struct SvgPathParser {
    private let characters: [Character]
    private var index = 0

    init(_ text: String) {
        characters = Array(text)
    }

    /// "x,y x,y" (polyline / polygon points).
    mutating func points() -> [CGPoint] {
        var points: [CGPoint] = []
        while let x = number(), let y = number() { points.append(CGPoint(x: x, y: y)) }

        return points
    }

    mutating func parse() -> CGPath {
        let path = CGMutablePath()
        var command: Character = "M"
        var current = CGPoint.zero
        var subpathStart = CGPoint.zero
        var lastCubicControl: CGPoint?
        var lastQuadraticControl: CGPoint?

        while true {
            skipSeparators()
            guard index < characters.count else { break }

            if characters[index].isLetter {
                command = characters[index]
                index += 1
            } else if command == "Z" || command == "z" {
                break // numbers can't follow a close
            }

            let isRelative = command.isLowercase
            let origin = isRelative ? current : .zero
            var cubicControl: CGPoint?
            var quadraticControl: CGPoint?

            switch command.uppercased() {
            case "M":
                guard let point = point(from: origin) else { return path }
                path.move(to: point)
                current = point
                subpathStart = point
                command = isRelative ? "l" : "L" // further pairs are lines

            case "L":
                guard let point = point(from: origin) else { return path }
                path.addLine(to: point)
                current = point

            case "H":
                guard let x = number() else { return path }
                current = CGPoint(x: x + origin.x, y: current.y)
                path.addLine(to: current)

            case "V":
                guard let y = number() else { return path }
                current = CGPoint(x: current.x, y: y + origin.y)
                path.addLine(to: current)

            case "C":
                guard
                    let control1 = point(from: origin),
                    let control2 = point(from: origin),
                    let end = point(from: origin)
                else { return path }
                path.addCurve(to: end, control1: control1, control2: control2)
                cubicControl = control2
                current = end

            case "S":
                guard let control2 = point(from: origin), let end = point(from: origin) else { return path }
                let control1 = lastCubicControl.map { reflect($0, around: current) } ?? current
                path.addCurve(to: end, control1: control1, control2: control2)
                cubicControl = control2
                current = end

            case "Q":
                guard let control = point(from: origin), let end = point(from: origin) else { return path }
                path.addQuadCurve(to: end, control: control)
                quadraticControl = control
                current = end

            case "T":
                guard let end = point(from: origin) else { return path }
                let control = lastQuadraticControl.map { reflect($0, around: current) } ?? current
                path.addQuadCurve(to: end, control: control)
                quadraticControl = control
                current = end

            case "A":
                guard
                    let radiusX = number(),
                    let radiusY = number(),
                    let rotation = number(),
                    let largeArc = flag(),
                    let sweep = flag(),
                    let end = point(from: origin)
                else { return path }
                SvgArc(
                    from: current, to: end, radiusX: radiusX, radiusY: radiusY,
                    rotationDegrees: rotation, largeArc: largeArc, sweep: sweep
                ).add(to: path)
                current = end

            case "Z":
                path.closeSubpath()
                current = subpathStart

            default:
                return path
            }

            lastCubicControl = cubicControl
            lastQuadraticControl = quadraticControl
        }

        return path
    }

    private func reflect(_ point: CGPoint, around center: CGPoint) -> CGPoint {
        CGPoint(x: 2 * center.x - point.x, y: 2 * center.y - point.y)
    }

    private mutating func point(from origin: CGPoint) -> CGPoint? {
        guard let x = number(), let y = number() else { return nil }

        return CGPoint(x: x + origin.x, y: y + origin.y)
    }

    private mutating func skipSeparators() {
        while index < characters.count, characters[index].isWhitespace || characters[index] == "," {
            index += 1
        }
    }

    private mutating func flag() -> Bool? {
        skipSeparators()
        guard index < characters.count, characters[index] == "0" || characters[index] == "1" else { return nil }

        index += 1

        return characters[index - 1] == "1"
    }

    /// "-1.5e-3", ".5" and "1.5.5" (two numbers) all parse.
    private mutating func number() -> CGFloat? {
        skipSeparators()
        let start = index
        var hasDot = false

        if index < characters.count, characters[index] == "-" || characters[index] == "+" { index += 1 }
        while index < characters.count {
            let character = characters[index]
            if character.isNumber {
                index += 1
            } else if character == ".", !hasDot {
                hasDot = true
                index += 1
            } else if character == "e" || character == "E" {
                index += 1
                if index < characters.count, characters[index] == "-" || characters[index] == "+" { index += 1 }
            } else {
                break
            }
        }

        return Double(String(characters[start..<index])).map { CGFloat($0) }
    }
}

/// An elliptical arc as cubic Béziers, one per quarter turn at most (SVG spec, appendix B.2.4).
private struct SvgArc {
    let from: CGPoint
    let to: CGPoint
    let radiusX: CGFloat
    let radiusY: CGFloat
    let rotationDegrees: CGFloat
    let largeArc: Bool
    let sweep: Bool

    func add(to path: CGMutablePath) {
        guard from != to else { return }
        guard radiusX != 0, radiusY != 0 else { return path.addLine(to: to) }

        let angle = rotationDegrees * .pi / 180
        let (cosine, sine) = (cos(angle), sin(angle))

        // The start point in the ellipse's own axes, relative to the chord's middle.
        let halfDeltaX = (from.x - to.x) / 2
        let halfDeltaY = (from.y - to.y) / 2
        let startX = cosine * halfDeltaX + sine * halfDeltaY
        let startY = -sine * halfDeltaX + cosine * halfDeltaY

        // Radii too small to reach the end are scaled up just enough.
        var (rx, ry) = (abs(radiusX), abs(radiusY))
        let radiiScale = (startX * startX) / (rx * rx) + (startY * startY) / (ry * ry)
        if radiiScale > 1 {
            rx *= sqrt(radiiScale)
            ry *= sqrt(radiiScale)
        }

        let numerator = rx * rx * ry * ry - rx * rx * startY * startY - ry * ry * startX * startX
        let denominator = rx * rx * startY * startY + ry * ry * startX * startX
        var coefficient = sqrt(max(0, numerator / denominator))
        if largeArc == sweep { coefficient = -coefficient }

        let centerX = coefficient * rx * startY / ry
        let centerY = -coefficient * ry * startX / rx
        let center = CGPoint(
            x: cosine * centerX - sine * centerY + (from.x + to.x) / 2,
            y: sine * centerX + cosine * centerY + (from.y + to.y) / 2
        )

        let startVector = CGPoint(x: (startX - centerX) / rx, y: (startY - centerY) / ry)
        let endVector = CGPoint(x: (-startX - centerX) / rx, y: (-startY - centerY) / ry)
        let startAngle = Self.angle(from: CGPoint(x: 1, y: 0), to: startVector)
        var sweepAngle = Self.angle(from: startVector, to: endVector)
        if !sweep, sweepAngle > 0 { sweepAngle -= 2 * .pi }
        if sweep, sweepAngle < 0 { sweepAngle += 2 * .pi }

        let segmentCount = max(1, Int(ceil(abs(sweepAngle) / (.pi / 2))))
        let segmentAngle = sweepAngle / CGFloat(segmentCount)
        let handle = 4 / 3 * tan(segmentAngle / 4)

        // Unit-circle points mapped onto the rotated ellipse.
        func onEllipse(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(
                x: center.x + rx * cosine * x - ry * sine * y,
                y: center.y + rx * sine * x + ry * cosine * y
            )
        }

        for segment in 0..<segmentCount {
            let segmentStart = startAngle + CGFloat(segment) * segmentAngle
            let segmentEnd = segmentStart + segmentAngle
            let (startCos, startSin) = (cos(segmentStart), sin(segmentStart))
            let (endCos, endSin) = (cos(segmentEnd), sin(segmentEnd))

            path.addCurve(
                to: onEllipse(endCos, endSin),
                control1: onEllipse(startCos - handle * startSin, startSin + handle * startCos),
                control2: onEllipse(endCos + handle * endSin, endSin - handle * endCos)
            )
        }
    }

    private static func angle(from first: CGPoint, to second: CGPoint) -> CGFloat {
        atan2(first.x * second.y - first.y * second.x, first.x * second.x + first.y * second.y)
    }
}
