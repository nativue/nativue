import AVFoundation
import Nativue
import PhotosUI
import UIKit
import UniformTypeIdentifiers

/// ImagePicker (src/index.ts): the system's photo picker (PHPicker, no permission needed) and the camera
/// (UIImagePickerController), for photos and videos. What's chosen is copied into the app's caches, as the picker's files are
/// only lent.
public final class ImagePickerPlugin: NativuePlugin {
    private weak var registry: PluginRegistry?
    /// The presented picker's delegate, kept until it reports.
    private var activeDelegate: NSObject?

    public init() {}

    public func register(in registry: PluginRegistry) {
        self.registry = registry

        registry.addAsyncFunction("imagePicker.pick") { [unowned self] arguments in
            let results = try await pick(limit: arguments[0] as! Int, mediaTypes: arguments[1] as! String)
            var picked: [[String: Any]] = []

            // One that won't load (an iCloud photo, offline) leaves the others.
            for result in results {
                if let media = try? await MediaFile.copy(from: result.itemProvider) { picked.append(media) }
            }

            return picked
        }

        registry.addAsyncFunction("imagePicker.openCamera") { [unowned self] arguments in
            let options = CameraOptions(
                mediaTypes: await Self.cameraMediaTypes(arguments[0] as! String),
                videoMaxDuration: arguments[1] as! Int,
                isLowQuality: arguments[2] as! String == "low"
            )

            guard !options.mediaTypes.isEmpty else {
                throw PluginError(code: "ERR_UNAVAILABLE", message: "This device has no camera for these media types")
            }
            guard await AVCaptureDevice.requestAccess(for: .video) else {
                throw PluginError(code: "ERR_PERMISSION_DENIED", message: "The camera permission was refused")
            }
            // Asked before the camera opens, rather than in the middle of a recording.
            if options.mediaTypes.contains(UTType.movie.identifier) { _ = await AVCaptureDevice.requestAccess(for: .audio) }

            guard let taken = try await openCamera(options) else { return nil }

            if let video = taken[.mediaURL] as? URL { return try await MediaFile.saveVideo(at: video) }
            guard let image = taken[.originalImage] as? UIImage else { return nil }

            return try MediaFile.save(image)
        }

        registry.addAsyncFunction("imagePicker.getCameraPermission") { _ in Self.cameraPermission() }

        registry.addAsyncFunction("imagePicker.requestCameraPermission") { _ in
            _ = await AVCaptureDevice.requestAccess(for: .video)

            return Self.cameraPermission()
        }

        // The app keeps running while the picker or the camera is open: nothing is ever pending.
        registry.addAsyncFunction("imagePicker.getPendingResult") { _ in nil }
    }

    @MainActor
    private func pick(limit: Int, mediaTypes: String) async throws -> [PHPickerResult] {
        let presenter = try presenter()

        var configuration = PHPickerConfiguration()
        configuration.selectionLimit = limit
        configuration.filter = ["images": .images, "videos": .videos][mediaTypes] ?? .any(of: [.images, .videos])
        // JPEG and H.264 rather than HEIC and HEVC: what Android and the web read too.
        configuration.preferredAssetRepresentationMode = .compatible

        return await withCheckedContinuation { continuation in
            let picker = PHPickerViewController(configuration: configuration)
            let delegate = PickerDelegate { results in
                self.close(picker) { continuation.resume(returning: results) }
            }

            picker.delegate = delegate
            picker.presentationController?.delegate = delegate
            activeDelegate = delegate
            presenter.present(picker, animated: true)
        }
    }

    @MainActor
    private func openCamera(_ options: CameraOptions) async throws -> [UIImagePickerController.InfoKey: Any]? {
        let presenter = try presenter()

        return await withCheckedContinuation { continuation in
            let camera = UIImagePickerController()
            let delegate = CameraDelegate { taken in
                self.close(camera) { continuation.resume(returning: taken) }
            }

            camera.sourceType = .camera
            camera.mediaTypes = options.mediaTypes
            camera.videoQuality = options.isLowQuality ? .typeLow : .typeHigh
            if options.videoMaxDuration > 0 { camera.videoMaximumDuration = TimeInterval(options.videoMaxDuration) }
            camera.delegate = delegate
            camera.presentationController?.delegate = delegate
            activeDelegate = delegate
            presenter.present(camera, animated: true)
        }
    }

    /// Where to show the picker or the camera: one at a time, as a second would leave the first's call unanswered.
    @MainActor
    private func presenter() throws -> UIViewController {
        guard activeDelegate == nil else {
            throw PluginError(code: "ERR_UNAVAILABLE", message: "The picker or the camera is already open")
        }
        guard let presenter = registry?.topViewController else {
            throw PluginError(code: "ERR_UNAVAILABLE", message: "The app has no screen to show it on")
        }

        return presenter
    }

    /// Answers once it's gone: what the app shows next would fail while it's still leaving.
    @MainActor
    private func close(_ controller: UIViewController, then answer: @escaping () -> Void) {
        let finish = {
            self.activeDelegate = nil
            answer()
        }

        guard controller.presentingViewController != nil else { return finish() }

        controller.dismiss(animated: true, completion: finish)
    }

