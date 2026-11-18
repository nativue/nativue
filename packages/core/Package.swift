// swift-tools-version: 5.9
import PackageDescription

// The native side of nativue, consumed by the app's Xcode project as a local package.
let package = Package(
    name: "Nativue",
    platforms: [.iOS(.v17)],
    products: [.library(name: "Nativue", targets: ["Nativue"])],
    dependencies: [.package(url: "https://github.com/facebook/yoga.git", .upToNextMinor(from: "3.2.2"))],
    targets: [
        .target(name: "Nativue", dependencies: [.product(name: "yoga", package: "yoga")], path: "ios"),
    ]
)
