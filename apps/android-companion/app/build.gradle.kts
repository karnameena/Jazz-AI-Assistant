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
        versionCode = 7
        versionName = "0.6.1-adb-location"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

// Use the full-size, checked-in Jazz branding image. The previous
// src/main/jazz-icon.base64 data was truncated and produced an invalid JPEG
// that Android could not display as the launcher icon.
val jazzIconSource = layout.projectDirectory.file("../jazz-icon.png")
val generatedJazzIconRes = layout.buildDirectory.dir("generated/jazzIcon/res")
val generateJazzIcon by tasks.registering {
    inputs.file(jazzIconSource)
    outputs.dir(generatedJazzIconRes)
    doLast {
        val drawableDir = generatedJazzIconRes.get().dir("drawable-nodpi").asFile
        drawableDir.mkdirs()
        val source = jazzIconSource.asFile
        val header = source.inputStream().use { it.readNBytes(8) }
        val pngSignature = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
        check(header.contentEquals(pngSignature)) { "The checked-in Jazz launcher icon must be a valid PNG." }
        // Remove corrupt output from earlier incremental builds before copying.
        drawableDir.resolve("jazz_icon.jpg").delete()
        source.copyTo(drawableDir.resolve("jazz_icon.png"), overwrite = true)
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
