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
