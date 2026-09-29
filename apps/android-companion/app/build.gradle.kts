import java.util.Base64

plugins {
    id("com.android.application")
}

android {
    namespace = "com.gunakarna.jazzassistant"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.gunakarna.jazzassistant"
        minSdk = 26
        targetSdk = 34
        versionCode = 4
        versionName = "0.4.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

val jazzIconSource = layout.projectDirectory.file("src/main/jazz-icon.base64")
val generatedJazzIconRes = layout.buildDirectory.dir("generated/jazzIcon/res")
val generateJazzIcon by tasks.registering {
    inputs.file(jazzIconSource)
    outputs.dir(generatedJazzIconRes)
    doLast {
        val drawableDir = generatedJazzIconRes.get().dir("drawable-nodpi").asFile
        drawableDir.mkdirs()
        val encoded = jazzIconSource.asFile.readText().filterNot(Char::isWhitespace)
        drawableDir.resolve("jazz_icon.jpg").writeBytes(Base64.getDecoder().decode(encoded))
    }
}

android.sourceSets.getByName("main").res.srcDir(generatedJazzIconRes)
tasks.named("preBuild").configure { dependsOn(generateJazzIcon) }

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.1")
    implementation("androidx.lifecycle:lifecycle-process:2.8.4")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("androidx.camera:camera-core:1.3.4")
    implementation("androidx.camera:camera-camera2:1.3.4")
    implementation("androidx.camera:camera-lifecycle:1.3.4")
    implementation("androidx.camera:camera-view:1.3.4")
}
