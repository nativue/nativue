import SwiftUI

/// The whole app: runs main.bundle.js (or the dev server's bundle) and shows what it renders.
/// It fills the whole screen; <SafeAreaView> opts into the safe area.
public struct NativueView: View {
    private let plugins: [NativuePlugin]

    /// plugins: the native side of the app's packages, `nativuePlugins` from ios/NativuePlugins.
    public init(plugins: [NativuePlugin] = []) {
        self.plugins = plugins
    }

    public var body: some View {
        VueRoot(plugins: plugins)
            .ignoresSafeArea()
            .onOpenURL { url in
                guard !NativueAppDelegate.open(url, plugins: plugins) else { return }

                NotificationCenter.default.post(name: Bridge.openURLNotification, object: url)
            }
    }
}

struct VueRoot: UIViewRepresentable {
    let plugins: [NativuePlugin]

    func makeCoordinator() -> Bridge {
        Bridge(plugins: plugins)
    }

    func makeUIView(context: Context) -> RootView {
        let rootView = RootView()
        context.coordinator.start(rootView: rootView)

        return rootView
    }

    func updateUIView(_ rootView: RootView, context: Context) {}
}

/// Root of the native tree; runs the Yoga layout pass whenever UIKit lays it out.
final class RootView: UIView {
    var onLayoutSubviews: (() -> Void)?
    var onTraitCollectionChange: ((_ previous: UITraitCollection?) -> Void)?
    /// `window` is nil under a full-screen modal: the bridge finds that modal through this one.
    private(set) weak var hostWindow: UIWindow?

    override func layoutSubviews() {
        super.layoutSubviews()
        onLayoutSubviews?()
    }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        onTraitCollectionChange?(previous)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if let window { hostWindow = window }
        #if DEBUG
        becomeFirstResponder()
        #endif
    }

    #if DEBUG
    var onReloadShortcut: (() -> Void)?

    override var canBecomeFirstResponder: Bool { true }

    override var keyCommands: [UIKeyCommand]? {
        [UIKeyCommand(input: "r", modifierFlags: .command, action: #selector(reloadShortcutPressed))]
    }

    @objc private func reloadShortcutPressed() {
        onReloadShortcut?()
    }
    #endif
}
