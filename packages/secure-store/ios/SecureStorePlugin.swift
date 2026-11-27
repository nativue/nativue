import Foundation
import Nativue
import Security

/// SecureStore (src/index.ts): generic passwords in the app's Keychain, under one service.
public final class SecureStorePlugin: NativuePlugin {
    private static let service = "nativue.secure-store"
    private static let accessibilities: [String: CFString] = [
        "whenUnlocked": kSecAttrAccessibleWhenUnlocked,
        "afterFirstUnlock": kSecAttrAccessibleAfterFirstUnlock,
        "whenUnlockedThisDeviceOnly": kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        "afterFirstUnlockThisDeviceOnly": kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]

    // One call at a time, as on Android: two writes to a key don't race.
    private let queue = DispatchQueue(label: "nativue.secure-store")

    public init() {}

    public func register(in registry: PluginRegistry) {
        registry.addAsyncFunction("secureStore.setItem") { [queue] arguments in
            let key = arguments[0] as! String
            let value = Data((arguments[1] as! String).utf8)
            let accessible = Self.accessibilities[arguments[2] as! String] ?? kSecAttrAccessibleWhenUnlocked

            try await Self.run(on: queue) {
                // Updated in place: a failed write leaves the old value as it was.
                let changes = [kSecValueData as String: value, kSecAttrAccessible as String: accessible] as [String: Any]
                let status = SecItemUpdate(Self.query(for: key) as CFDictionary, changes as CFDictionary)
                guard status == errSecItemNotFound else { return try Self.check(status) }

                try Self.check(SecItemAdd(Self.query(for: key).merging(changes) { _, change in change } as CFDictionary, nil))
            }

            return nil
        }

        registry.addAsyncFunction("secureStore.getItem") { [queue] arguments in
            let key = arguments[0] as! String

            return try await Self.run(on: queue) { () -> String? in
                var query = Self.query(for: key)
                var result: AnyObject?

                query[kSecReturnData as String] = true
                query[kSecMatchLimit as String] = kSecMatchLimitOne

                let status = SecItemCopyMatching(query as CFDictionary, &result)

                if status == errSecItemNotFound { return nil }
                try Self.check(status)

                return (result as? Data).flatMap { String(data: $0, encoding: .utf8) }
            }
        }

        registry.addAsyncFunction("secureStore.deleteItem") { [queue] arguments in
            let key = arguments[0] as! String

            try await Self.run(on: queue) {
                let status = SecItemDelete(Self.query(for: key) as CFDictionary)

                if status != errSecItemNotFound { try Self.check(status) }
            }

            return nil
        }
    }

    private static func run<Value>(on queue: DispatchQueue, _ work: @escaping () throws -> Value) async throws -> Value {
        try await withCheckedThrowingContinuation { continuation in
            queue.async { continuation.resume(with: Result { try work() }) }
        }
    }

    private static func query(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }

    /// errSecInteractionNotAllowed: a 'whenUnlocked' item used while the device is locked.
    private static func check(_ status: OSStatus) throws {
        guard status != errSecSuccess else { return }

        let message = SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)"

        throw PluginError(code: "ERR_UNAVAILABLE", message: message)
    }
}
