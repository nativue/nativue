// The Android side of @nativue/notifications, added to the app by nativue.settings.gradle.kts.
plugins {
    id("com.android.library")
}

android {
    namespace = "dev.nativue.notifications"
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
    implementation("androidx.core:core:1.16.0")
    // Whether the app is in front when a notification fires.
    implementation("androidx.lifecycle:lifecycle-process:2.11.1")
}
