import SwiftUI

@main
struct VueNativeApp: App {
    var body: some Scene {
        WindowGroup { VueRoot() }
    }
}

struct VueRoot: UIViewRepresentable {
    func makeCoordinator() -> Bridge { Bridge() }

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        let rootView = UIStackView()
        rootView.axis = .vertical
        rootView.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(rootView)
        NSLayoutConstraint.activate([
            rootView.topAnchor.constraint(equalTo: container.topAnchor),
            rootView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            rootView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
        ])
        context.coordinator.start(rootView: rootView)
        return container
    }

    func updateUIView(_ uiView: UIView, context: Context) {}
}
