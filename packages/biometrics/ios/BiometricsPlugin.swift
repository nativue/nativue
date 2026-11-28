import LocalAuthentication
import Nativue

/// Biometrics (src/index.ts): Face ID, Touch ID and Optic ID through LocalAuthentication.
public final class BiometricsPlugin: NativuePlugin {
    public init() {}

    public func register(in registry: PluginRegistry) {
        registry.addAsyncFunction("biometrics.getStatus") { _ in Self.status() }

        registry.addAsyncFunction("biometrics.authenticate") { arguments in
            let options = arguments[0] as! [String: Any]
            let allowsDeviceCredential = options["allowDeviceCredential"] as? Bool ?? false
            // With the passcode, the system offers it after biometrics fails or isn't set up.
            let policy: LAPolicy = allowsDeviceCredential ? .deviceOwnerAuthentication : .deviceOwnerAuthenticationWithBiometrics
            let context = LAContext()
            var error: NSError?

            if let cancelLabel = options["cancelLabel"] as? String, !cancelLabel.isEmpty {
                context.localizedCancelTitle = cancelLabel
            }
            // Without the passcode, no "Enter Password" button after a failed try.
            if !allowsDeviceCredential { context.localizedFallbackTitle = "" }

            guard context.canEvaluatePolicy(policy, error: &error) else { return Self.failure(error) }

            do {
                try await context.evaluatePolicy(policy, localizedReason: options["reason"] as! String)

                return ["success": true]
            } catch {
                return Self.failure(error)
            }
        }
    }

    /// biometryType is set by canEvaluatePolicy, whatever it answers.
    private static func status() -> [String: Any] {
        let context = LAContext()
        var error: NSError?
        let canEvaluate = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        let code = error.map { LAError.Code(rawValue: $0.code) } ?? nil

        return [
            // Locked out still has biometrics set up: the passcode unlocks it again.
            "available": canEvaluate || code == .biometryNotEnrolled || code == .biometryLockout,
            "enrolled": canEvaluate || code == .biometryLockout,
            "types": types(of: context.biometryType),
        ]
    }

    private static func types(of biometryType: LABiometryType) -> [String] {
        switch biometryType {
        case .faceID: ["face"]
        case .touchID: ["fingerprint"]
        case .none: []
        default:
            if #available(iOS 17, *), biometryType == .opticID { ["iris"] } else { [] }
        }
    }

    private static func failure(_ error: Error?) -> [String: Any] {
        ["success": false, "error": reason(for: (error as? LAError)?.code)]
    }

    private static func reason(for code: LAError.Code?) -> String {
        switch code {
        case .userCancel, .appCancel, .userFallback: "canceled"
        case .systemCancel: "interrupted"
        case .biometryLockout: "lockout"
        case .biometryNotEnrolled, .passcodeNotSet: "not_enrolled"
        case .biometryNotAvailable: "not_available"
        default: "failed"
        }
    }
}
