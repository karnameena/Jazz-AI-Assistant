package com.gunakarna.jazzassistant.recovery

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.io.File

class RecoveryCommandExecutor(private val context: Context) {
    private val statusManager = DeviceStatusManager(context)
    private val locationManager = DeviceLocationManager(context)
    private val lostDeviceManager = LostDeviceManager(context)
    private val ringManager = RecoveryRingManager(context)
    private val cameraManager = RecoveryCameraManager(context)
    private val securityManager = RecoverySecurityManager(context)

    fun execute(command: JSONObject): JSONObject {
        val type = command.optString("type")
        val args = command.optJSONObject("args") ?: JSONObject()
        return when (type) {
            "device_status" -> JSONObject()
                .put("ok", true)
                .put("deviceId", securityManager.deviceId())
                .put("deviceName", securityManager.deviceName())
                .put("mode", lostDeviceManager.mode())
                .put("status", statusManager.snapshot())
                .also { locationManager.cachedLocation()?.let { cached -> it.put("lastKnownLocation", cached) } }
            "device_location" -> locationManager.currentLocation()
                .put("deviceId", securityManager.deviceId())
                .put("deviceName", securityManager.deviceName())
                .put("statusSnapshot", statusManager.snapshot())
            "ring_device" -> ringManager.ring(args.optLong("durationMs", 30_000L))
            "set_recovery_mode" -> {
                val enabled = args.optBoolean("enabled", true)
                lostDeviceManager.setEnabled(enabled)
                JSONObject()
                    .put("ok", true)
                    .put("mode", lostDeviceManager.mode())
                    .put("message", if (enabled) "Lost Device Mode enabled." else "Lost Device Mode disabled.")
            }
            "recovery_photo" -> {
                val camera = args.optString("camera", "front")
                val result = cameraManager.capture(camera)
                if (result.optBoolean("ok")) {
                    val file = File(result.optString("path"))
                    if (file.exists()) {
                        val encoded = Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)
                        result
                            .remove("path")
                            .let { result.put("mimeType", "image/jpeg").put("imageBase64", encoded) }
                    }
                }
                result
                    .put("deviceId", securityManager.deviceId())
                    .put("deviceName", securityManager.deviceName())
            }
            else -> JSONObject()
                .put("ok", false)
                .put("status", "UNKNOWN_RECOVERY_COMMAND")
                .put("error", "Unknown recovery command: $type")
        }
    }
}
