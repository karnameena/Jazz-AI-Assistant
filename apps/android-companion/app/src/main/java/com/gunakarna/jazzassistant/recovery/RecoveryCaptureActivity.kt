package com.gunakarna.jazzassistant.recovery

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors

class RecoveryCaptureActivity : ComponentActivity() {
    private val processingExecutor = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep the owner-authorized capture visibly indicated. The screen does not
        // unlock the phone or bypass Android camera permission / OS restrictions.
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

        val camera = intent.getStringExtra("camera") ?: "front"
        val cameraLabel = if (camera == "rear") "Back" else "Front"
        setContentView(TextView(this).apply {
            text = "Jazz Recovery\n\nCapturing photo with the $cameraLabel camera…"
            textSize = 18f
            gravity = Gravity.CENTER
            setPadding(28, 28, 28, 28)
            setTextColor(android.graphics.Color.WHITE)
            setBackgroundColor(android.graphics.Color.rgb(10, 15, 32))
        })
        startCapture(camera)
    }

    private fun startCapture(camera: String) {
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            try {
                val provider = providerFuture.get()
                val selector = if (camera == "rear") CameraSelector.DEFAULT_BACK_CAMERA else CameraSelector.DEFAULT_FRONT_CAMERA
                val imageCapture = ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .setJpegQuality(78)
                    .build()

                // A remote recovery still photo does not need a live preview stream.
                // Binding only ImageCapture reduces camera startup work and avoids
                // waiting for a PreviewView surface before taking the requested photo.
                provider.unbindAll()
                provider.bindToLifecycle(this, selector, imageCapture)

                val dir = File(filesDir, "recovery-photos").apply { mkdirs() }
                val file = File(dir, "recovery-${camera}-${System.currentTimeMillis()}.jpg")
                val options = ImageCapture.OutputFileOptions.Builder(file).build()
                imageCapture.takePicture(
                    options,
                    ContextCompat.getMainExecutor(this),
                    object : ImageCapture.OnImageSavedCallback {
                        override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                            processingExecutor.execute {
                                try {
                                    compressIfNeeded(file)
                                    RecoveryCameraManager.completeCapture(file, camera)
                                } catch (e: Exception) {
                                    RecoveryCameraManager.completeCapture(null, camera, e.message)
                                } finally {
                                    runOnUiThread { finishAndRemoveTask() }
                                }
                            }
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
        processingExecutor.shutdownNow()
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
