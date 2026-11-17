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
include(":vuenative")
project(":vuenative").projectDir = file("../node_modules/vuenative/android")
