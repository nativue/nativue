// The vuenative Android library: Hermes runs the bundle, Yoga lays out the native views.
plugins {
    id("com.android.library")
}

android {
    namespace = "dev.vuenative"
    compileSdk = 36
    ndkVersion = "27.1.12297006"

    defaultConfig {
        // ponytail: 30 for the WindowInsets.Type API (safe area, keyboard); lower it with the compat insets if needed.
        minSdk = 30
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
    // Same version as the vendored JSI headers in src/main/cpp/jsi.
    implementation("com.facebook.hermes:hermes-android:260318099.0.8")
    implementation("com.facebook.yoga:yoga:3.2.1")
    implementation("com.facebook.soloader:soloader:0.10.5")
}
