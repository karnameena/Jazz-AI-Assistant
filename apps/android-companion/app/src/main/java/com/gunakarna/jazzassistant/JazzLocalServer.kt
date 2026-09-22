package com.gunakarna.jazzassistant

import android.content.Context
import org.json.JSONObject
import java.net.InetAddress
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
                serverSocket = ServerSocket(port, 20, InetAddress.getByName("127.0.0.1"))
                while (serverSocket?.isClosed == false) {
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
                val request = readRequest(s)
                val requestLine = request.headers.substringBefore("\r\n").split(" ")
                val method = requestLine.getOrElse(0) { "" }
                val path = requestLine.getOrElse(1) { "" }.substringBefore("?")
                val auth = request.headers
                    .split("\r\n")
                    .firstOrNull { it.startsWith("Authorization:", true) }
                    ?.substringAfter(":")
                    ?.trim()
                    .orEmpty()

                if (auth != "Bearer $token") {
                    respond(s, 401, json(mapOf("ok" to false, "error" to "Unauthorized")))
                    return
                }

                val service = JazzAccessibilityService.instance
                if (service == null) {
                    respond(s, 503, json(mapOf("ok" to false, "status" to "ACCESSIBILITY_DISABLED", "error" to "Accessibility service is not enabled")))
                    return
                }

                if (method == "GET" && path == "/android/apps") {
                    respond(s, 200, json(mapOf("ok" to true, "apps" to service.listInstalledApps())))
                    return
                }
                if (method == "GET" && path == "/android/ui-tree") {
                    val result = service.dumpUiTree()
                    respond(s, if (result["ok"] == true) 200 else 400, json(result))
                    return
                }

                if (method != "POST") {
                    respond(s, 404, json(mapOf("ok" to false, "error" to "Not found")))
                    return
                }

                val body = JSONObject(request.body.ifBlank { "{}" })
                val args = body.optJSONObject("args").toMap()
                val result: Map<String, Any?> = when (path) {
                    "/command" -> service.execute(body.optString("action"), args)
                    "/android/action" -> {
                        val action = body.optString("action")
                        val mergedArgs = body.toMap().filterKeys { it != "action" && it != "args" } + args
                        service.execute(action, mergedArgs)
                    }
                    "/android/open-app" -> service.execute("open_app", mapOf("app" to body.optString("app")))
                    "/android/execute" -> {
                        val command = body.optString("command")
                        if (command.isNotBlank()) {
                            service.executeNaturalCommand(command)
                        } else {
                            val intent = body.optString("intent")
                            val mergedArgs = body.toMap().filterKeys { it != "intent" && it != "args" } + args
                            service.executeIntent(intent, mergedArgs)
                        }
                    }
                    else -> mapOf("ok" to false, "status" to "NOT_FOUND", "error" to "Not found")
                }
                respond(s, if (result["ok"] == true) 200 else 400, json(result))
            } catch (e: Exception) {
                respond(s, 400, json(mapOf("ok" to false, "error" to (e.message ?: "Bad request"))))
            }
        }
    }

    private data class HttpRequest(val headers: String, val body: String)

    private fun readRequest(socket: Socket): HttpRequest {
        val input = socket.getInputStream()
        val buffer = ByteArray(65536)
        val firstRead = input.read(buffer)
        if (firstRead <= 0) return HttpRequest("", "")
        var request = String(buffer, 0, firstRead, StandardCharsets.UTF_8)
        val headerEnd = request.indexOf("\r\n\r\n")
        if (headerEnd < 0) error("Malformed HTTP request")
        val headers = request.substring(0, headerEnd)
        val contentLength = headers
            .split("\r\n")
            .firstOrNull { it.startsWith("Content-Length:", true) }
            ?.substringAfter(":")
            ?.trim()
            ?.toIntOrNull() ?: 0
        var body = request.substring(headerEnd + 4)
        while (body.toByteArray(StandardCharsets.UTF_8).size < contentLength) {
            val count = input.read(buffer)
            if (count <= 0) break
            body += String(buffer, 0, count, StandardCharsets.UTF_8)
        }
        return HttpRequest(headers, body)
    }

    private fun JSONObject?.toMap(): Map<String, Any?> {
        if (this == null) return emptyMap()
        return keys().asSequence().associateWith { key ->
            when (val value = get(key)) {
                JSONObject.NULL -> null
                is JSONObject -> value.toMap()
                else -> value
            }
        }
    }

    private fun JSONObject.toMap(): Map<String, Any?> =
        keys().asSequence().associateWith { key ->
            when (val value = get(key)) {
                JSONObject.NULL -> null
                is JSONObject -> value.toMap()
                else -> value
            }
        }

    private fun json(value: Map<String, Any?>): String = JSONObject(value).toString()

    private fun respond(socket: Socket, status: Int, body: String) {
        val statusText = when (status) {
            200 -> "OK"
            400 -> "Bad Request"
            401 -> "Unauthorized"
            404 -> "Not Found"
            503 -> "Service Unavailable"
            else -> "Error"
        }
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        val response = "HTTP/1.1 $status $statusText\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
            .toByteArray(StandardCharsets.UTF_8) + bytes
        socket.getOutputStream().use { it.write(response); it.flush() }
    }
}
