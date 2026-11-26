plugins {
    id("com.android.application")
    id("com.google.gms.google-services")
}

// Release signing's passwords: a Gradle property (~/.gradle/gradle.properties, which Android Studio
// reads too) or an environment variable (CI). Debug builds don't need them.
fun secret(name: String): String? =
    providers.gradleProperty(name).orElse(providers.environmentVariable(name)).orNull

val missingSigningSecrets = listOf("ANDROID_STORE_PASSWORD", "ANDROID_KEY_PASSWORD").filter { secret(it) == null }

// Stops before building, with the names; any other release build fails at signing.
if (missingSigningSecrets.isNotEmpty() && gradle.startParameter.taskNames.any { it.contains("Release") }) {
    throw GradleException(
        "A release build is signed with ./credentials/upload.keystore, and needs " +
            missingSigningSecrets.joinToString() +
            ": set them as environment variables, or in ~/.gradle/gradle.properties.",
    )
}

android {
    namespace = "com.example.tomsapp"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.example.tomsapp"
        minSdk = 24
        targetSdk = 36
        versionCode = 12
        versionName = "1.2.0"
        manifestPlaceholders["appAuthRedirectScheme"] = "tomsapp"
    }

    signingConfigs {
        create("release") {
            storeFile = file("../../credentials/upload.keystore")
            storePassword = secret("ANDROID_STORE_PASSWORD")
            keyAlias = "upload"
            keyPassword = secret("ANDROID_KEY_PASSWORD")
        }
    }

    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(project(":nativue"))
    implementation("com.google.firebase:firebase-messaging:24.1.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
