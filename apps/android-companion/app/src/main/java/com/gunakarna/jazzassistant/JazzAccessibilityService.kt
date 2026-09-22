package com.gunakarna.jazzassistant

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.app.KeyguardManager
import android.graphics.Path
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.view.accessibility.AccessibilityEvent
import com.gunakarna.jazzassistant.accessibility.AccessibilityLogger
import com.gunakarna.jazzassistant.automation.AndroidAutomationEngine

class JazzAccessibilityService : AccessibilityService() {
    companion object { var instance: JazzAccessibilityService? = null }

    private var server: JazzLocalServer? = null
    private lateinit var engine: AndroidAutomationEngine
    @Volatile var lastForegroundPackage: String? = null
        private set

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        engine = AndroidAutomationEngine(this)
        server = JazzLocalServer(this).also { it.start() }
        AccessibilityLogger.info("Jazz Accessibility Service connected")
    }

    override fun onDestroy() {
        server?.stop()
        server = null
        instance = null
        AccessibilityLogger.info("Jazz Accessibility Service disconnected")
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event?.packageName?.toString()?.takeIf { it.isNotBlank() }?.let { lastForegroundPackage = it }
    }

    override fun onInterrupt() {
        AccessibilityLogger.warn("Accessibility service interrupted")
    }

    fun execute(action: String, args: Map<String, Any?>): Map<String, Any?> = when (action) {
        "tap" -> tap((args["x"] as? Number)?.toFloat(), (args["y"] as? Number)?.toFloat())
        "swipe" -> swipe(
            (args["x1"] as? Number)?.toFloat(),
            (args["y1"] as? Number)?.toFloat(),
            (args["x2"] as? Number)?.toFloat(),
            (args["y2"] as? Number)?.toFloat(),
            (args["durationMs"] as? Number)?.toLong() ?: 500L
        )
        "open_instagram_reels" -> {
            val opened = engine.execute("open_app", mapOf("app" to "Instagram"))
            if (opened["ok"] == true) {
                Handler(Looper.getMainLooper()).postDelayed({ engine.execute("click_text", mapOf("text" to "Reels")) }, 1400)
            }
            opened
        }
        "device_info" -> deviceInfo()
        "screen_state" -> screenState()
        else -> engine.execute(action, args)
    }

    fun executeNaturalCommand(command: String): Map<String, Any?> = engine.executeNaturalCommand(command)
    fun executeIntent(intent: String, args: Map<String, Any?>): Map<String, Any?> = engine.executeIntent(intent, args)
    fun listInstalledApps(): List<Map<String, String>> = engine.listApps()
    fun dumpUiTree(): Map<String, Any?> = engine.execute("dump_ui_tree")

    private fun tap(x: Float?, y: Float?): Map<String, Any?> {
        if (x == null || y == null) return mapOf("ok" to false, "status" to "BAD_ARGUMENTS", "error" to "x and y are required")
        val path = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 80))
            .build()
        val ok = dispatchGesture(gesture, null, Handler(Looper.getMainLooper()))
        return mapOf("ok" to ok, "status" to if (ok) "GESTURE_DISPATCHED" else "GESTURE_FAILED", "message" to if (ok) "Tap dispatched" else "Tap failed")
    }

    private fun swipe(x1: Float?, y1: Float?, x2: Float?, y2: Float?, duration: Long): Map<String, Any?> {
        if (x1 == null || y1 == null || x2 == null || y2 == null) {
            return mapOf("ok" to false, "status" to "BAD_ARGUMENTS", "error" to "x1, y1, x2 and y2 are required")
        }
        val path = Path().apply { moveTo(x1, y1); lineTo(x2, y2) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, duration.coerceIn(100, 3000)))
            .build()
        val ok = dispatchGesture(gesture, null, Handler(Looper.getMainLooper()))
        return mapOf("ok" to ok, "status" to if (ok) "GESTURE_DISPATCHED" else "GESTURE_FAILED", "message" to if (ok) "Swipe dispatched" else "Swipe failed")
    }

    private fun screenState(): Map<String, Any?> {
        val power = getSystemService(POWER_SERVICE) as PowerManager
        val locked = (getSystemService(KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked
        return mapOf("ok" to true, "interactive" to power.isInteractive, "locked" to locked)
    }

    private fun deviceInfo(): Map<String, Any?> = mapOf(
        "ok" to true,
        "model" to android.os.Build.MODEL,
        "manufacturer" to android.os.Build.MANUFACTURER,
        "androidVersion" to android.os.Build.VERSION.RELEASE,
        "currentPackage" to (rootInActiveWindow?.packageName?.toString() ?: lastForegroundPackage)
    )
}
