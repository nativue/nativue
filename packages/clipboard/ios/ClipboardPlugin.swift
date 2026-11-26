import Nativue
import UIKit

/// Clipboard.copy (src/index.ts). Resolves with whether the system confirmed the copy: never on iOS.
public final class ClipboardPlugin: NativuePlugin {
    public init() {}

    public func register(in registry: PluginRegistry) {
        registry.addAsyncFunction("clipboard.copy") { arguments in
            let text = arguments[0] as! String

            await MainActor.run { UIPasteboard.general.string = text }

            return false
        }
    }
}
