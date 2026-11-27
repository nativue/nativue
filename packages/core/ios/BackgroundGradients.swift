import UIKit

/// backgroundImage: CSS gradients (src/gradients.ts) under a view's content and over its backgroundColor,
/// in a layer that follows its bounds and corners. The first gradient is on top, as in CSS.
final class BackgroundGradientsLayer: CALayer {
    private var gradients: [[String: Any]] = []

    func setGradients(_ gradients: [[String: Any]]) {
        self.gradients = gradients
        sublayers = gradients.reversed().map(GradientLayer.init)
    }

    /// Their geometry depends on the size: an angle's line, a corner, a radius.
    func layoutGradients() {
        for layer in sublayers ?? [] where layer.frame != bounds {
            layer.frame = bounds
            layer.setNeedsDisplay()
        }
    }
}

/// One gradient, drawn in points: CAGradientLayer works in a unit square stretched to the layer, which
/// tilts an angle on a box that isn't square.
private final class GradientLayer: CALayer {
    private let gradient: [String: Any]

    init(_ gradient: [String: Any]) {
        self.gradient = gradient
        super.init()
        contentsScale = UIScreen.main.scale
        needsDisplayOnBoundsChange = true
    }

    override init(layer: Any) {
        gradient = (layer as? GradientLayer)?.gradient ?? [:]
        super.init(layer: layer)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func draw(in context: CGContext) {
        CSSGradient.draw(gradient, in: context, size: bounds.size)
    }
}

extension UIView {
    /// The gradients layer, created under the view's subviews the first time it's needed. A label or an image
    /// view draws its content in its own layer, which the gradients would cover: they get none.
    func setBackgroundGradients(_ gradients: [[String: Any]]) {
        guard !(self is UILabel || self is UIImageView) else { return }

        let existing = layer.sublayers?.first { $0 is BackgroundGradientsLayer } as? BackgroundGradientsLayer
        guard !gradients.isEmpty else {
            existing?.removeFromSuperlayer()
            return
        }

        let gradientsLayer = existing ?? BackgroundGradientsLayer()
        if existing == nil {
            // Behind the subviews' layers, wherever they're inserted.
            gradientsLayer.zPosition = -1
            layer.insertSublayer(gradientsLayer, at: 0)
        }
        gradientsLayer.setGradients(gradients)
        applyBackgroundGradients()
    }

    /// Fitted to the view's bounds and corners, again as its frame changes: at once, or along with a
    /// LayoutAnimation. A scroll view's bounds move as it scrolls, keeping the gradients in place.
    func applyBackgroundGradients() {
        guard let gradientsLayer = layer.sublayers?.first(where: { $0 is BackgroundGradientsLayer }) as? BackgroundGradientsLayer
        else { return }

        let animationDuration = UIView.inheritedAnimationDuration

        CATransaction.begin()
        CATransaction.setDisableActions(animationDuration == 0)
        CATransaction.setAnimationDuration(animationDuration)
        gradientsLayer.frame = bounds
        gradientsLayer.cornerRadius = layer.cornerRadius
        gradientsLayer.maskedCorners = layer.maskedCorners
        gradientsLayer.masksToBounds = true
        gradientsLayer.layoutGradients()
        CATransaction.commit()
    }
}

/// Where CSS puts a gradient in a box of `size`, as Android's BackgroundGradients does.
enum CSSGradient {
    static func draw(_ gradient: [String: Any], in context: CGContext, size: CGSize) {
        let colors = (gradient["colors"] as? [Any] ?? []).compactMap { UIColor(rgba: $0)?.cgColor }
        let locations = (gradient["positions"] as? [NSNumber] ?? []).map { CGFloat($0.doubleValue) }
        guard
            size.width > 0, size.height > 0, colors.count == locations.count,
            let cgGradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: colors as CFArray, locations: locations)
        else { return }

        // Past the ends, the end colors, as CSS pads them.
        let extend: CGGradientDrawingOptions = [.drawsBeforeStartLocation, .drawsAfterEndLocation]

