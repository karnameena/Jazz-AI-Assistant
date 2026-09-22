package com.gunakarna.jazzassistant.accessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Bundle
import android.util.DisplayMetrics
import android.view.accessibility.AccessibilityNodeInfo

class AccessibilityActions(private val service: AccessibilityService) {
    fun clickNode(node: AccessibilityNodeInfo?): Boolean {
        val target = AccessibilityNodeFinder.findClickableParent(node) ?: return false
        return target.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    fun clickText(text: String, exact: Boolean = false): Boolean {
        val root = service.rootInActiveWindow ?: return false
        val node = AccessibilityNodeFinder.findNodeByText(root, text, exact)
            ?: AccessibilityNodeFinder.findNodeByContentDescription(root, text, exact)
        return clickNode(node)
    }

    fun longClickText(text: String): Boolean {
        val root = service.rootInActiveWindow ?: return false
        val node = AccessibilityNodeFinder.findNodeByText(root, text, true)
            ?: AccessibilityNodeFinder.findNodeByText(root, text, false)
            ?: AccessibilityNodeFinder.findNodeByContentDescription(root, text, false)
            ?: return false
        val target = AccessibilityNodeFinder.findClickableParent(node) ?: node
        return target.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK)
    }

    fun setText(node: AccessibilityNodeInfo?, text: String): Boolean {
        if (node == null || !node.isEnabled) return false
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    fun setText(text: String): Boolean {
        val root = service.rootInActiveWindow ?: return false
        val node = AccessibilityNodeFinder.findEditableField(root) ?: return false
        return setText(node, text)
    }

    fun clearText(): Boolean = setText("")

    fun scrollForward(): Boolean {
        val root = service.rootInActiveWindow
        val node = root?.let { AccessibilityNodeFinder.findScrollableNode(it) }
        if (node?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD) == true) return true
        return gestureScroll(forward = true)
    }

    fun scrollBackward(): Boolean {
        val root = service.rootInActiveWindow
        val node = root?.let { AccessibilityNodeFinder.findScrollableNode(it) }
        if (node?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD) == true) return true
        return gestureScroll(forward = false)
    }

    private fun gestureScroll(forward: Boolean): Boolean {
        val metrics: DisplayMetrics = service.resources.displayMetrics
        val x = metrics.widthPixels * 0.5f
        val fromY = metrics.heightPixels * if (forward) 0.78f else 0.28f
        val toY = metrics.heightPixels * if (forward) 0.28f else 0.78f
        val path = Path().apply {
            moveTo(x, fromY)
            lineTo(x, toY)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 420))
            .build()
        return service.dispatchGesture(gesture, null, null)
    }

    fun pressBack(): Boolean = service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
    fun pressHome(): Boolean = service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)
    fun openRecents(): Boolean = service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_RECENTS)
    fun openNotifications(): Boolean = service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS)
}
