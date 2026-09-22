package com.gunakarna.jazzassistant.accessibility

import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo

class UiWaiter(private val rootProvider: () -> AccessibilityNodeInfo?) {
    fun waitForPackage(packageName: String, timeoutMs: Long = 5000): AccessibilityNodeInfo? =
        waitUntil(timeoutMs) { root -> root.takeIf { it.packageName?.toString() == packageName } }

    fun waitForNode(text: String, timeoutMs: Long = 4000, exact: Boolean = false): AccessibilityNodeInfo? =
        waitUntil(timeoutMs) { root ->
            AccessibilityNodeFinder.findNodeByText(root, text, exact)
                ?: AccessibilityNodeFinder.findNodeByContentDescription(root, text, exact)
        }

    fun waitForEditable(timeoutMs: Long = 4000): AccessibilityNodeInfo? =
        waitUntil(timeoutMs) { root -> AccessibilityNodeFinder.findEditableField(root) }

    fun <T> waitUntil(timeoutMs: Long, intervalMs: Long = 150, block: (AccessibilityNodeInfo) -> T?): T? {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (SystemClock.elapsedRealtime() < deadline) {
            val root = rootProvider()
            if (root != null) {
                val value = runCatching { block(root) }.getOrNull()
                if (value != null) return value
            }
            SystemClock.sleep(intervalMs)
        }
        return null
    }
}
