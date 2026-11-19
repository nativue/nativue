// The Android side of @nativue/sqlite, added to the app by nativue.settings.gradle.kts.
plugins {
    id("com.android.library")
}

android {
    namespace = "dev.nativue.sqlite"
    compileSdk = 37

    defaultConfig {
        minSdk = 24
        // Built against 37, but apps still on 35 or 36 build with it: none of its code needs 37.
        aarMetadata { minCompileSdk = 35 }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(project(":nativue"))
}
