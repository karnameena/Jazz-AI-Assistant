package com.gunakarna.jazzassistant.recovery

import android.content.Context
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.nio.charset.StandardCharsets

class RecoveryNetworkClient(private val context: Context) {
    private val security = RecoverySecurityManager(context)
    private val statusManager = DeviceStatusManager(context)
    private val locationManager = DeviceLocationManager(context)
    private val executor = RecoveryCommandExecutor(context)
    private val lostDeviceManager = LostDeviceManager(context)

    fun isConfigured(): Boolean = security.serverUrl().isNotBlank()

    fun syncOnce(): JSONObject {
        if (!isConfigured()) {
            return JSONObject()
                .put("ok", false)
                .put("status", "RECOVERY_SERVER_NOT_CONFIGURED")
        }

        val deviceStatus = statusManager.snapshot()
        if (!deviceStatus.optBoolean("online", false)) {
            return JSONObject()
                .put("ok", false)
                .put("status", "NO_VALIDATED_INTERNET")
                .put("network", deviceStatus.optString("network", "OFFLINE"))
                .put("message", "Phone has no validated internet connection. Recovery will retry automatically when Wi-Fi or mobile data becomes available.")
        }

        return retryNetwork("recovery sync") {
            val heartbeat = JSONObject()
                .put("deviceId", security.deviceId())
                .put("deviceName", security.deviceName())
                .put("mode", lostDeviceManager.mode())
                .put("status", deviceStatus)
            locationManager.cachedLocation()?.let { heartbeat.put("lastKnownLocation", it) }
            request("POST", "/android/device/heartbeat", heartbeat)

            val next = request(
                "GET",
                "/android/device/commands/next?deviceId=${encode(security.deviceId())}",
                null
            )
            val command = next.optJSONObject("command") ?: return@retryNetwork JSONObject()
                .put("ok", true)
                .put("status", "HEARTBEAT_SENT")
                .put("network", deviceStatus.optString("network", "UNKNOWN"))

            val commandId = command.optString("id")
            if (commandId.isBlank()) {
                return@retryNetwork JSONObject().put("ok", false).put("status", "INVALID_COMMAND")
            }

            val result = executor.execute(command)
            val resultBody = JSONObject()
                .put("deviceId", security.deviceId())
                .put("result", result)
            request("POST", "/android/device/commands/$commandId/result", resultBody)
            JSONObject()
                .put("ok", true)
                .put("status", "COMMAND_EXECUTED")
                .put("network", deviceStatus.optString("network", "UNKNOWN"))
                .put("commandId", commandId)
                .put("result", result)
        }
    }

    private fun retryNetwork(label: String, block: () -> JSONObject): JSONObject {
        var last: Exception? = null
        repeat(3) { attempt ->
            try {
                return block()
            } catch (e: Exception) {
                last = e
                if (!isTransientNetworkFailure(e) || attempt == 2) throw e
                try { Thread.sleep(700L * (attempt + 1)) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
            }
        }
        throw IllegalStateException("$label failed: ${last?.message ?: "network unavailable"}")
    }

    private fun isTransientNetworkFailure(error: Exception): Boolean =
        error is SocketTimeoutException ||
            error is UnknownHostException ||
            error.cause is SocketTimeoutException ||
            error.cause is UnknownHostException ||
            error.message?.contains("timed out", ignoreCase = true) == true ||
            error.message?.contains("network", ignoreCase = true) == true ||
            error.message?.contains("connection", ignoreCase = true) == true

    private fun request(method: String, path: String, body: JSONObject?): JSONObject {
        val base = security.serverUrl().trimEnd('/')
        require(base.startsWith("https://")) { "Recovery server must use HTTPS." }
        val bodyText = body?.toString() ?: ""
        val url = URL("$base$path")
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 8_000
            readTimeout = 25_000
            doInput = true
            useCaches = false
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Connection", "close")
            security.signedHeaders(method, path.substringBefore('?'), bodyText).forEach { (name, value) ->
                setRequestProperty(name, value)
            }
            if (method != "GET" && method != "HEAD") doOutput = true
        }

        try {
            if (connection.doOutput) {
                connection.outputStream.use { stream ->
                    stream.write(bodyText.toByteArray(StandardCharsets.UTF_8))
                }
            }

            val code = connection.responseCode
            val input = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = input?.use { stream ->
                BufferedReader(InputStreamReader(stream, StandardCharsets.UTF_8)).readText()
            }.orEmpty()
            val json = try { JSONObject(text.ifBlank { "{}" }) } catch (_: Exception) { JSONObject().put("raw", text) }
            if (code !in 200..299) {
                throw IllegalStateException(json.optString("error", "Recovery server request failed ($code)"))
            }
            return json
        } finally {
            connection.disconnect()
        }
    }

    private fun encode(value: String): String = java.net.URLEncoder.encode(value, StandardCharsets.UTF_8.name())
}
