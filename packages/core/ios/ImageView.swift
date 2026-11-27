import CryptoKit
import UIKit
import yoga

/// Image view behind <Image>. Loads `source` (an http(s) or data: url). With `cache` "disk" (the default),
/// downloads are kept on disk and decoded images in memory; "memory" keeps only the decoded images, so
/// one that comes back on screen (a list row) shows at once; "none" keeps nothing.
final class ImageView: UIImageView {
    static let resizeModes: [String: UIView.ContentMode] = [
        "cover": .scaleAspectFill,
        "contain": .scaleAspectFit,
        "stretch": .scaleToFill,
        "center": .center,
    ]

    /// NSCache also empties itself when memory runs low.
    private static let decodedImages: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.totalCostLimit = 64 * 1024 * 1024

        return cache
    }()

    /// Its own cache only: URLCache would keep a second copy of each download.
    private static let session = URLSession(configuration: {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil

        return configuration
    }())

    /// The image changed, and with it the size the view measures.
    var onImageChange: (() -> Void)?

    /// "disk", "memory" or "none". Read once loading starts, so it applies even when set after `source`.
    var cachePolicy = "disk"

    private var loadingTask: Task<Void, Never>?

    override init(frame: CGRect) {
        super.init(frame: frame)

        contentMode = .scaleAspectFill // resizeMode defaults to "cover"
        clipsToBounds = true
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    func load(_ source: String?) {
        loadingTask?.cancel()

        guard let source, let url = URL(string: source) else { return show(nil) }
        if cachePolicy != "none", let cachedImage = Self.decodedImages.object(forKey: source as NSString) {
            return show(cachedImage)
        }

        show(nil)
        loadingTask = Task { [weak self] in
            guard
                let cachePolicy = self?.cachePolicy,
                let image = await Self.image(for: source, from: url, cachePolicy: cachePolicy),
                !Task.isCancelled,
                let self
            else { return }

            show(image)
        }
    }

    /// An image as <Image> loads it: from memory, the disk cache or its url, then kept as `cachePolicy` says.
    static func image(for source: String, cachePolicy: String = "disk") async -> UIImage? {
        if cachePolicy != "none", let cachedImage = decodedImages.object(forKey: source as NSString) { return cachedImage }
        guard let url = URL(string: source) else { return nil }

        return await image(for: source, from: url, cachePolicy: cachePolicy)
    }

    private static func image(for source: String, from url: URL, cachePolicy: String) async -> UIImage? {
        let cachedData = cachePolicy == "disk" ? await Task.detached { ImageDiskCache.data(for: source) }.value : nil
        let downloadedData = cachedData == nil ? await download(source, from: url) : nil
        guard
            let data = cachedData ?? downloadedData,
            let image = await UIImage(data: data)?.byPreparingForDisplay() // decoded off the main thread
        else { return nil }

        store(image, downloadedData: downloadedData, for: source, cachePolicy: cachePolicy)

        return image
    }

    private static func store(_ image: UIImage, downloadedData: Data?, for source: String, cachePolicy: String) {
        guard cachePolicy != "none" else { return }

        decodedImages.setObject(image, forKey: source as NSString, cost: byteCount(of: image))

        guard cachePolicy == "disk", let downloadedData, !isInMemory(source) else { return }
        Task.detached(priority: .utility) { ImageDiskCache.store(downloadedData, for: source) }
    }

    /// Without a width or height, the image takes its own size, a pixel per point; given one of them, the
    /// other follows its aspect ratio, as on the web.
    func measuredSize(width: Float, widthMode: YGMeasureMode, height: Float, heightMode: YGMeasureMode) -> YGSize {
        let naturalWidth = Float(image?.size.width ?? 0)
        let naturalHeight = Float(image?.size.height ?? 0)
        let maxWidth = widthMode == .undefined ? .infinity : width
        let maxHeight = heightMode == .undefined ? .infinity : height

        if widthMode == .exactly && heightMode == .exactly { return YGSize(width: width, height: height) }
        if naturalWidth == 0 || naturalHeight == 0 {
            return YGSize(width: widthMode == .exactly ? width : 0, height: heightMode == .exactly ? height : 0)
        }

        let aspectRatio = naturalWidth / naturalHeight
        if widthMode == .exactly { return YGSize(width: width, height: min(width / aspectRatio, maxHeight)) }
        if heightMode == .exactly { return YGSize(width: min(height * aspectRatio, maxWidth), height: height) }

        let scale = min(1, maxWidth / naturalWidth, maxHeight / naturalHeight)

        return YGSize(width: naturalWidth * scale, height: naturalHeight * scale)
    }

    private func show(_ nextImage: UIImage?) {
        guard nextImage !== image else { return }

        image = nextImage
        onImageChange?()
    }

    /// A blob: URL's bytes are in the BlobStore; URLSession reads data: URLs itself.
    private static func download(_ source: String, from url: URL) async -> Data? {
        if source.hasPrefix("blob:") { return BlobStore.shared.data(forURL: source) }

        return try? await session.data(from: url).0
    }

    /// data: and blob: images are already on the device: nothing to keep on disk.
    private static func isInMemory(_ source: String) -> Bool {
        source.hasPrefix("data:") || source.hasPrefix("blob:")
    }

    private static func byteCount(of image: UIImage) -> Int {
        guard let cgImage = image.cgImage else { return 0 }

        return cgImage.bytesPerRow * cgImage.height
    }
}

/// An image loaded and cached as <Image> does it: for a package's views.
public func loadImage(_ source: String) async -> UIImage? {
    await ImageView.image(for: source)
}

/// Downloaded images by url, in the system's caches folder, which iOS may empty when storage runs low. Past
/// its limit, the images used least recently go first.
private enum ImageDiskCache {
    static let maxByteCount = 100 * 1024 * 1024

    private static let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("nativue-images", isDirectory: true)

    static func data(for source: String) -> Data? {
        let file = fileURL(for: source)
        guard let data = try? Data(contentsOf: file) else { return nil }

        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: file.path)

        return data
    }

    static func store(_ data: Data, for source: String) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: fileURL(for: source), options: .atomic)
        trim()
    }

    private static func fileURL(for source: String) -> URL {
        let hash = SHA256.hash(data: Data(source.utf8)).map { String(format: "%02x", $0) }.joined()

        return directory.appendingPathComponent(hash)
    }

    private static func trim() {
        let keys: Set<URLResourceKey> = [.contentModificationDateKey, .fileSizeKey]
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: Array(keys)) else { return }

        let entries = files.compactMap { file -> (file: URL, usedAt: Date, size: Int)? in
            guard let values = try? file.resourceValues(forKeys: keys) else { return nil }

            return (file, values.contentModificationDate ?? .distantPast, values.fileSize ?? 0)
        }
        var totalSize = entries.reduce(0) { $0 + $1.size }

        for entry in entries.sorted(by: { $0.usedAt < $1.usedAt }) where totalSize > maxByteCount {
            try? FileManager.default.removeItem(at: entry.file)
            totalSize -= entry.size
        }
    }
}
