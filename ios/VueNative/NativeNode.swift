import CoreText
import UIKit
import yoga

/// A native view paired with the Yoga node that lays it out.
final class NativeNode {
    private static let yogaConfig: YGConfigRef = {
        let config = YGConfigNew()!
        YGConfigSetPointScaleFactor(config, Float(UIScreen.main.scale))

        return config
    }()

    let view: UIView
    let yogaNode: YGNodeRef

    var fontSize: CGFloat = UIFont.labelFontSize
    var fontWeight: UIFont.Weight = .regular

    /// Leaf nodes (Text, Button) measure their own content; containers are sized by their children.
    init(view: UIView, measuresContent: Bool) {
        self.view = view
        yogaNode = YGNodeNewWithConfig(Self.yogaConfig)
        YGNodeSetContext(yogaNode, Unmanaged.passUnretained(view).toOpaque())

        if measuresContent {
            YGNodeSetMeasureFunc(yogaNode, measureView)
        }
    }

    deinit {
        YGNodeFree(yogaNode)
    }

    var canHaveChildren: Bool {
        !YGNodeHasMeasureFunc(yogaNode)
    }

    static func view(of yogaNode: YGNodeConstRef) -> UIView {
        Unmanaged<UIView>.fromOpaque(YGNodeGetContext(yogaNode)).takeUnretainedValue()
    }

    /// Call when content that affects the measured size changes (text, title, font).
    func markContentChanged() {
        if !canHaveChildren {
            YGNodeMarkDirty(yogaNode)
        }
    }

    func insertChild(_ child: NativeNode, at index: Int) {
        child.removeFromParent()

        YGNodeInsertChild(yogaNode, child.yogaNode, index)
        view.insertSubview(child.view, at: index)
    }

    func removeFromParent() {
        if let owner = YGNodeGetOwner(yogaNode) {
            YGNodeRemoveChild(owner, yogaNode)
        }

        view.removeFromSuperview()
    }

    /// Computes the layout for this subtree and applies the resulting frames to the views.
    func calculateLayout(width: CGFloat, height: CGFloat) {
        YGNodeCalculateLayout(yogaNode, Float(width), Float(height), .LTR)
        Self.applyFrames(of: yogaNode)
    }

    /// Only visits subtrees Yoga laid out again; untouched subtrees keep their frames.
    private static func applyFrames(of yogaNode: YGNodeRef) {
        for index in 0..<YGNodeGetChildCount(yogaNode) {
            let child = YGNodeGetChild(yogaNode, index)!
            guard YGNodeGetHasNewLayout(child) else { continue }

            YGNodeSetHasNewLayout(child, false)

            view(of: child).frame = CGRect(
                x: CGFloat(YGNodeLayoutGetLeft(child)),
                y: CGFloat(YGNodeLayoutGetTop(child)),
                width: CGFloat(YGNodeLayoutGetWidth(child)),
                height: CGFloat(YGNodeLayoutGetHeight(child))
            )

            applyFrames(of: child)
        }
    }
}

private func measureView(
    yogaNode: YGNodeConstRef?,
    width: Float,
    widthMode: YGMeasureMode,
    height: Float,
    heightMode: YGMeasureMode
) -> YGSize {
    MainActor.assumeIsolated {
        let maxWidth = widthMode == .undefined ? CGFloat.greatestFiniteMagnitude : CGFloat(width)
        let maxHeight = heightMode == .undefined ? CGFloat.greatestFiniteMagnitude : CGFloat(height)

        let view = NativeNode.view(of: yogaNode!)
        let singleLineLabelSize = (view as? UILabel).flatMap { singleLineSize(of: $0, maxWidth: maxWidth) }
        let fittingSize = singleLineLabelSize ?? view.sizeThatFits(CGSize(width: maxWidth, height: maxHeight))

        return YGSize(
            width: Float(min(fittingSize.width, maxWidth)),
            height: Float(min(fittingSize.height, maxHeight))
        )
    }
}

/// Fast path for the common case: CoreText measures a single line far faster than UILabel.sizeThatFits.
/// Returns nil when the text needs wrapping, so the caller falls back to the full measurement.
@MainActor private func singleLineSize(of label: UILabel, maxWidth: CGFloat) -> CGSize? {
    guard let text = label.text, !text.contains(where: \.isNewline) else { return nil }

    let attributedText = NSAttributedString(string: text, attributes: [.font: label.font!])
    let line = CTLineCreateWithAttributedString(attributedText)
    let width = ceil(CTLineGetTypographicBounds(line, nil, nil, nil))
    guard width <= maxWidth else { return nil }

    return CGSize(width: width, height: ceil(label.font.lineHeight))
}
