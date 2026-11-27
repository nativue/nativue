// The Android side of @nativue/svg, added to the app by nativue.settings.gradle.kts.
plugins {
    id("com.android.library")
}

android {
    namespace = "dev.nativue.svg"
    compileSdk = 37

    defaultConfig {
        minSdk = 24
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(project(":nativue"))
}
