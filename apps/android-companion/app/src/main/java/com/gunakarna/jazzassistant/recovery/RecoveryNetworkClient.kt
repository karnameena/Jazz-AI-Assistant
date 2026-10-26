package com.gunakarna.jazzassistant.recovery

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.nio.charset.StandardCharsets
import java.io.File
import java.io.FileOutputStream

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

            // Retry already-captured photos before asking for another command.
            // The payload is persisted in app-private storage before network I/O,
            // so a transient server/network failure or process restart does not
            // force another camera capture or discard the image bytes.
            flushPendingPhotoResults()

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
            if (typeIsPhoto(command) && result.optBoolean("ok") && result.has("imageBase64")) {
                persistPendingPhotoResult(commandId, resultBody)
                flushPendingPhotoResult(commandId, File(pendingPhotoDirectory(), "$commandId.json"))
            } else {
                request("POST", "/android/device/commands/$commandId/result", resultBody)
            }
            JSONObject()
                .put("ok", true)
                .put("status", "COMMAND_EXECUTED")
                .put("network", deviceStatus.optString("network", "UNKNOWN"))
                .put("commandId", commandId)
                .put("result", result)
        }
    }

    private fun typeIsPhoto(command: JSONObject): Boolean =
        command.optString("type") == "recovery_photo"

    private fun pendingPhotoDirectory(): File =
        File(context.filesDir, "recovery-photo-pending").apply { mkdirs() }

    private fun persistPendingPhotoResult(commandId: String, body: JSONObject) {
        require(commandId.matches(Regex("^[a-fA-F0-9-]{36}$"))) { "Invalid recovery command ID." }
        val directory = pendingPhotoDirectory()
        val target = File(directory, "$commandId.json")
        val temporary = File(directory, ".$commandId.tmp")
        val bytes = body.toString().toByteArray(StandardCharsets.UTF_8)
        FileOutputStream(temporary).use { stream ->
            stream.write(bytes)
            stream.fd.sync()
        }
        if (target.exists() && !target.delete()) {
            temporary.delete()
            throw IllegalStateException("Could not replace pending recovery photo upload.")
        }
        if (!temporary.renameTo(target)) {
            temporary.delete()
            throw IllegalStateException("Could not save pending recovery photo upload.")
        }
        Log.i("JazzRecoveryPhoto", "photo_upload_queued commandId=$commandId bytes=${bytes.size}")
    }

    private fun flushPendingPhotoResults() {
        val directory = pendingPhotoDirectory()
        directory.listFiles()
            ?.filter { it.isFile && it.name.matches(Regex("^[a-fA-F0-9-]{36}\\.json$")) }
            ?.sortedBy { it.lastModified() }
            ?.forEach { file -> flushPendingPhotoResult(file.nameWithoutExtension, file) }
    }

    private fun flushPendingPhotoResult(commandId: String, file: File) {
        val startedAt = System.currentTimeMillis()
        val body = JSONObject(file.readText(StandardCharsets.UTF_8))
        val payloadBytes = file.length()
        val acknowledgement = request("POST", "/android/device/commands/$commandId/result", body)
        val saved = acknowledgement.optBoolean("photoAvailable") ||
            (acknowledgement.optBoolean("deduplicated") && !acknowledgement.has("photoAvailable"))
        // A successful HTTP response with photoAvailable=false is an explicit
        // backend rejection/failure, not a successful upload. It is terminal for
        // this command (the dashboard will report FAILED), so don't retry it forever.
        if (file.exists() && !file.delete()) {
            Log.w("JazzRecoveryPhoto", "photo_upload_acknowledged_but_queue_cleanup_failed commandId=$commandId")
        }
        Log.i(
            "JazzRecoveryPhoto",
            "photo_upload_acknowledged commandId=$commandId saved=$saved payloadBytes=$payloadBytes durationMs=${System.currentTimeMillis() - startedAt}"
        )
        if (!saved) {
            Log.e("JazzRecoveryPhoto", "photo_upload_not_persisted commandId=$commandId")
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
            // Camera startup plus private-object upload can exceed the normal
            // heartbeat timeout. The server lease is extended for photo commands.
            readTimeout = if (
                method == "POST" &&
                path.startsWith("/android/device/commands/") &&
                path.endsWith("/result")
            ) 60_000 else 25_000
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
