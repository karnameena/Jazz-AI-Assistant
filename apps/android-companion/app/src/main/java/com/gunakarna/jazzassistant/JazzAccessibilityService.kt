package com.gunakarna.jazzassistant

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityEvent

class JazzAccessibilityService : AccessibilityService() {
    companion object { var instance: JazzAccessibilityService? = null }
    private var server: JazzLocalServer? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        server = JazzLocalServer(this).also { it.start() }
    }

    override fun onDestroy() {
        server?.stop()
        server = null
        instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    fun execute(action: String, args: Map<String, Any?>): Map<String, Any?> = when (action) {
        "home" -> result(performGlobalAction(GLOBAL_ACTION_HOME), "Home")
        "back" -> result(performGlobalAction(GLOBAL_ACTION_BACK), "Back")
        "recents" -> result(performGlobalAction(GLOBAL_ACTION_RECENTS), "Recents")
        "notifications" -> result(performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS), "Notifications")
        "open_url" -> openUrl(args["url"]?.toString() ?: "")
        "launch_app" -> launchApp(args["packageName"]?.toString() ?: "")
        "tap" -> tap((args["x"] as Number).toFloat(), (args["y"] as Number).toFloat())
        "swipe" -> swipe(
            (args["x1"] as Number).toFloat(), (args["y1"] as Number).toFloat(),
            (args["x2"] as Number).toFloat(), (args["y2"] as Number).toFloat(),
            (args["durationMs"] as? Number)?.toLong() ?: 500L
        )
        "click_text" -> clickText(args["text"]?.toString() ?: "")
        "read_screen" -> readScreen()
        "device_info" -> deviceInfo()
        else -> mapOf("ok" to false, "error" to "Action not allowed")
    }

    private fun result(ok: Boolean, message: String) = mapOf("ok" to ok, "message" to message)

    private fun openUrl(url: String): Map<String, Any?> = try {
        require(Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(url))
        startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        mapOf("ok" to true, "message" to "URL opened", "url" to url)
    } catch (e: Exception) { mapOf("ok" to false, "error" to e.message) }

    private fun launchApp(pkg: String): Map<String, Any?> = try {
        val intent = packageManager.getLaunchIntentForPackage(pkg) ?: error("App not found")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(intent)
        mapOf("ok" to true, "message" to "App launch requested", "packageName" to pkg)
    } catch (e: Exception) { mapOf("ok" to false, "error" to e.message) }

    private fun tap(x: Float, y: Float): Map<String, Any?> {
        val path = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, 80)).build()
        val ok = dispatchGesture(gesture, null, Handler(Looper.getMainLooper()))
        return result(ok, if (ok) "Tap dispatched" else "Tap failed")
    }

    private fun swipe(x1: Float, y1: Float, x2: Float, y2: Float, duration: Long): Map<String, Any?> {
        val path = Path().apply { moveTo(x1, y1); lineTo(x2, y2) }
        val gesture = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, duration.coerceIn(100, 3000))).build()
        val ok = dispatchGesture(gesture, null, Handler(Looper.getMainLooper()))
        return result(ok, if (ok) "Swipe dispatched" else "Swipe failed")
    }

    private fun clickText(text: String): Map<String, Any?> {
        val root = rootInActiveWindow ?: return mapOf("ok" to false, "error" to "No active window")
        val nodes = root.findAccessibilityNodeInfosByText(text)
        val node = nodes.firstOrNull { it.isClickable } ?: nodes.firstOrNull()
        val ok = node?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
        nodes.forEach { it.recycle() }
        root.recycle()
        return result(ok, if (ok) "Clicked visible text" else "Text not clickable")
    }

    private fun readScreen(): Map<String, Any?> {
        val root = rootInActiveWindow ?: return mapOf("ok" to false, "error" to "No active window")
        val lines = mutableListOf<String>()
        walk(root, lines)
        root.recycle()
        return mapOf("ok" to true, "items" to lines.take(500))
    }

    private fun walk(node: AccessibilityNodeInfo, out: MutableList<String>) {
        val text = node.text?.toString()?.trim().orEmpty()
        val desc = node.contentDescription?.toString()?.trim().orEmpty()
        if (text.isNotEmpty()) out += "text:$text"
        if (desc.isNotEmpty() && desc != text) out += "desc:$desc"
        for (i in 0 until node.childCount) node.getChild(i)?.let { walk(it, out); it.recycle() }
    }

    private fun deviceInfo(): Map<String, Any?> = mapOf("ok" to true, "model" to android.os.Build.MODEL, "manufacturer" to android.os.Build.MANUFACTURER, "androidVersion" to android.os.Build.VERSION.RELEASE)
}
