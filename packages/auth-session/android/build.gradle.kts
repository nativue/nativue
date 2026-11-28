// The Android side of @nativue/auth-session, added to the app by nativue.settings.gradle.kts.
plugins {
    id("com.android.library")
}

android {
    namespace = "dev.nativue.authsession"
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
    // Custom Tabs: the user's browser, with its sign-ins, inside the app.
    implementation("androidx.browser:browser:1.10.0")
}
