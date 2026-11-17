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
        let root = UIStackView()
        root.axis = .vertical
        root.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(root)
        NSLayoutConstraint.activate([
            root.topAnchor.constraint(equalTo: container.topAnchor),
            root.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: container.trailingAnchor),
        ])
        context.coordinator.start(root: root)
        return container
    }

    func updateUIView(_ uiView: UIView, context: Context) {}
}
