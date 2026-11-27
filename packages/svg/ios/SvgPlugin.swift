import Nativue
import UIKit

/// <svg>'s view, and the icons it draws for tab bars and headers (svgIcon).
public final class SvgPlugin: NativuePlugin {
    public init() {}

    public func register(in registry: PluginRegistry) {
        registry.addView("Svg") { sendEvent in
            let svgView = SvgView(frame: .zero)
            svgView.onElementPress = { nodeIds, location in
                sendEvent("elementpress", ["nodeIds": nodeIds, "x": location.x, "y": location.y])
            }

            return svgView
        }

        registry.addIconDrawer("svg") { icon, size in SvgView.iconImage(icon, size: size) }
    }
}
