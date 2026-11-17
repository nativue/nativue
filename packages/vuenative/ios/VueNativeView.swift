import SwiftUI

/// The whole app: runs main.bundle.js (or the dev server's bundle) and shows what it renders.
/// It fills the whole screen; <SafeAreaView> opts into the safe area.
public struct VueNativeView: View {
    public init() {}

    public var body: some View {
        VueRoot()
            .ignoresSafeArea()
            .onOpenURL { url in NotificationCenter.default.post(name: Bridge.openURLNotification, object: url) }
    }
}

struct VueRoot: UIViewRepresentable {
    func makeCoordinator() -> Bridge {
        Bridge()
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

    override func layoutSubviews() {
        super.layoutSubviews()
        onLayoutSubviews?()
    }
}
