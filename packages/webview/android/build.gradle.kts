// The Android side of @nativue/webview, added to the app by nativue.settings.gradle.kts.
plugins {
    id("com.android.library")
}

android {
    namespace = "dev.nativue.webview"
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
    // Scripts that run before the page's own: WebViewCompat.addDocumentStartJavaScript.
    implementation("androidx.webkit:webkit:1.18.0")
}
