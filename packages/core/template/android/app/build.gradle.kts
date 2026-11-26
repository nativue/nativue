plugins {
    id("com.android.application")
}

android {
    namespace = "__ANDROID_PACKAGE__"
    compileSdk = 37

    defaultConfig {
        applicationId = "__ANDROID_PACKAGE__"
        minSdk = 24
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
    implementation(project(":nativue"))
}
