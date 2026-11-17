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
include(":vuenative")
project(":vuenative").projectDir = file("../../../packages/vuenative/android")
