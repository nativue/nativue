import UIKit

/// <Text>: its text starts at the top of a taller box, as on Android and the web (UILabel centers it).
final class TextLabel: UILabel {
    var contentPadding: UIEdgeInsets = .zero {
        didSet { setNeedsDisplay() }
    }

    override func drawText(in bounds: CGRect) {
        let rect = bounds.inset(by: contentPadding)
        let textHeight = textRect(forBounds: rect, limitedToNumberOfLines: numberOfLines).height
        super.drawText(in: CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: min(textHeight, rect.height)))
    }
}
