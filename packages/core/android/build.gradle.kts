// The nativue Android library: Hermes runs the bundle, Yoga lays out the native views.
import java.net.Inet4Address
import java.net.NetworkInterface

plugins {
    id("com.android.library")
}

/**
 * This computer's address on the local network (Wi-Fi or Ethernet first), for a physical device to
 * reach the dev server.
 */
// Limitation: Fixed at build time, like the iOS app's host; rebuild after switching networks.
fun localNetworkAddress(): String? = NetworkInterface.getNetworkInterfaces().toList()
    .filter { it.isUp && !it.isLoopback && !it.isVirtual }
    .sortedBy { if (it.name.startsWith("en") || it.name.startsWith("eth") || it.name.startsWith("wlan")) 0 else 1 }
    .flatMap { it.inetAddresses.toList() }
    .firstOrNull { it is Inet4Address && it.isSiteLocalAddress }
    ?.hostAddress

android {
    namespace = "dev.nativue"
    compileSdk = 37
    ndkVersion = "27.1.12297006"

    defaultConfig {
        // Hermes's own minimum.
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")

        externalNativeBuild {
            cmake {
                arguments += "-DANDROID_STL=c++_shared"
                cppFlags += listOf("-std=c++20", "-fexceptions", "-frtti")
            }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    buildFeatures {
        prefab = true
        resValues = true
    }

    buildTypes {
        debug {
            localNetworkAddress()?.let { resValue("string", "nativue_dev_server_host", it) }
        }
    }

    // The Hermes package already ships these; apps get them from there.
    packaging {
        jniLibs.excludes += listOf("**/libhermesvm.so", "**/libc++_shared.so")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // Same version as the vendored JSI headers in src/main/cpp/jsi, hermes-compiler in package.json
    // and hermesvm in Package.swift: bytecode only runs on the Hermes that compiled it.
    implementation("com.facebook.hermes:hermes-android:260318099.0.8")
    implementation("com.facebook.yoga:yoga:3.2.1")
    implementation("com.facebook.soloader:soloader:0.10.5")
    // Insets, system bars, fonts and accessibility the same way down to minSdk.
    implementation("androidx.core:core:1.16.0")
}
