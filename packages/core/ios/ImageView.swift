import UIKit

/// Image view behind <Image>. Loads `source` (an http(s) or data: url) through URLSession, which also
/// gives HTTP caching through URLCache.
// Limitation: No decoded-image cache and no intrinsic size; add an NSCache / measure function if lists of
// images stutter or sizing by hand gets annoying.
final class ImageView: UIImageView {
    static let resizeModes: [String: UIView.ContentMode] = [
        "cover": .scaleAspectFill,
        "contain": .scaleAspectFit,
        "stretch": .scaleToFill,
        "center": .center,
    ]

    private var loadingTask: Task<Void, Never>?

    override init(frame: CGRect) {
        super.init(frame: frame)

        contentMode = .scaleAspectFill // resizeMode defaults to "cover"
        clipsToBounds = true
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    func load(_ urlString: String?) {
        loadingTask?.cancel()
        image = nil

        guard let urlString, let url = URL(string: urlString) else { return }

        loadingTask = Task { [weak self] in
            guard
                let (data, _) = try? await URLSession.shared.data(from: url),
                !Task.isCancelled
            else { return }

            self?.image = UIImage(data: data)
        }
    }
}
