package com.gunakarna.jazzassistant

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
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
        "dial_number" -> dialNumber(args["number"]?.toString() ?: "")
        "tap" -> tap((args["x"] as Number).toFloat(), (args["y"] as Number).toFloat())
        "swipe" -> swipe(
            (args["x1"] as Number).toFloat(), (args["y1"] as Number).toFloat(),
            (args["x2"] as Number).toFloat(), (args["y2"] as Number).toFloat(),
            (args["durationMs"] as? Number)?.toLong() ?: 500L
        )
        "scroll_down" -> scrollDown()
        "scroll_up" -> scrollUp()
        "click_text" -> clickText(args["text"]?.toString() ?: "")
        "open_instagram_reels" -> openInstagramReels()
        "read_screen" -> readScreen()
        "device_info" -> deviceInfo()
        "screen_state" -> screenState()
        else -> mapOf("ok" to false, "error" to "Action not allowed")
    }

    private fun result(ok: Boolean, message: String) = mapOf("ok" to ok, "message" to message)

    private fun openUrl(url: String): Map<String, Any?> = try {
        require(Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(url))
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        mapOf("ok" to true, "message" to "URL opened", "url" to url)
    } catch (e: Exception) { mapOf("ok" to false, "error" to e.message) }

    private fun launchApp(pkg: String): Map<String, Any?> = try {
        require(pkg.matches(Regex("^[A-Za-z0-9._]+$"))) { "Invalid package name" }
        val intent = packageManager.getLaunchIntentForPackage(pkg) ?: error("App not found")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(intent)
        mapOf("ok" to true, "message" to "App launch requested", "packageName" to pkg)
    } catch (e: Exception) { mapOf("ok" to false, "error" to e.message) }

    // Opens Android's dialer with the number filled in. Jazz deliberately does not
    // place the call itself, so the user retains the final OS/user confirmation.
    private fun dialNumber(number: String): Map<String, Any?> = try {
        val cleaned = number.filter { it.isDigit() || it == '+' }
        require(cleaned.length in 3..20) { "Invalid phone number" }
        startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$cleaned")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        mapOf("ok" to true, "message" to "Dialer opened", "number" to cleaned)
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

    private fun scrollDown(): Map<String, Any?> {
        val metrics = resources.displayMetrics
        return swipe(metrics.widthPixels * 0.5f, metrics.heightPixels * 0.78f, metrics.widthPixels * 0.5f, metrics.heightPixels * 0.28f, 420)
    }

    private fun scrollUp(): Map<String, Any?> {
        val metrics = resources.displayMetrics
        return swipe(metrics.widthPixels * 0.5f, metrics.heightPixels * 0.30f, metrics.widthPixels * 0.5f, metrics.heightPixels * 0.80f, 420)
    }

    private fun clickText(text: String): Map<String, Any?> {
        if (text.isBlank()) return mapOf("ok" to false, "error" to "Text is required")
        val root = rootInActiveWindow ?: return mapOf("ok" to false, "error" to "No active window")
        val nodes = root.findAccessibilityNodeInfosByText(text)
        val node = nodes.firstOrNull { it.isClickable } ?: nodes.firstOrNull()
        var clickable = node
        while (clickable != null && !clickable.isClickable) clickable = clickable.parent
        val ok = clickable?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
        nodes.forEach { it.recycle() }
        root.recycle()
        return result(ok, if (ok) "Clicked visible text" else "Text not clickable")
    }

    private fun openInstagramReels(): Map<String, Any?> {
        val launched = launchApp("com.instagram.android")
        if (launched["ok"] != true) return launched
        Handler(Looper.getMainLooper()).postDelayed({ clickText("Reels") }, 1400)
        return mapOf("ok" to true, "message" to "Instagram opened; Reels selection requested")
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

    private fun screenState(): Map<String, Any?> {
        val power = getSystemService(POWER_SERVICE) as android.os.PowerManager
        val locked = (getSystemService(KEYGUARD_SERVICE) as android.app.KeyguardManager).isKeyguardLocked
        return mapOf("ok" to true, "interactive" to power.isInteractive, "locked" to locked)
    }

    private fun deviceInfo(): Map<String, Any?> = mapOf(
        "ok" to true,
        "model" to android.os.Build.MODEL,
        "manufacturer" to android.os.Build.MANUFACTURER,
        "androidVersion" to android.os.Build.VERSION.RELEASE
    )
}
