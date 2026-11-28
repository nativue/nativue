import CoreLocation
import Nativue
import UIKit

/// Location (src/index.ts): Core Location, a manager per request and per watch, each with its own accuracy.
public final class LocationPlugin: NativuePlugin {
    private weak var registry: PluginRegistry?
    /// On the main thread, by the id JavaScript gave each watch.
    private var watches: [Int: LocationUpdates] = [:]

    public init() {}

    public func register(in registry: PluginRegistry) {
        self.registry = registry
        // Called again for each new JavaScript runtime: the old one's watches have no one to report to.
        DispatchQueue.main.async { [self] in
            watches.values.forEach { $0.stop() }
            watches = [:]
        }

        registry.addAsyncFunction("location.getPermission") { _ in
            await MainActor.run { Self.permission(of: CLLocationManager()) }
        }

        registry.addAsyncFunction("location.requestPermission") { arguments in
            try await Self.requestPermission(background: arguments[0] as! Bool)
        }

        registry.addAsyncFunction("location.getCurrentPosition") { arguments in
            try await Self.currentPosition(
                accuracy: Self.accuracy(arguments[0] as! String),
                timeout: (arguments[1] as! NSNumber).doubleValue / 1000
            )
        }

        registry.addAsyncFunction("location.getLastKnownPosition") { _ in
            await MainActor.run { CLLocationManager().location.map(Self.position) }
        }

        registry.addAsyncFunction("location.hasServicesEnabled") { _ in CLLocationManager.locationServicesEnabled() }

        registry.addAsyncFunction("location.enableServices") { _ in CLLocationManager.locationServicesEnabled() }

        registry.addAsyncFunction("location.startWatching") { [unowned self] arguments in
            try await startWatching(arguments[0] as! Int, options: arguments[1] as! [String: Any])

            return nil
        }

        registry.addAsyncFunction("location.stopWatching") { [unowned self] arguments in
            await MainActor.run { watches.removeValue(forKey: arguments[0] as! Int)?.stop() }

            return nil
        }
    }

    @MainActor
    private func startWatching(_ watchId: Int, options: [String: Any]) throws {
        try Self.checkCanLocate()

        let updates = LocationUpdates(accuracy: Self.accuracy(options["accuracy"] as! String), isWatch: true)
        let distance = (options["distanceInterval"] as! NSNumber).doubleValue

        updates.manager.distanceFilter = distance > 0 ? distance : kCLDistanceFilterNone
        // Set without the background mode, Core Location stops the app.
        if Self.hasBackgroundMode {
            updates.manager.allowsBackgroundLocationUpdates = true
            updates.manager.showsBackgroundLocationIndicator = true
        }
        updates.onLocation = { [weak registry] location in
            registry?.sendEvent("location.watch", ["watchId": watchId, "position": Self.position(location)])
        }
        updates.onError = { [weak self] error in
            self?.watches.removeValue(forKey: watchId)?.stop()
            self?.registry?.sendEvent("location.watch", ["watchId": watchId, "code": error.code, "message": error.message])
        }
        watches[watchId] = updates
        updates.manager.startUpdatingLocation()
    }

    @MainActor
    private static func currentPosition(accuracy: CLLocationAccuracy, timeout: TimeInterval) async throws -> [String: Any] {
        try checkCanLocate()

        let updates = LocationUpdates(accuracy: accuracy, isWatch: false)
        let location = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<CLLocation, Error>) in
            var hasAnswered = false
            let answer = { (result: Result<CLLocation, Error>) in
                guard !hasAnswered else { return }

                hasAnswered = true
                updates.stop()
                continuation.resume(with: result)
            }

