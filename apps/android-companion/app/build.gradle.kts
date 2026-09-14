plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.gunakarna.jazzassistant"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.gunakarna.jazzassistant"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }
}

kotlin {
    jvmToolchain(21)
}
