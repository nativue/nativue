pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "Demo"
include(":app")
include(":nativue")
project(":nativue").projectDir = file("../../../packages/core/android")
// The Android side of the app's packages (see the file)
apply(from = "../../../packages/core/android/nativue.settings.gradle.kts")
