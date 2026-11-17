import SwiftUI

@main
struct VueNativeApp: App {
    var body: some Scene {
        WindowGroup { VueRoot() }
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
