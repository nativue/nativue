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

    public init() {}

    public func register(in registry: PluginRegistry) {
        registry.addAsyncFunction("secureStore.setItem") { arguments in
            let key = arguments[0] as! String
            let value = arguments[1] as! String
            var item = Self.query(for: key)

            // Deleted first: updating an item can't change when it's accessible.
            SecItemDelete(item as CFDictionary)
            item[kSecValueData as String] = Data(value.utf8)
            item[kSecAttrAccessible as String] = Self.accessibilities[arguments[2] as? String ?? ""] ?? kSecAttrAccessibleWhenUnlocked
            try Self.check(SecItemAdd(item as CFDictionary, nil))

            return nil
        }

        registry.addAsyncFunction("secureStore.getItem") { arguments in
            var query = Self.query(for: arguments[0] as! String)
            var result: AnyObject?

            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne

            let status = SecItemCopyMatching(query as CFDictionary, &result)
            if status == errSecItemNotFound { return nil }
            try Self.check(status)

            return (result as? Data).flatMap { String(data: $0, encoding: .utf8) }
        }

        registry.addAsyncFunction("secureStore.deleteItem") { arguments in
            let status = SecItemDelete(Self.query(for: arguments[0] as! String) as CFDictionary)
            if status != errSecItemNotFound { try Self.check(status) }

            return nil
        }
    }

    private static func query(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }

    /// errSecInteractionNotAllowed: a 'whenUnlocked' item read while the device is locked.
    private static func check(_ status: OSStatus) throws {
        guard status != errSecSuccess else { return }

        let message = SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)"

        throw PluginError(code: "ERR_UNAVAILABLE", message: message)
    }
}
