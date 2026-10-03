package com.gunakarna.jazzassistant.recovery

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Size
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import java.io.File

class RecoveryCaptureActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val camera = intent.getStringExtra("camera") ?: "front"
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            RecoveryCameraManager.completeCapture(
                null,
                camera,
                "Camera permission is not granted. Open Jazz Android Companion and allow Camera permission."
            )
            finishAndRemoveTask()
            return
        }

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
        startCapture(camera)
    }

    private fun startCapture(camera: String) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            RecoveryCameraManager.completeCapture(null, camera, "Camera permission was revoked before capture started.")
            finishAndRemoveTask()
            return
        }

        val providerFuture = try {
            ProcessCameraProvider.getInstance(this)
        } catch (e: Exception) {
            RecoveryCameraManager.completeCapture(null, camera, e.message ?: "Camera provider is unavailable.")
            finishAndRemoveTask()
            return
        }

        providerFuture.addListener({
            try {
                if (isFinishing || isDestroyed) return@addListener
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    RecoveryCameraManager.completeCapture(null, camera, "Camera permission is unavailable.")
                    finishAndRemoveTask()
                    return@addListener
                }

                val provider = providerFuture.get()
                val selector = if (camera == "rear") CameraSelector.DEFAULT_BACK_CAMERA else CameraSelector.DEFAULT_FRONT_CAMERA
                if (!provider.hasCamera(selector)) {
                    RecoveryCameraManager.completeCapture(null, camera, "Requested $camera camera is not available on this device.")
                    finishAndRemoveTask()
                    return@addListener
                }

                // Recovery evidence does not need a preview surface. Binding only
                // ImageCapture removes PreviewView/surface startup from the critical
                // path and noticeably shortens capture time on many devices.
                val imageCapture = ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .setJpegQuality(72)
                    .setTargetResolution(Size(1280, 960))
                    .build()

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
                            RecoveryCameraManager.completeCapture(file, camera)
                            if (!isFinishing) finishAndRemoveTask()
                        }

                        override fun onError(exception: ImageCaptureException) {
                            RecoveryCameraManager.completeCapture(null, camera, exception.message ?: "Camera capture failed.")
                            if (!isFinishing) finishAndRemoveTask()
                        }
                    }
                )
            } catch (e: SecurityException) {
                RecoveryCameraManager.completeCapture(null, camera, "Camera permission/security policy blocked recovery capture: ${e.message}")
                if (!isFinishing) finishAndRemoveTask()
            } catch (e: Exception) {
                RecoveryCameraManager.completeCapture(null, camera, e.message ?: "Camera initialization failed.")
                if (!isFinishing) finishAndRemoveTask()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    override fun onDestroy() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onDestroy()
    }
}
