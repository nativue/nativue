pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
        maven("https://jitpack.io")
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        maven("https://jitpack.io")
    }
}

rootProject.name = "App"
include(":app")
include(":nativue")
project(":nativue").projectDir = file("__CORE_PATH__/android")
// The Android side of the app's packages (see the file)
apply(from = "__CORE_PATH__/android/nativue.settings.gradle.kts")
