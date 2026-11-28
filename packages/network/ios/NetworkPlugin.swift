import Foundation
import Nativue
import Network

/// Network (src/index.ts): the system's path monitor, watching from the start, so getState answers at once
/// and each change reaches JavaScript as network.change.
public final class NetworkPlugin: NativuePlugin {
    private let monitor = NWPathMonitor()
    /// Owns everything below.
    private let queue = DispatchQueue(label: "nativue.network")
    private var isWatching = false
    /// The newest JavaScript runtime's: a reload makes a new one.
    private weak var registry: PluginRegistry?
    private var latestState: [String: Any]?
    private var waitingForFirstState: [CheckedContinuation<[String: Any], Never>] = []

    public init() {}

    /// Called again for each new JavaScript runtime: the monitor starts once, for the whole process.
    public func register(in registry: PluginRegistry) {
        queue.async { [unowned self] in
            self.registry = registry
            guard !isWatching else { return }

            isWatching = true
            monitor.pathUpdateHandler = { [unowned self] path in report(Self.state(of: path)) }
            monitor.start(queue: queue)
        }

        registry.addAsyncFunction("network.getState") { [unowned self] _ in
            await currentState()
        }
    }

    private func report(_ state: [String: Any]) {
        let hasChanged = latestState.map { NSDictionary(dictionary: $0) != NSDictionary(dictionary: state) } ?? true

        latestState = state
        waitingForFirstState.forEach { $0.resume(returning: state) }
        waitingForFirstState = []
        if hasChanged { registry?.sendEvent("network.change", state) }
    }

    /// The monitor reports the path soon after it starts: a call before that waits for it.
    private func currentState() async -> [String: Any] {
        await withCheckedContinuation { continuation in
            queue.async { [unowned self] in
                if let latestState { return continuation.resume(returning: latestState) }

                waitingForFirstState.append(continuation)
            }
        }
    }

    /// iOS has no check that the internet answers: satisfied is a route out.
    private static func state(of path: NWPath) -> [String: Any] {
        let isConnected = path.status == .satisfied

        return [
            "isConnected": isConnected,
            "isInternetReachable": isConnected,
            "type": isConnected ? type(of: path) : "none",
            "isExpensive": path.isExpensive,
        ]
    }

    private static func type(of path: NWPath) -> String {
        if path.usesInterfaceType(.wifi) { return "wifi" }
        if path.usesInterfaceType(.cellular) { return "cellular" }
        if path.usesInterfaceType(.wiredEthernet) { return "ethernet" }

        return "other"
    }
}
