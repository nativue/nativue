import UIKit

/// View behind <Svg>: draws SVG elements ([tag, attributes] pairs, the shape of Lucide's icon nodes),
/// scaled from `viewBox` to its bounds like preserveAspectRatio="xMidYMid meet". Elements are stroked
/// with `color` (round caps and joins, as icon sets expect); those whose fill isn't "none" are also
/// filled with it.
/// ponytail: only the shapes icon sets use and a single color; add per-element colors, gradients or
/// transforms when a real-world SVG needs them.
final class SvgView: UIView {
    var viewBox = CGRect(x: 0, y: 0, width: 24, height: 24) {
        didSet { setNeedsLayout() }
    }

    var strokeWidth: CGFloat = 2 {
        didSet { setNeedsLayout() }
    }

    var color: UIColor = .black {
        didSet { updateColors() }
    }

    var elements: [[Any]] = [] {
        didSet {
            buildPaths()
            setNeedsLayout()
        }
    }

    private let fillLayer = CAShapeLayer()
    private let strokeLayer = CAShapeLayer()
    private var strokePath = CGMutablePath()
    private var fillPath = CGMutablePath()

    override init(frame: CGRect) {
        super.init(frame: frame)

        isUserInteractionEnabled = false // a press on an icon presses what contains it
        strokeLayer.fillColor = nil
        strokeLayer.lineCap = .round
        strokeLayer.lineJoin = .round
        fillLayer.strokeColor = nil
        layer.addSublayer(fillLayer)
        layer.addSublayer(strokeLayer)
        updateColors()
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
        svgView.layoutIfNeeded()

        let image = UIGraphicsImageRenderer(bounds: svgView.bounds).image { context in
            svgView.layer.render(in: context.cgContext)
        }

        return image.withRenderingMode(.alwaysTemplate)
    }

    override func layoutSubviews() {
        super.layoutSubviews()

        guard viewBox.width > 0, viewBox.height > 0 else { return }

        let scale = min(bounds.width / viewBox.width, bounds.height / viewBox.height)
        var transform = CGAffineTransform(
            translationX: (bounds.width - viewBox.width * scale) / 2,
            y: (bounds.height - viewBox.height * scale) / 2
        )
        .scaledBy(x: scale, y: scale)
        .translatedBy(x: -viewBox.minX, y: -viewBox.minY)

        CATransaction.begin()
        CATransaction.setDisableActions(true) // shape layers would animate every path change
        for shapeLayer in [fillLayer, strokeLayer] { shapeLayer.frame = bounds }
        strokeLayer.path = strokePath.copy(using: &transform)
        fillLayer.path = fillPath.copy(using: &transform)
        strokeLayer.lineWidth = strokeWidth * scale
        CATransaction.commit()
    }

    private func updateColors() {
        strokeLayer.strokeColor = color.cgColor
        fillLayer.fillColor = color.cgColor
    }

    private func buildPaths() {
        strokePath = CGMutablePath()
        fillPath = CGMutablePath()

        for element in elements {
            guard
                let tag = element.first as? String,
                let attributes = element.last as? [String: Any],
                let shape = Self.shape(tag, SvgAttributes(values: attributes))
            else { continue }

            strokePath.addPath(shape)
            if let fill = attributes["fill"] as? String, fill != "none" { fillPath.addPath(shape) }
        }
    }

    private static func shape(_ tag: String, _ attributes: SvgAttributes) -> CGPath? {
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
