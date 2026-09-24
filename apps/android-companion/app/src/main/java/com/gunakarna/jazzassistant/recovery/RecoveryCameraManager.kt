package com.gunakarna.jazzassistant.recovery

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class RecoveryCameraManager(private val context: Context) {
    companion object {
        private val captureLock = Any()
        @Volatile private var captureLatch: CountDownLatch? = null
        @Volatile private var captureResult: JSONObject? = null

        fun completeCapture(file: File?, camera: String, error: String? = null) {
            synchronized(captureLock) {
                captureResult = if (file != null && file.exists()) {
                    JSONObject()
                        .put("ok", true)
                        .put("event", "RECOVERY_PHOTO_CAPTURED")
                        .put("camera", camera)
                        .put("timestamp", System.currentTimeMillis())
                        .put("path", file.absolutePath)
                } else {
                    JSONObject()
                        .put("ok", false)
                        .put("status", "CAMERA_CAPTURE_FAILED")
                        .put("error", error ?: "Camera capture failed")
                }
                captureLatch?.countDown()
            }
        }
    }

    fun capture(camera: String): JSONObject {
        val lens = camera.lowercase().let { if (it == "rear") "rear" else "front" }
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            return blocked(
                "CAMERA_PERMISSION_REQUIRED",
                "Camera permission is unavailable. Open Jazz Android Companion once and grant Camera permission."
            )
        }

        // Do not reject a recovery photo just because the keyguard is locked or the
        // Companion UI is not foreground. RecoveryCaptureActivity is intentionally
        // allowed to appear over the keyguard and attempt CameraX capture while the
        // device remains locked. Android/OEM policy can still deny a background
        // activity/camera start; when that happens the exact failure is returned.
        val latch = CountDownLatch(1)
        synchronized(captureLock) {
            captureLatch = latch
            captureResult = null
        }

        return try {
            val intent = Intent(context, RecoveryCaptureActivity::class.java)
                .addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS or
                        Intent.FLAG_ACTIVITY_NO_HISTORY
                )
                .putExtra("camera", lens)
                .putExtra("recovery", true)
            context.startActivity(intent)

            val finished = latch.await(25, TimeUnit.SECONDS)
            synchronized(captureLock) {
                val result = captureResult
                captureLatch = null
                captureResult = null
                if (!finished || result == null) {
                    blocked(
                        "CAMERA_CAPTURE_TIMEOUT_OR_OS_BLOCKED",
                        "Recovery camera did not complete. Android may have blocked background camera/activity access while locked."
                    )
                } else {
                    result
                }
            }
        } catch (e: Exception) {
            synchronized(captureLock) {
                captureLatch = null
                captureResult = null
            }
            blocked(
                "CAMERA_CAPTURE_OS_BLOCKED",
                e.message ?: "Android blocked the recovery camera start in the current device state."
            )
        }
    }

    private fun blocked(status: String, message: String): JSONObject = JSONObject()
        .put("ok", false)
        .put("status", status)
        .put("message", message)
}
