import UIKit

/// The native side of a package: functions JavaScript calls (`requireNativeFunction`) and views it
/// renders. Packages declare their plugin in package.json; the CLI links them into the app
/// (ios/NativuePlugins) and the app passes them on: `NativueView(plugins: nativuePlugins)`.
public protocol NativuePlugin {
    func register(in registry: PluginRegistry)
}

public final class PluginRegistry {
    public typealias Function = (_ arguments: [Any]) -> Any?
    /// Its result resolves the JavaScript call's Promise; a thrown error rejects it.
    public typealias AsyncFunction = (_ arguments: [Any]) async throws -> Any?
    /// sendEvent("change", payload) reaches the element's @change; event names are lowercase.
    public typealias SendEvent = (_ eventName: String, _ payload: Any?) -> Void
    public typealias MakeView = (_ sendEvent: @escaping SendEvent) -> UIView
    /// An icon JS describes ({ drawer, ... }) drawn at `size` points, for a tab bar or a header.
    public typealias DrawIcon = (_ icon: [String: Any], _ size: CGFloat) -> UIImage?

    /// Set by the Bridge: calls JavaScript's listeners.
    var sendToJavaScript: (_ eventName: String, _ payload: Any?) -> Void = { _, _ in }
    private(set) var functions: [String: Function] = [:]
    private(set) var asyncFunctions: [String: AsyncFunction] = [:]
    private(set) var viewMakers: [String: MakeView] = [:]

    init(plugins: [NativuePlugin]) {
        plugins.forEach { $0.register(in: self) }
    }

    /// Runs on the JavaScript thread and returns synchronously: hop to the main thread for UIKit.
    public func addFunction(_ name: String, _ function: @escaping Function) {
        functions[name] = function
    }

    /// For work that takes time (a permission prompt, the camera): JavaScript gets a Promise. Runs off the
    /// main thread: use `await MainActor.run { ... }` for UIKit.
    public func addAsyncFunction(_ name: String, _ function: @escaping AsyncFunction) {
        asyncFunctions[name] = function
    }

    /// Reaches JavaScript's addNativeListener(eventName) listeners, from any thread, e.g.
    /// sendEvent("notifications.received", payload). Dropped while no JavaScript runs: keep what must
    /// outlive it (a push token) and let JavaScript read it with a function.
    public func sendEvent(_ eventName: String, _ payload: Any? = nil) {
        sendToJavaScript(eventName, payload)
    }

    /// `type` is the element's tag, e.g. "MapView" for h('MapView'). Created on the main thread.
    public func addView(_ type: String, _ makeView: @escaping MakeView) {
        viewMakers[type] = makeView
    }

    /// The view controller on top, the app's or what it presents, to present a system screen from (a photo
    /// picker, the camera). nil before the app shows its window.
    @MainActor public var topViewController: UIViewController? {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        guard let root = (windows.first { $0.isKeyWindow } ?? windows.first)?.rootViewController else { return nil }

        return sequence(first: root, next: \.presentedViewController).reduce(root) { _, presented in presented }
    }

    /// Draws the tab bar and header icons whose `drawnIcon.drawer` is `drawer` (see router.ts's DrawnIcon).
    /// The image is tinted, like an SF Symbol: only its shape counts.
    public func addIconDrawer(_ drawer: String, _ draw: @escaping DrawIcon) {
        NavigationIcons.drawersByName[drawer] = draw
    }
}

/// A plugin view that takes its own touches where `point(inside:with:)` says, which a <Pressable> around it
/// leaves to it.
public protocol InteractiveView: UIView {}

/// Thrown by an async function: JavaScript's Promise rejects with an Error whose `code` is this one.
/// Codes nativue's packages share: ERR_PERMISSION_DENIED, ERR_UNAVAILABLE, ERR_CANCELED,
/// ERR_INVALID_ARGUMENT.
public struct PluginError: LocalizedError {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }

    public var errorDescription: String? { message }
}

/// A plugin view gets its props here, all but `style`, `accessibility`, `@layout` and the gestures (`@pan`...), which nativue applies.
public protocol PluginView: UIView {
    func setProp(_ key: String, value: Any?)
}
