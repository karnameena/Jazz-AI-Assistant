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
        AccessibilityLogger.action("click class=${target.className} id=${target.viewIdResourceName ?: ""}")
        return target.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    fun clickText(text: String, exact: Boolean = false): Boolean {
        val root = service.rootInActiveWindow ?: return false
        val node = AccessibilityNodeFinder.findBestActionNode(root, text)
            ?: AccessibilityNodeFinder.findNodeByText(root, text, exact)
            ?: AccessibilityNodeFinder.findNodeByContentDescription(root, text, exact)
        return clickNode(node)
    }

    fun clickViewId(viewId: String): Boolean {
        val root = service.rootInActiveWindow ?: return false
        return clickNode(AccessibilityNodeFinder.findByViewId(root, viewId))
    }

    fun longClickText(text: String): Boolean {
        val root = service.rootInActiveWindow ?: return false
        val node = AccessibilityNodeFinder.findBestActionNode(root, text)
            ?: AccessibilityNodeFinder.findNodeByText(root, text, true)
            ?: AccessibilityNodeFinder.findNodeByText(root, text, false)
            ?: AccessibilityNodeFinder.findNodeByContentDescription(root, text, false)
            ?: return false
        val target = AccessibilityNodeFinder.findClickableParent(node) ?: node
        return target.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK)
    }

    fun setText(node: AccessibilityNodeInfo?, text: String): Boolean {
        if (node == null || !node.isEnabled || !node.isVisibleToUser) return false
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        AccessibilityLogger.action("set_text class=${node.className} id=${node.viewIdResourceName ?: ""}")
        return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    fun setText(text: String): Boolean {
        val root = service.rootInActiveWindow ?: return false
        val node = AccessibilityNodeFinder.findEditableField(root) ?: return false
        return setText(node, text)
    }

    fun clearText(): Boolean = setText("")

    fun scrollForward(): Boolean = swipeUp()
    fun scrollBackward(): Boolean = swipeDown()
    fun swipeUp(): Boolean = gestureSwipe(0.50f, 0.78f, 0.50f, 0.28f)
    fun swipeDown(): Boolean = gestureSwipe(0.50f, 0.28f, 0.50f, 0.78f)
    fun swipeLeft(): Boolean = gestureSwipe(0.82f, 0.50f, 0.18f, 0.50f)
    fun swipeRight(): Boolean = gestureSwipe(0.18f, 0.50f, 0.82f, 0.50f)

    private fun gestureSwipe(fromXRatio: Float, fromYRatio: Float, toXRatio: Float, toYRatio: Float): Boolean {
        val metrics: DisplayMetrics = service.resources.displayMetrics
        val path = Path().apply {
            moveTo(metrics.widthPixels * fromXRatio, metrics.heightPixels * fromYRatio)
            lineTo(metrics.widthPixels * toXRatio, metrics.heightPixels * toYRatio)
        }
        AccessibilityLogger.action("gesture_swipe from=$fromXRatio,$fromYRatio to=$toXRatio,$toYRatio")
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 420))
            .build()
        return service.dispatchGesture(gesture, null, null)
    }

    fun doubleTapCenter(): Boolean {
        val metrics: DisplayMetrics = service.resources.displayMetrics
        val x = metrics.widthPixels * 0.5f
        val y = metrics.heightPixels * 0.43f
        val firstTap = Path().apply { moveTo(x, y) }
        val secondTap = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(firstTap, 0, 70))
            .addStroke(GestureDescription.StrokeDescription(secondTap, 150, 70))
            .build()
        return service.dispatchGesture(gesture, null, null)
    }

    fun pressBack(): Boolean = service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
    fun pressHome(): Boolean = service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)
    fun openRecents(): Boolean = service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_RECENTS)
    fun openNotifications(): Boolean = service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS)
}
