import UIKit

/// Development only: a strip at the top of the screen while the app downloads the dev server's bundle.
final class DownloadBanner {
    private var window: UIWindow?
    private let label = UILabel()

    func show(progress: Double) {
        if window == nil { makeWindow() }

        label.text = "Downloading \(Int(progress * 100))%"
    }

    func hide() {
        window?.isHidden = true
        window = nil
    }

    private func makeWindow() {
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }

        let topInset = scene.windows.first?.safeAreaInsets.top ?? 0
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: scene.screen.bounds.width, height: topInset + 24)
        window.windowLevel = .alert + 2
        window.isUserInteractionEnabled = false
        window.backgroundColor = UIColor(red: 0.04, green: 0.07, blue: 0.13, alpha: 1)

        label.frame = CGRect(x: 0, y: topInset, width: window.frame.width, height: 24)
        label.font = .systemFont(ofSize: 12, weight: .semibold)
        label.textColor = UIColor(red: 0.95, green: 0.96, blue: 0.98, alpha: 1)
        label.textAlignment = .center
        window.addSubview(label)

        window.isHidden = false
        self.window = window
    }
}
