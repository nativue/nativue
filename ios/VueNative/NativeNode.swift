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

    private static func applyFrames(of yogaNode: YGNodeRef) {
        for index in 0..<YGNodeGetChildCount(yogaNode) {
            let child = YGNodeGetChild(yogaNode, index)!

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
        let fittingSize = view.sizeThatFits(CGSize(width: maxWidth, height: maxHeight))

        return YGSize(
            width: Float(min(fittingSize.width, maxWidth)),
            height: Float(min(fittingSize.height, maxHeight))
        )
    }
}
