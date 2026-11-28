import Nativue
import UIKit

/// Share (src/index.ts): the system's share sheet, which says whether the user shared and where.
public final class SharePlugin: NativuePlugin {
    private weak var registry: PluginRegistry?
    /// On the main thread: one sheet at a time, as a second would leave the first's call unanswered.
    private var isSharing = false

    public init() {}

    public func register(in registry: PluginRegistry) {
        self.registry = registry

        registry.addAsyncFunction("share.share") { [unowned self] arguments in
            try await share(arguments[0] as! [String: Any])
        }
    }

    @MainActor
    private func share(_ content: [String: Any]) async throws -> Any? {
        guard !isSharing else {
            throw PluginError(code: "ERR_UNAVAILABLE", message: "The share sheet is already open")
        }
        guard let presenter = registry?.topViewController else {
            throw PluginError(code: "ERR_UNAVAILABLE", message: "The app has no screen to show the share sheet on")
        }

        // UIKit silently drops a presentation over a screen still coming or going: the sheet would never show.
        guard !presenter.isBeingPresented, !presenter.isBeingDismissed else {
            throw PluginError(code: "ERR_UNAVAILABLE", message: "The share sheet can't open while the screen is changing")
        }

        let items = try activityItems(content)

        isSharing = true

        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Any?, Error>) in
            let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
            var hasAnswered = false
            let answer = { [weak self] (result: Result<Any?, Error>) in
                guard !hasAnswered else { return }

                hasAnswered = true
                self?.isSharing = false
                continuation.resume(with: result)
            }

            // Called when the sheet goes away, shared or not. An app chosen and then backed out of isn't the answer.
            sheet.completionWithItemsHandler = { activityType, completed, _, _ in
                let app: Any = completed ? activityType?.rawValue ?? NSNull() : NSNull()

                answer(.success(["completed": completed, "app": app]))
            }
            // On iPad it's a popover, which points at something: the middle of the screen, with no arrow.
            if let popover = sheet.popoverPresentationController {
                popover.sourceView = presenter.view
                popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }
            presenter.present(sheet, animated: true)
        }
    }

    /// The text, the link or else the first file carries the subject, which Mail takes; files go as their URLs,
    /// for a preview.
    private func activityItems(_ content: [String: Any]) throws -> [Any] {
        let subject = content["subject"] as? String ?? ""
        var items: [Any] = []

        if let text = content["text"] as? String, !text.isEmpty {
            items.append(SharedItem(text, subject: subject))
        }
        if let link = content["url"] as? String, !link.isEmpty {
            guard let url = URL(string: link) else {
                throw PluginError(code: "ERR_INVALID_ARGUMENT", message: "\(link) isn't a URL")
            }

            items.append(SharedItem(url, subject: subject))
        }
        for uri in content["files"] as? [String] ?? [] {
            let file = try fileURL(uri)

            items.append(items.isEmpty && !subject.isEmpty ? SharedItem(file, subject: subject) : file)
        }

        return items
    }

    private func fileURL(_ uri: String) throws -> URL {
        let path = String(uri.dropFirst("file://".count))
        let url = URL(fileURLWithPath: path.removingPercentEncoding ?? path)

        var isDirectory: ObjCBool = false

        // A file, as Android shares: not a directory.
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), !isDirectory.boolValue else {
            throw PluginError(code: "ERR_NOT_FOUND", message: "\(url.path) doesn't exist")
        }

        return url
    }
}

/// Text or a link, with the subject apps like Mail ask for.
private final class SharedItem: NSObject, UIActivityItemSource {
    private let item: Any
    private let subject: String

    init(_ item: Any, subject: String) {
        self.item = item
        self.subject = subject
    }

    func activityViewControllerPlaceholderItem(_ activityViewController: UIActivityViewController) -> Any {
        item
    }

    func activityViewController(_ activityViewController: UIActivityViewController,
                                itemForActivityType activityType: UIActivity.ActivityType?) -> Any? {
        item
    }

    func activityViewController(_ activityViewController: UIActivityViewController,
                                subjectForActivityType activityType: UIActivity.ActivityType?) -> String {
        subject
    }
}
