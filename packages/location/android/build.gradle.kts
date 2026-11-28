// The Android side of @nativue/location, added to the app by nativue.settings.gradle.kts.
plugins {
    id("com.android.library")
}

android {
    namespace = "dev.nativue.location"
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
    // The fused location provider, and the dialog that turns location on. Devices without Google Play
    // services use the system's LocationManager.
    implementation("com.google.android.gms:play-services-location:21.4.0")
}
