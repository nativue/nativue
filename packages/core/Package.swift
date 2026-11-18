// swift-tools-version: 5.9
import PackageDescription

// The native side of nativue, consumed by the app's Xcode project as a local package.
let package = Package(
    name: "Nativue",
    platforms: [.iOS(.v17)],
    products: [.library(name: "Nativue", targets: ["Nativue"])],
    dependencies: [.package(url: "https://github.com/facebook/yoga.git", .upToNextMinor(from: "3.2.2"))],
    targets: [
        .target(
            name: "Nativue",
            dependencies: ["JavaScriptRuntime", .product(name: "yoga", package: "yoga")],
            path: "ios",
            exclude: ["JavaScriptRuntime"]
        ),
        .target(
            name: "JavaScriptRuntime",
            dependencies: ["hermesvm"],
            path: "ios/JavaScriptRuntime",
            exclude: ["vendor/hermes/LICENSE"],
            cxxSettings: [
                .headerSearchPath("vendor"),
                .headerSearchPath("../../android/src/main/cpp/jsi"),
            ]
        ),
        // The iOS slices of hermes-ios (Maven Central), the same Hermes version as hermes-android in
        // android/build.gradle.kts and hermes-compiler in package.json: bytecode only runs on the Hermes
        // that compiled it.
        .binaryTarget(
            name: "hermesvm",
            url: "https://github.com/nativue/nativue/releases/download/hermes-260318099.0.8/hermesvm.xcframework.zip",
            checksum: "9147f0187b5790e6c478cfd3de4de585666fa2af34a67dc8a0e8243ff0ff580d"
        ),
    ],
    cxxLanguageStandard: .cxx20
)