    /// The asked-for types this device's camera takes: setting one it doesn't (video on a simulator) throws.
    @MainActor
    private static func cameraMediaTypes(_ mediaTypes: String) -> [String] {
        let asked: [UTType] = switch mediaTypes {
        case "images": [.image]
        case "videos": [.movie]
        default: [.image, .movie]
        }
        let available = UIImagePickerController.availableMediaTypes(for: .camera) ?? []

        return asked.map(\.identifier).filter(available.contains)
    }

    private static func cameraPermission() -> [String: Any] {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: permissionResponse(.granted)
        case .notDetermined: permissionResponse(.undetermined)
        default: permissionResponse(.denied)
        }
    }
}

private struct CameraOptions {
    /// Uniform type identifiers.
    let mediaTypes: [String]
    /// In seconds; 0 for no limit.
    let videoMaxDuration: Int
    let isLowQuality: Bool
}

/// Reports once: when the user chooses or cancels, or swipes the picker away.
private final class PickerDelegate: NSObject, PHPickerViewControllerDelegate, UIAdaptivePresentationControllerDelegate {
    private var onFinish: (([PHPickerResult]) -> Void)?

    init(onFinish: @escaping ([PHPickerResult]) -> Void) {
        self.onFinish = onFinish
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        finish(results)
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        finish([])
    }

    private func finish(_ results: [PHPickerResult]) {
        onFinish?(results)
        onFinish = nil
    }
}

/// Reports once: what was taken, or nil when the user cancels or swipes the camera away.
private final class CameraDelegate: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate,
    UIAdaptivePresentationControllerDelegate {
    private var onFinish: (([UIImagePickerController.InfoKey: Any]?) -> Void)?

    init(onFinish: @escaping ([UIImagePickerController.InfoKey: Any]?) -> Void) {
        self.onFinish = onFinish
    }

    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        finish(info)
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        finish(nil)
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        finish(nil)
    }

    private func finish(_ taken: [UIImagePickerController.InfoKey: Any]?) {
        onFinish?(taken)
        onFinish = nil
    }
}

/// A picked or taken photo or video as a file in the app's caches, and what JavaScript gets for it.
private enum MediaFile {
    private static let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("nativue-image-picker", isDirectory: true)
    /// The quality photos from the camera are saved at, as JPEG.
    private static let jpegQuality: CGFloat = 0.9

    /// The picker's file, copied before the provider takes it back; nil for what's neither a photo nor a video.
    static func copy(from provider: NSItemProvider) async throws -> [String: Any]? {
        let isVideo = provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier)
        let type: UTType = isVideo ? .movie : .image
        guard provider.hasItemConformingToTypeIdentifier(type.identifier) else { return nil }

        let file: URL = try await withCheckedThrowingContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, error in
                do {
                    guard let url else { throw error ?? PluginError(code: "ERR_UNAVAILABLE", message: "The picker gave no file") }

                    let copy = try newFile(extension: url.pathExtension)
                    try FileManager.default.copyItem(at: url, to: copy)
                    continuation.resume(returning: copy)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }

        return isVideo ? try await videoDescription(of: file) : try imageDescription(of: file)
    }

    static func save(_ image: UIImage) throws -> [String: Any] {
        guard let data = image.jpegData(compressionQuality: jpegQuality) else {
            throw PluginError(code: "ERR_UNAVAILABLE", message: "The photo couldn't be saved")
        }

        let file = try newFile(extension: "jpg")

        try data.write(to: file)

        return try imageDescription(of: file)
    }

    /// The camera's recording, moved out of the temporary folder the system clears.
    static func saveVideo(at recording: URL) async throws -> [String: Any] {
        let file = try newFile(extension: recording.pathExtension)

        try FileManager.default.moveItem(at: recording, to: file)

        return try await videoDescription(of: file)
    }

    private static func newFile(extension fileExtension: String) throws -> URL {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        return directory.appendingPathComponent(UUID().uuidString).appendingPathExtension(fileExtension)
    }

    /// Its size as shown: EXIF orientations 5 to 8 turn it a quarter.
    private static func imageDescription(of file: URL) throws -> [String: Any] {
        let properties = CGImageSourceCreateWithURL(file as CFURL, nil)
            .flatMap { CGImageSourceCopyPropertiesAtIndex($0, 0, nil) as? [CFString: Any] } ?? [:]
        let width = properties[kCGImagePropertyPixelWidth] as? Int ?? 0
        let height = properties[kCGImagePropertyPixelHeight] as? Int ?? 0
        let isTurned = (5...8).contains(properties[kCGImagePropertyOrientation] as? Int ?? 1)

        return try description(of: file, type: "image", width: isTurned ? height : width, height: isTurned ? width : height)
    }

    private static func videoDescription(of file: URL) async throws -> [String: Any] {
        let asset = AVURLAsset(url: file)
        let track = try await asset.loadTracks(withMediaType: .video).first
        let (naturalSize, transform) = try await track?.load(.naturalSize, .preferredTransform) ?? (.zero, .identity)
        let size = naturalSize.applying(transform)
        var description = try description(of: file, type: "video", width: Int(abs(size.width)), height: Int(abs(size.height)))

        description["duration"] = try await asset.load(.duration).seconds

        return description
    }

    private static func description(of file: URL, type: String, width: Int, height: Int) throws -> [String: Any] {
        let fileSize = try FileManager.default.attributesOfItem(atPath: file.path)[.size] as? Int ?? 0

        return [
            "uri": file.absoluteString,
            "type": type,
            "width": width,
            "height": height,
            "mimeType": UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream",
            "fileSize": fileSize,
        ]
    }
}
