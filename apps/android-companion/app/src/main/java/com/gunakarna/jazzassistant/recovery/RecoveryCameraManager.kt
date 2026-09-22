package com.gunakarna.jazzassistant.recovery

import android.Manifest
import android.app.ActivityManager
import android.app.KeyguardManager
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
            return blocked("CAMERA_PERMISSION_REQUIRED", "Camera permission has not been granted.")
        }
        val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        if (keyguard.isKeyguardLocked) {
            return blocked("CAMERA_CAPTURE_BLOCKED_BY_ANDROID", "Android blocks recovery camera capture while the device is locked.")
        }
        if (!isAppForeground()) {
            return blocked("CAMERA_CAPTURE_BLOCKED_BY_ANDROID", "Android currently prevents camera access because Jazz Android Companion is not in the foreground.")
        }

        val latch = CountDownLatch(1)
        synchronized(captureLock) {
            captureLatch = latch
            captureResult = null
        }

        return try {
            val intent = Intent(context, RecoveryCaptureActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra("camera", lens)
            context.startActivity(intent)
            val finished = latch.await(25, TimeUnit.SECONDS)
            synchronized(captureLock) {
                val result = captureResult
                captureLatch = null
                captureResult = null
                if (!finished || result == null) {
                    blocked("CAMERA_CAPTURE_TIMEOUT", "Camera capture did not finish in time.")
                } else {
                    result
                }
            }
        } catch (e: Exception) {
            synchronized(captureLock) {
                captureLatch = null
                captureResult = null
            }
            blocked("CAMERA_CAPTURE_FAILED", e.message ?: "Camera capture failed")
        }
    }

    private fun isAppForeground(): Boolean {
        val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val process = ActivityManager.RunningAppProcessInfo()
        ActivityManager.getMyMemoryState(process)
        return process.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND ||
            process.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE
    }

    private fun blocked(status: String, message: String): JSONObject = JSONObject()
        .put("ok", false)
        .put("status", status)
        .put("message", message)
}
