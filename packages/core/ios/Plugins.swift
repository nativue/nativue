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

    /// For work that takes time (a permission prompt, the camera): JavaScript gets a Promise.
    public func addAsyncFunction(_ name: String, _ function: @escaping AsyncFunction) {
        asyncFunctions[name] = function
    }

    /// `type` is the element's tag, e.g. "MapView" for h('MapView'). Created on the main thread.
    public func addView(_ type: String, _ makeView: @escaping MakeView) {
        viewMakers[type] = makeView
    }
}

/// A plugin view gets its props here, all but `style`, which nativue applies (layout included).
public protocol PluginView: UIView {
    func setProp(_ key: String, value: Any?)
}
