package com.gunakarna.jazzassistant.lostmode

import android.content.Context
import com.gunakarna.jazzassistant.recovery.DeviceLocationManager
import com.gunakarna.jazzassistant.recovery.DeviceStatusManager
import com.gunakarna.jazzassistant.recovery.LostDeviceManager
import com.gunakarna.jazzassistant.recovery.RecoveryCommandExecutor
import com.gunakarna.jazzassistant.recovery.RecoverySecurityManager
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

/**
 * New outbound Lost Mode transport. It never exposes shell/ADB capabilities and
 * delegates approved commands to the existing RecoveryCommandExecutor.
 */
class LostModeNetworkClient(private val context: Context) {
    private val security = LostModeSecurityManager(context)
    private val existingIdentity = RecoverySecurityManager(context)
    private val statusManager = DeviceStatusManager(context)
    private val locationManager = DeviceLocationManager(context)
    private val lostDeviceManager = LostDeviceManager(context)
    private val executor = RecoveryCommandExecutor(context)

    fun isConfigured(): Boolean = security.isConfigured()

    fun syncOnce(): JSONObject {
        if (!isConfigured()) return JSONObject().put("ok", false).put("status", "LOST_MODE_NOT_CONFIGURED")

        val status = statusManager.snapshot()
        if (!status.optBoolean("online", false)) {
            return JSONObject().put("ok", false).put("status", "NO_VALIDATED_INTERNET")
        }

        val heartbeat = JSONObject()
            .put("deviceId", security.deviceId())
            .put("deviceName", existingIdentity.deviceName())
            .put("mode", lostDeviceManager.mode())
            .put("status", status)
        locationManager.cachedLocation()?.let { heartbeat.put("lastKnownLocation", it) }
        request("POST", "/android/device/heartbeat", heartbeat)

        val next = request("GET", "/android/device/commands/next", null)
        val command = next.optJSONObject("command") ?: return JSONObject().put("ok", true).put("status", "HEARTBEAT_SENT")
        val commandId = command.optString("id")
        if (commandId.isBlank()) return JSONObject().put("ok", false).put("status", "INVALID_COMMAND")

        val type = command.optString("type")
        if (type !in setOf("device_status", "device_location", "ring_device", "recovery_photo", "set_recovery_mode")) {
            val rejected = JSONObject().put("ok", false).put("status", "COMMAND_NOT_ALLOWED")
            postResult(commandId, rejected)
            return rejected
        }

        val result = executor.execute(command)
        postResult(commandId, result)
        return JSONObject().put("ok", true).put("status", "COMMAND_EXECUTED").put("commandId", commandId).put("result", result)
    }

    private fun postResult(commandId: String, result: JSONObject) {
        request("POST", "/android/device/commands/$commandId/result", JSONObject().put("deviceId", security.deviceId()).put("result", result))
    }

    private fun request(method: String, path: String, body: JSONObject?): JSONObject {
        val base = security.serverUrl().trimEnd('/')
        require(base.startsWith("https://")) { "Lost Mode server must use HTTPS." }
        val connection = (URL("$base$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 8_000
            readTimeout = 35_000
            doInput = true
            useCaches = false
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Authorization", "Bearer ${security.credential()}")
            setRequestProperty("X-Jazz-Lost-Device-Id", security.deviceId())
            if (method != "GET" && method != "HEAD") doOutput = true
        }
        try {
            if (connection.doOutput) {
                val bytes = (body?.toString() ?: "{}").toByteArray(StandardCharsets.UTF_8)
                connection.outputStream.use { it.write(bytes) }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.use { BufferedReader(InputStreamReader(it, StandardCharsets.UTF_8)).readText() }.orEmpty()
            val json = try { JSONObject(text.ifBlank { "{}" }) } catch (_: Exception) { JSONObject().put("raw", text) }
            if (code !in 200..299) throw IllegalStateException(json.optString("error", "Lost Mode request failed ($code)"))
            return json
        } finally { connection.disconnect() }
    }
}
