plugins {
    id("com.android.application")
}

android {
    namespace = "dev.nativue.demo"
    compileSdk = 37

    defaultConfig {
        applicationId = "dev.nativue.app"
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
