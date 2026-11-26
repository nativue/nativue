plugins {
    id("com.android.application")
}

android {
    namespace = "com.example.tomsapp"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.example.tomsapp"
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
