import UIKit
import yoga

/// Image view behind <Image>. Loads `source` (an http(s) or data: url) through URLSession, which also
/// gives HTTP caching through URLCache; decoded images are kept in memory, so one that comes back on
/// screen (a list row) shows at once.
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

    /// The image changed, and with it the size the view measures.
    var onImageChange: (() -> Void)?

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
        if let cachedImage = Self.decodedImages.object(forKey: source as NSString) { return show(cachedImage) }

        show(nil)
        loadingTask = Task { [weak self] in
            guard
                let (data, _) = try? await URLSession.shared.data(from: url),
                let image = await UIImage(data: data)?.byPreparingForDisplay(), // decoded off the main thread
                !Task.isCancelled
            else { return }

            Self.decodedImages.setObject(image, forKey: source as NSString, cost: Self.byteCount(of: image))
            self?.show(image)
        }
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

    private static func byteCount(of image: UIImage) -> Int {
        guard let cgImage = image.cgImage else { return 0 }

        return cgImage.bytesPerRow * cgImage.height
    }
}
