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
