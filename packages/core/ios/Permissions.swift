/// What JavaScript's PermissionResponse is, for an async function to return.
public enum PermissionStatus: String {
    case granted, denied, undetermined
}

/// `{ status, granted, canAskAgain }` plus the plugin's own fields, e.g. `["accessPrivileges": "limited"]`.
/// canAskAgain is false only when denied: iOS shows the prompt once.
public func permissionResponse(
    _ status: PermissionStatus,
    extra: [String: Any] = [:]
) -> [String: Any] {
    let response: [String: Any] = [
        "status": status.rawValue,
        "granted": status == .granted,
        "canAskAgain": status != .denied,
    ]

    return response.merging(extra) { _, extraValue in extraValue }
}
