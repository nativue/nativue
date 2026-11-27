import UIKit

/// The icons of tab bars and headers: an SF Symbol (`systemImage`), an image (`image`, a url), or one a
/// package draws (`drawnIcon`, registered with PluginRegistry.addIconDrawer). Tinted by what shows them.
enum NavigationIcons {
    static var drawersByName: [String: PluginRegistry.DrawIcon] = [:]
    /// The url each item (a tab, a header button) shows last: a slower load of an earlier one is dropped.
    private static let sourcesByOwner = NSMapTable<AnyObject, NSString>.weakToStrongObjects()

    /// The icon now, or nil with `update` called (on the main thread) once an image loads, if `owner` still
    /// shows that image then.
    static func image(
        _ item: [String: Any], size: CGFloat, for owner: AnyObject, update: @escaping (UIImage) -> Void
    ) -> UIImage? {
        sourcesByOwner.setObject((item["image"] as? String) as NSString?, forKey: owner)
        if let name = item["systemImage"] as? String { return UIImage(systemName: name) }
        if let source = item["image"] as? String {
            Task { @MainActor [weak owner] in
                guard
                    let image = await loadImage(source),
                    let owner,
                    sourcesByOwner.object(forKey: owner) as String? == source
                else { return }

                update(fitted(image, size: size))
            }

            return nil
        }
        guard
            let icon = item["drawnIcon"] as? [String: Any],
            let drawer = icon["drawer"] as? String,
            let draw = drawersByName[drawer]
        else { return nil }

        return draw(icon, size)?.withRenderingMode(.alwaysTemplate)
    }

    /// Scaled to fit a square of `size` points, as the bar expects.
    private static func fitted(_ image: UIImage, size: CGFloat) -> UIImage {
        let scale = min(size / max(image.size.width, 1), size / max(image.size.height, 1))
        let fittedSize = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let fittedImage = UIGraphicsImageRenderer(size: fittedSize).image { _ in
            image.draw(in: CGRect(origin: .zero, size: fittedSize))
        }

        return fittedImage.withRenderingMode(.alwaysTemplate)
    }
}