        if gradient["type"] as? String == "radial" {
            let (center, radii) = radial(gradient, size: size)
            let radius = max(radii.width, 0.01)

            // A circle, stretched into the ellipse.
            context.translateBy(x: center.x, y: center.y)
            context.scaleBy(x: 1, y: max(radii.height, 0.01) / radius)
            context.drawRadialGradient(
                cgGradient, startCenter: .zero, startRadius: 0, endCenter: .zero, endRadius: radius, options: extend
            )
        } else {
            let (start, end) = linear(gradient, size: size)

            context.drawLinearGradient(cgGradient, start: start, end: end, options: extend)
        }
    }

    /// The gradient line: through the center, as long as the box is along it, so its ends touch the corners.
    static func linear(_ gradient: [String: Any], size: CGSize) -> (start: CGPoint, end: CGPoint) {
        var direction = CGVector(dx: 0, dy: 1)

        if let sides = gradient["to"] as? [String] {
            let x: CGFloat = sides.contains("right") ? 1 : sides.contains("left") ? -1 : 0
            let y: CGFloat = sides.contains("bottom") ? 1 : sides.contains("top") ? -1 : 0
            // To a corner: perpendicular to the diagonal between the two corners next to it.
            direction = x != 0 && y != 0 ? CGVector(dx: x * size.height, dy: y * size.width) : CGVector(dx: x, dy: y)
        } else if let angle = (gradient["angle"] as? NSNumber).map({ CGFloat($0.doubleValue) * .pi / 180 }) {
            // 0 points up, 90 right.
            direction = CGVector(dx: sin(angle), dy: -cos(angle))
        }

        let length = hypot(direction.dx, direction.dy)
        guard length > 0 else { return (.zero, CGPoint(x: 0, y: size.height)) }

        let unitDirection = CGVector(dx: direction.dx / length, dy: direction.dy / length)
        let halfLine = (abs(size.width * unitDirection.dx) + abs(size.height * unitDirection.dy)) / 2
        let center = CGPoint(x: size.width / 2, y: size.height / 2)

        return (
            CGPoint(x: center.x - unitDirection.dx * halfLine, y: center.y - unitDirection.dy * halfLine),
            CGPoint(x: center.x + unitDirection.dx * halfLine, y: center.y + unitDirection.dy * halfLine)
        )
    }

    /// The center and the radii: given, or reaching the extent keyword's side or corner.
    static func radial(_ gradient: [String: Any], size: CGSize) -> (center: CGPoint, radii: CGSize) {
        let center = CGPoint(
            x: length(gradient["center"], index: 0, of: size.width, default: 0.5),
            y: length(gradient["center"], index: 1, of: size.height, default: 0.5)
        )
        let isCircle = gradient["shape"] as? String == "circle"

        if gradient["radii"] != nil {
            let radiusX = length(gradient["radii"], index: 0, of: size.width, default: 0.5)
            let radiusY = isCircle ? radiusX : length(gradient["radii"], index: 1, of: size.height, default: 0.5)

            return (center, CGSize(width: radiusX, height: radiusY))
        }

        let horizontal = [center.x, size.width - center.x].map(abs)
        let vertical = [center.y, size.height - center.y].map(abs)
        let extent = gradient["extent"] as? String ?? "farthest-corner"
        let pick = extent.hasPrefix("closest") ? { (values: [CGFloat]) in values.min() ?? 0 } : { $0.max() ?? 0 }
        let (sideX, sideY) = (pick(horizontal), pick(vertical))

        switch (extent.hasSuffix("corner"), isCircle) {
        case (true, true):
            let radius = hypot(sideX, sideY)
            return (center, CGSize(width: radius, height: radius))
        case (true, false):
            // An ellipse through the corner, shaped like the one that would touch the sides.
            return (center, CGSize(width: sideX * sqrt(2), height: sideY * sqrt(2)))
        case (false, true):
            let radius = pick([sideX, sideY])
            return (center, CGSize(width: radius, height: radius))
        case (false, false):
            return (center, CGSize(width: sideX, height: sideY))
        }
    }

    /// [[fraction, points], ...][index], in points of a side `side` long.
    private static func length(_ value: Any?, index: Int, of side: CGFloat, default fraction: CGFloat) -> CGFloat {
        guard let lengths = value as? [[NSNumber]], index < lengths.count, lengths[index].count == 2 else {
            return fraction * side
        }

        return CGFloat(lengths[index][0].doubleValue) * side + CGFloat(lengths[index][1].doubleValue)
    }
}
