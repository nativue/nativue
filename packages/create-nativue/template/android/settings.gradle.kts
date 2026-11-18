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

rootProject.name = "__DISPLAY_NAME__"
include(":app")
include(":nativue")
project(":nativue").projectDir = file("../node_modules/@nativue/core/android")
// The Android side of the app's packages (see the file)
apply(from = "../node_modules/@nativue/core/android/nativue.settings.gradle.kts")
