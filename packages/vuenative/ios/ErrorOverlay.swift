import UIKit

/// Development only: shows a JS error over the whole app, modals included, in a window of its own. The
/// first error stays until it's dismissed or the bundle reloads, since later ones are usually its
/// consequences.
final class ErrorOverlay {
    private var window: UIWindow?

    func show(message: String, details: String, onReload: @escaping () -> Void) {
        guard window == nil, let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }

        let window = UIWindow(windowScene: scene)
        window.windowLevel = .alert + 1
        window.rootViewController = ErrorViewController(
            message: message,
            details: details,
            onDismiss: { [unowned self] in hide() },
            onReload: { [unowned self] in
                hide()
                onReload()
            }
        )
        window.isHidden = false
        self.window = window
    }

    func hide() {
        window?.isHidden = true
        window = nil
    }
}

private final class ErrorViewController: UIViewController {
    private let message: String
    private let details: String
    private let onDismiss: () -> Void
    private let onReload: () -> Void

    init(message: String, details: String, onDismiss: @escaping () -> Void, onReload: @escaping () -> Void) {
        self.message = message
        self.details = details
        self.onDismiss = onDismiss
        self.onReload = onReload
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()

        view.backgroundColor = UIColor(red: 0.55, green: 0.09, blue: 0.12, alpha: 1)

        let header = UIStackView(arrangedSubviews: [
            label("UNCAUGHT ERROR", font: .systemFont(ofSize: 13, weight: .bold), alpha: 0.7),
            label(message, font: .systemFont(ofSize: 22, weight: .bold), alpha: 1),
        ])
        header.axis = .vertical
        header.spacing = 8

        let buttons = UIStackView(arrangedSubviews: [
            button("Dismiss", isPrimary: false, action: onDismiss),
            button("Reload", isPrimary: true, action: onReload),
        ])
        buttons.distribution = .fillEqually
        buttons.spacing = 12

        let content = UIStackView(arrangedSubviews: [header, detailsView(), buttons])
        content.axis = .vertical
        content.spacing = 20
        content.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(content)

        let margins = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: margins.topAnchor, constant: 24),
            content.bottomAnchor.constraint(equalTo: margins.bottomAnchor, constant: -16),
            content.leadingAnchor.constraint(equalTo: margins.leadingAnchor, constant: 20),
            content.trailingAnchor.constraint(equalTo: margins.trailingAnchor, constant: -20),
        ])
    }

    private func label(_ text: String, font: UIFont, alpha: CGFloat) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = font
        label.textColor = .white.withAlphaComponent(alpha)
        label.numberOfLines = 0

        return label
    }

    /// Where it happened and the stack: monospaced, scrollable and selectable, to copy into a search.
    private func detailsView() -> UITextView {
        let textView = UITextView()
        textView.text = details
        textView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        textView.textColor = .white.withAlphaComponent(0.85)
        textView.backgroundColor = .black.withAlphaComponent(0.25)
        textView.layer.cornerRadius = 12
        textView.textContainerInset = UIEdgeInsets(top: 12, left: 8, bottom: 12, right: 8)
        textView.isEditable = false

        return textView
    }

    /// Primary: solid white. Otherwise: translucent white.
    private func button(_ title: String, isPrimary: Bool, action: @escaping () -> Void) -> UIButton {
        var configuration: UIButton.Configuration = isPrimary ? .filled() : .tinted()
        configuration.title = title
        configuration.baseForegroundColor = isPrimary ? view.backgroundColor : .white
        configuration.baseBackgroundColor = .white
        configuration.cornerStyle = .large
        configuration.buttonSize = .large

        return UIButton(configuration: configuration, primaryAction: UIAction { _ in action() })
    }
}
