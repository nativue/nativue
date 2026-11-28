// The Android side of @nativue/biometrics, added to the app by nativue.settings.gradle.kts.
plugins {
    id("com.android.library")
}

android {
    namespace = "dev.nativue.biometrics"
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
    // The system's biometric prompt from Android 7 up, which needs NativueActivity to be a FragmentActivity.
    implementation("androidx.biometric:biometric:1.4.0-rc01")
}
