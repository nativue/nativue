plugins {
    id("com.android.application")
}

android {
    namespace = "dev.vuenative.demo"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.vuenative.app"
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
