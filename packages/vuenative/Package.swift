// swift-tools-version: 5.9
import PackageDescription

// The native side of vuenative, consumed by the app's Xcode project as a local package.
let package = Package(
    name: "VueNative",
    platforms: [.iOS(.v17)],
    products: [.library(name: "VueNative", targets: ["VueNative"])],
    dependencies: [.package(url: "https://github.com/facebook/yoga.git", .upToNextMinor(from: "3.2.2"))],
    targets: [
        .target(name: "VueNative", dependencies: [.product(name: "yoga", package: "yoga")], path: "ios"),
    ]
)
