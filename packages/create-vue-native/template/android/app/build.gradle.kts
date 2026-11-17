plugins {
    id("com.android.application")
}

android {
    namespace = "__BUNDLE_ID__"
    compileSdk = 36

    defaultConfig {
        applicationId = "__BUNDLE_ID__"
        minSdk = 30
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(project(":vuenative"))
}
