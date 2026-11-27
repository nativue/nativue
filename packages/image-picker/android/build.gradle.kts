// The Android side of @nativue/image-picker, added to the app by nativue.settings.gradle.kts.
plugins {
    id("com.android.library")
}

android {
    namespace = "dev.nativue.imagepicker"
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
    // FileProvider: the camera writes the photo into a file of the app's.
    implementation("androidx.core:core:1.16.0")
}
