package com.gunakarna.jazzassistant

import android.content.Context
import org.json.JSONObject
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors

class JazzLocalServer(private val context: Context) {
    private val executor = Executors.newCachedThreadPool()
    private var serverSocket: ServerSocket? = null
    private val port = 9898
    private val token: String = context.getSharedPreferences("jazz", Context.MODE_PRIVATE)
        .getString("bridge_token", "") ?: ""

    fun start() {
        if (serverSocket != null) return
        executor.execute {
            try {
                serverSocket = ServerSocket(port, 20, java.net.InetAddress.getByName("127.0.0.1"))
                while (!serverSocket!!.isClosed) {
                    val socket = serverSocket!!.accept()
                    executor.execute { handle(socket) }
                }
            } catch (_: Exception) { }
        }
    }

    fun stop() {
        try { serverSocket?.close() } catch (_: Exception) { }
        serverSocket = null
        executor.shutdownNow()
    }

    private fun handle(socket: Socket) {
        socket.use { s ->
            try {
                val input = s.getInputStream()
                val data = ByteArray(65536)
                val len = input.read(data)
                if (len <= 0) return
                val request = String(data, 0, len, StandardCharsets.UTF_8)
                val headerEnd = request.indexOf("\r\n\r\n")
                if (headerEnd < 0) return
                val headers = request.substring(0, headerEnd)
                val lines = headers.split("\r\n")
                val first = lines.firstOrNull().orEmpty().split(" ")
                val method = first.getOrElse(0) { "" }
                val path = first.getOrElse(1) { "" }
                val auth = lines.firstOrNull { it.startsWith("Authorization:", true) }?.substringAfter(":")?.trim().orEmpty()
                if (method != "POST" || path != "/command" || auth != "Bearer $token") {
                    respond(s, 401, JSONObject(mapOf("ok" to false, "error" to "Unauthorized")).toString())
                    return
                }
                val contentLength = lines.firstOrNull { it.startsWith("Content-Length:", true) }?.substringAfter(":")?.trim()?.toIntOrNull() ?: 0
                var body = request.substring(headerEnd + 4)
                while (body.toByteArray(StandardCharsets.UTF_8).size < contentLength) {
                    val n = input.read(data)
                    if (n <= 0) break
                    body += String(data, 0, n, StandardCharsets.UTF_8)
                }
                val json = JSONObject(body)
                val action = json.optString("action")
                val args = mutableMapOf<String, Any?>()
                val argsJson = json.optJSONObject("args")
                if (argsJson != null) {
                    argsJson.keys().forEach { key -> args[key] = argsJson.get(key) }
                }
                val result = JazzAccessibilityService.instance?.execute(action, args)
                    ?: mapOf("ok" to false, "error" to "Accessibility service is not enabled")
                respond(s, if (result["ok"] == true) 200 else 400, JSONObject(result).toString())
            } catch (e: Exception) {
                respond(s, 400, JSONObject(mapOf("ok" to false, "error" to (e.message ?: "Bad request"))).toString())
            }
        }
    }

    private fun respond(socket: Socket, status: Int, body: String) {
        val statusText = if (status == 200) "OK" else if (status == 401) "Unauthorized" else "Bad Request"
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        val response = "HTTP/1.1 $status $statusText\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray(StandardCharsets.UTF_8) + bytes
        socket.getOutputStream().use { it.write(response); it.flush() }
    }
}
