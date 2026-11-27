import Nativue

/// __MODULE__.* in src/index.ts. Apps rebuild after installing or updating it.
public final class __PASCAL__Plugin: NativuePlugin {
    public init() {}

    public func register(in registry: PluginRegistry) {
        registry.addFunction("__MODULE__.hello") { arguments in
            "Hello, \(arguments.first as? String ?? "world"), from iOS"
        }
    }
}
