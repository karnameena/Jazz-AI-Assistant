package com.gunakarna.jazzassistant.apps

import android.accessibilityservice.AccessibilityService
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import com.gunakarna.jazzassistant.accessibility.AccessibilityActions
import com.gunakarna.jazzassistant.accessibility.AccessibilityLogger
import com.gunakarna.jazzassistant.accessibility.AccessibilityNodeFinder
import com.gunakarna.jazzassistant.accessibility.UiWaiter
import com.gunakarna.jazzassistant.automation.AutomationResult
import java.util.Locale

class InstagramAutomation(
    private val service: AccessibilityService,
    private val actions: AccessibilityActions,
    private val waiter: UiWaiter
) {
    private val packageName = "com.instagram.android"

    fun likeCurrentReel(): AutomationResult {
        val root = service.rootInActiveWindow
            ?: return AutomationResult.failure("WRONG_SCREEN", "I cannot inspect the current Instagram screen.")

        if (root.packageName?.toString() != packageName) {
            return AutomationResult.failure("WRONG_SCREEN", "Instagram is not the current app.")
        }

        AccessibilityLogger.action("instagram_like observe current screen")

        if (isLiked(root)) {
            AccessibilityLogger.verify("instagram_like already liked")
            return AutomationResult.success("ALREADY_LIKED", "Mama, this reel is already liked.")
        }

        val likeNode = findLikeNode(root)
            ?: return AutomationResult.failure(
                "LIKE_CONTROL_NOT_FOUND",
                "I couldn't find Instagram's Like control on the current reel, so I didn't guess."
            )

        if (!actions.clickNode(likeNode)) {
            return AutomationResult.failure("LIKE_CLICK_FAILED", "I found Instagram's Like control, but Android did not complete the click.")
        }

        AccessibilityLogger.action("instagram_like clicked semantic Like control")
        SystemClock.sleep(180)

        val verified = waiter.waitUntil(4500, 180) { current ->
            if (current.packageName?.toString() == packageName && isLiked(current)) true else null
        } == true

        if (!verified) {
            AccessibilityLogger.error("instagram_like state did not change to liked")
            return AutomationResult.failure(
                "LIKE_NOT_VERIFIED",
                "I pressed Instagram's Like control, but I couldn't confirm the reel became liked."
            )
        }

        AccessibilityLogger.verify("instagram_like verified liked state")
        return AutomationResult.success("LIKE_VERIFIED", "Mama, liked this reel.")
    }

    private fun findLikeNode(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val candidates = AccessibilityNodeFinder.findAll(root) { node ->
            if (!node.isEnabled || !node.isVisibleToUser) return@findAll false
            val label = label(node)
            isUnlikedLabel(label) && !label.startsWith("likes")
        }

        val distinct = candidates.distinctBy { node ->
            val rect = android.graphics.Rect().also(node::getBoundsInScreen)
            "${rect.left}:${rect.top}:${rect.right}:${rect.bottom}"
        }

        val clickable = distinct.mapNotNull { AccessibilityNodeFinder.findClickableParent(it) }
            .filter { it.isEnabled && it.isVisibleToUser }
            .distinctBy { node ->
                val rect = android.graphics.Rect().also(node::getBoundsInScreen)
                "${rect.left}:${rect.top}:${rect.right}:${rect.bottom}"
            }

        if (clickable.size == 1) return clickable.single()

        // Instagram sometimes exposes one exact semantic Like node plus other text such as
        // "123 likes". Prefer the exact control, but never choose between multiple equal controls.
        val exact = clickable.filter { node -> normalize(label(node)) == "like" }
        return if (exact.size == 1) exact.single() else null
    }

    private fun isLiked(root: AccessibilityNodeInfo): Boolean {
        return AccessibilityNodeFinder.findAll(root) { node ->
            if (!node.isEnabled || !node.isVisibleToUser) return@findAll false
            val value = normalize(label(node))
            isLikedLabel(value) || ((value == "like" || value.startsWith("like,")) && (node.isChecked || node.isSelected))
        }.isNotEmpty()
    }

    private fun isUnlikedLabel(value: String): Boolean {
        val normalized = normalize(value)
        return normalized == "like" || normalized.startsWith("like,") || normalized.startsWith("like ")
    }

    private fun isLikedLabel(value: String): Boolean {
        val normalized = normalize(value)
        return normalized == "unlike" || normalized.startsWith("unlike,") ||
            normalized.startsWith("remove like") || normalized == "liked"
    }

    private fun label(node: AccessibilityNodeInfo): String =
        node.contentDescription?.toString()?.takeIf { it.isNotBlank() }
            ?: node.text?.toString().orEmpty()

    private fun normalize(value: String): String = value
        .lowercase(Locale.ROOT)
        .replace(Regex("\\s+"), " ")
        .trim()
}