            updates.onLocation = { answer(.success($0)) }
            updates.onError = { answer(.failure($0)) }
            DispatchQueue.main.asyncAfter(deadline: .now() + timeout) {
                answer(.failure(PluginError(code: "ERR_TIMEOUT", message: "No position within the timeout")))
            }
            updates.manager.requestLocation()
        }

        return position(location)
    }

    /// Asks for when in use first: iOS offers always only to an app that has it.
    @MainActor
    private static func requestPermission(background: Bool) async throws -> [String: Any] {
        let manager = CLLocationManager()

        if background, Bundle.main.object(forInfoDictionaryKey: "NSLocationAlwaysAndWhenInUseUsageDescription") == nil {
            throw PluginError(
                code: "ERR_INVALID_ARGUMENT",
                message: "Asking for the location all the time needs location({ background: true }) in nativue.config.ts"
            )
        }
        if manager.authorizationStatus == .notDetermined {
            await AuthorizationPrompt(manager).answer { manager.requestWhenInUseAuthorization() }
        }
        if background, manager.authorizationStatus == .authorizedWhenInUse {
            await AuthorizationPrompt(manager).answer { manager.requestAlwaysAuthorization() }
        }

        return permission(of: manager)
    }

    @MainActor
    private static func checkCanLocate() throws {
        let status = CLLocationManager().authorizationStatus

        guard status == .authorizedWhenInUse || status == .authorizedAlways else {
            throw PluginError(code: "ERR_PERMISSION_DENIED", message: "No location permission: ask with requestPermission() first")
        }
        guard CLLocationManager.locationServicesEnabled() else {
            throw PluginError(code: "ERR_UNAVAILABLE", message: "Location is turned off on the device")
        }
    }

    private static func permission(of manager: CLLocationManager) -> [String: Any] {
        switch manager.authorizationStatus {
        case .notDetermined:
            return permissionResponse(.undetermined)
        case .authorizedAlways, .authorizedWhenInUse:
            return permissionResponse(.granted, extra: [
                "accuracy": manager.accuracyAuthorization == .fullAccuracy ? "precise" : "approximate",
                "scope": manager.authorizationStatus == .authorizedAlways ? "always" : "whenInUse",
            ])
        default:
            return permissionResponse(.denied)
        }
    }

    private static var hasBackgroundMode: Bool {
        (Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String])?.contains("location") == true
    }

    private static func accuracy(_ name: String) -> CLLocationAccuracy {
        switch name {
        case "high": kCLLocationAccuracyBest
        case "low": kCLLocationAccuracyKilometer
        default: kCLLocationAccuracyHundredMeters
        }
    }

    /// Core Location's negative values mean it doesn't know: null, as on the web.
    private static func position(_ location: CLLocation) -> [String: Any] {
        let known = { (value: Double, isKnown: Bool) -> Any in isKnown ? value : NSNull() }

        return [
            "coords": [
                "latitude": location.coordinate.latitude,
                "longitude": location.coordinate.longitude,
                "accuracy": location.horizontalAccuracy,
                "altitude": known(location.altitude, location.verticalAccuracy >= 0),
                "altitudeAccuracy": known(location.verticalAccuracy, location.verticalAccuracy >= 0),
                "heading": known(location.course, location.course >= 0),
                "speed": known(location.speed, location.speed >= 0),
            ],
            "timestamp": location.timestamp.timeIntervalSince1970 * 1000,
        ]
    }
}

/// A manager and its delegate: positions until stopped, errors as PluginErrors.
private final class LocationUpdates: NSObject, CLLocationManagerDelegate {
    let manager = CLLocationManager()
    private let isWatch: Bool
    var onLocation: (CLLocation) -> Void = { _ in }
    var onError: (PluginError) -> Void = { _ in }

    init(accuracy: CLLocationAccuracy, isWatch: Bool) {
        self.isWatch = isWatch
        super.init()
        manager.desiredAccuracy = accuracy
        manager.delegate = self
    }

    // The callbacks hold what holds this: let go of them.
    func stop() {
        manager.stopUpdatingLocation()
        manager.delegate = nil
        onLocation = { _ in }
        onError = { _ in }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        locations.last.map(onLocation)
    }

    // locationUnknown is a moment without a fix: updates go on, and requestLocation reports it as unavailable.
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let code = (error as? CLError)?.code

        if code == .denied { return onError(PluginError(code: "ERR_PERMISSION_DENIED", message: "The location permission was taken away")) }
        if code == .locationUnknown, isWatch { return }

        onError(PluginError(code: "ERR_UNAVAILABLE", message: error.localizedDescription))
    }
}

/// Waits for the user's answer to a prompt. iOS calls the delegate only when the status changes, so
/// "Keep only while using" is the app coming back to the front, and a prompt iOS doesn't show (always
/// asked before) is the app never leaving it.
private final class AuthorizationPrompt: NSObject, CLLocationManagerDelegate {
    private let manager: CLLocationManager
    private let initialStatus: CLAuthorizationStatus
    private var finish: (() -> Void)?
    private var observers: [NSObjectProtocol] = []

    init(_ manager: CLLocationManager) {
        self.manager = manager
        initialStatus = manager.authorizationStatus
    }

    @MainActor
    func answer(_ ask: () -> Void) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            var hasLeftApp = false

            finish = { [weak self] in
                guard let self, finish != nil else { return }

                finish = nil
                manager.delegate = nil
                observers.forEach(NotificationCenter.default.removeObserver)
                continuation.resume()
            }
            observers = [
                NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { _ in
                    hasLeftApp = true
                },
                NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
                    self?.finish?()
                },
            ]
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
                if !hasLeftApp { self?.finish?() }
            }
            manager.delegate = self
            ask()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus != initialStatus { finish?() }
    }
}
