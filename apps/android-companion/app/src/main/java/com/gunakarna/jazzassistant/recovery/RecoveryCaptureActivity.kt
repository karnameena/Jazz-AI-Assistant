package com.gunakarna.jazzassistant.recovery

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import java.io.File
import java.io.FileOutputStream

class RecoveryCaptureActivity : ComponentActivity() {
    private lateinit var previewView: PreviewView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Recovery capture may be requested while the device is locked. This does not
        // unlock the phone; it only permits this owner-authorized activity to appear
        // over the keyguard when the OS/OEM allows it.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        previewView = PreviewView(this).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
        setContentView(previewView)
        startCapture(intent.getStringExtra("camera") ?: "front")
    }

    private fun startCapture(camera: String) {
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            try {
                val provider = providerFuture.get()
                val selector = if (camera == "rear") CameraSelector.DEFAULT_BACK_CAMERA else CameraSelector.DEFAULT_FRONT_CAMERA
                val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
                val imageCapture = ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .setJpegQuality(78)
                    .build()
                provider.unbindAll()
                provider.bindToLifecycle(this, selector, preview, imageCapture)

                val dir = File(filesDir, "recovery-photos").apply { mkdirs() }
                val file = File(dir, "recovery-${camera}-${System.currentTimeMillis()}.jpg")
                val options = ImageCapture.OutputFileOptions.Builder(file).build()
                imageCapture.takePicture(
                    options,
                    ContextCompat.getMainExecutor(this),
                    object : ImageCapture.OnImageSavedCallback {
                        override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                            compressIfNeeded(file)
                            RecoveryCameraManager.completeCapture(file, camera)
                            finishAndRemoveTask()
                        }

                        override fun onError(exception: ImageCaptureException) {
                            RecoveryCameraManager.completeCapture(null, camera, exception.message)
                            finishAndRemoveTask()
                        }
                    }
                )
            } catch (e: Exception) {
                RecoveryCameraManager.completeCapture(null, camera, e.message)
                finishAndRemoveTask()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    override fun onDestroy() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onDestroy()
    }

    private fun compressIfNeeded(file: File) {
        if (!file.exists() || file.length() < 700_000) return
        val bitmap = BitmapFactory.decodeFile(file.absolutePath) ?: return
        val maxWidth = 1280
        val target = if (bitmap.width > maxWidth) {
            val height = (bitmap.height * (maxWidth.toFloat() / bitmap.width)).toInt().coerceAtLeast(1)
            Bitmap.createScaledBitmap(bitmap, maxWidth, height, true)
        } else bitmap
        FileOutputStream(file, false).use { target.compress(Bitmap.CompressFormat.JPEG, 72, it) }
        if (target !== bitmap) target.recycle()
        bitmap.recycle()
    }
}
