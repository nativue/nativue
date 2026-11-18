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

    /// Where children go when it isn't this node (a <Modal>'s children live in the presented controller).
    var contentNode: NativeNode?

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

        // Insert relative to the next sibling instead of by index: some views (UIScrollView) keep
        // private subviews such as scroll indicators, so subview indexes don't match ours.
        let nextIndex = index + 1
        if nextIndex < YGNodeGetChildCount(yogaNode) {
            let nextSibling = Self.view(of: YGNodeGetChild(yogaNode, nextIndex)!)
            view.insertSubview(child.view, belowSubview: nextSibling)
        } else {
            view.addSubview(child.view)
        }
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

    /// A view inserted during a layout animation would grow from the corner: it fades in where it lands.
    private static func appearWithoutMoving(_ view: UIView, at frame: CGRect) {
        let finalAlpha = view.alpha

        UIView.performWithoutAnimation {
            view.frame = frame
            view.alpha = 0
            view.layoutIfNeeded()
        }
        view.alpha = finalAlpha
    }

    /// Only visits subtrees Yoga laid out again; untouched subtrees keep their frames.
    private static func applyFrames(of yogaNode: YGNodeRef) {
        for index in 0..<YGNodeGetChildCount(yogaNode) {
            let child = YGNodeGetChild(yogaNode, index)!
            guard YGNodeGetHasNewLayout(child) else { continue }

            YGNodeSetHasNewLayout(child, false)

            let childView = view(of: child)
            let frame = CGRect(
                x: CGFloat(YGNodeLayoutGetLeft(child)),
                y: CGFloat(YGNodeLayoutGetTop(child)),
                width: CGFloat(YGNodeLayoutGetWidth(child)),
                height: CGFloat(YGNodeLayoutGetHeight(child))
            )

            // Yoga flags whole dirty paths as new layout. Reassigning a scroll view's frame or content
            // size, even unchanged, makes UIKit readjust its offset and shakes a bounce, so skip no-ops.
            if childView.frame == .zero, UIView.inheritedAnimationDuration > 0 {
                appearWithoutMoving(childView, at: frame)
            } else if childView.transform == .identity {
                if childView.frame != frame { childView.frame = frame }
            } else {
                // With a transform, `frame` is the transformed box: place the untransformed one.
                childView.bounds.size = frame.size
                childView.center = CGPoint(x: frame.midX, y: frame.midY)
            }

            applyFrames(of: child)

            if let scrollView = childView as? UIScrollView {
                let contentSize = contentSize(of: child)
                if scrollView.contentSize != contentSize { scrollView.contentSize = contentSize }
            }

            if let textInput = childView as? TextInputView {
                textInput.contentPadding = padding(of: child)
            }
        }
    }

    private static func padding(of yogaNode: YGNodeRef) -> UIEdgeInsets {
        UIEdgeInsets(
            top: CGFloat(YGNodeLayoutGetPadding(yogaNode, .top)),
            left: CGFloat(YGNodeLayoutGetPadding(yogaNode, .left)),
            bottom: CGFloat(YGNodeLayoutGetPadding(yogaNode, .bottom)),
            right: CGFloat(YGNodeLayoutGetPadding(yogaNode, .right))
        )
    }

    /// Children of a scroll view don't shrink (flexShrink defaults to 0), so they overflow its bounds;
    /// the scrollable area is how far they reach, plus the trailing padding.
    private static func contentSize(of yogaNode: YGNodeRef) -> CGSize {
        var contentWidth: Float = 0
        var contentHeight: Float = 0

        for index in 0..<YGNodeGetChildCount(yogaNode) {
            let child = YGNodeGetChild(yogaNode, index)!
            let right = YGNodeLayoutGetLeft(child) + YGNodeLayoutGetWidth(child) + YGNodeLayoutGetMargin(child, .right)
            let bottom = YGNodeLayoutGetTop(child) + YGNodeLayoutGetHeight(child) + YGNodeLayoutGetMargin(child, .bottom)

            contentWidth = max(contentWidth, right)
            contentHeight = max(contentHeight, bottom)
        }

        return CGSize(
            width: CGFloat(contentWidth + YGNodeLayoutGetPadding(yogaNode, .right)),
            height: CGFloat(contentHeight + YGNodeLayoutGetPadding(yogaNode, .bottom))
        )
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
