package com.gunakarna.jazzassistant.apps

import android.accessibilityservice.AccessibilityService
import android.graphics.Rect
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import com.gunakarna.jazzassistant.accessibility.AccessibilityActions
import com.gunakarna.jazzassistant.accessibility.AccessibilityLogger
import com.gunakarna.jazzassistant.accessibility.AccessibilityNodeFinder
import com.gunakarna.jazzassistant.accessibility.UiWaiter
import com.gunakarna.jazzassistant.automation.AutomationResult
import java.util.Locale

class CallAutomation(
    private val service: AccessibilityService,
    private val actions: AccessibilityActions,
    private val waiter: UiWaiter
) {
    fun setSpeaker(enabled: Boolean): AutomationResult {
        val root = service.rootInActiveWindow
            ?: return AutomationResult.failure("WRONG_SCREEN", "I can't inspect the current call screen.")

        AccessibilityLogger.action("call_speaker target=${if (enabled) "on" else "off"}")

        val control = findSpeakerControl(root)
            ?: return AutomationResult.failure(
                "SPEAKER_CONTROL_NOT_FOUND",
                "I couldn't find the Speaker control on the current call screen."
            )

        val initialState = speakerState(control)
        if (initialState == enabled) {
            AccessibilityLogger.verify("call_speaker already=${if (enabled) "on" else "off"}")
            return AutomationResult.success(
                if (enabled) "SPEAKER_ALREADY_ON" else "SPEAKER_ALREADY_OFF",
                if (enabled) "Mama, speaker is on." else "Mama, speaker is off."
            )
        }

        if (!actions.clickNode(control)) {
            return AutomationResult.failure(
                "SPEAKER_CLICK_FAILED",
                "I found the Speaker control, but Android did not complete the tap."
            )
        }

        SystemClock.sleep(180)
        val verified = waiter.waitUntil(3500, 150) { currentRoot ->
            val current = findSpeakerControl(currentRoot) ?: return@waitUntil null
            if (speakerState(current) == enabled) true else null
        } == true

        if (!verified) {
            AccessibilityLogger.error("call_speaker state verification failed")
            return AutomationResult.failure(
                "SPEAKER_NOT_VERIFIED",
                "I tapped Speaker, but I couldn't confirm that the call audio changed."
            )
        }

        AccessibilityLogger.verify("call_speaker verified=${if (enabled) "on" else "off"}")
        return AutomationResult.success(
            if (enabled) "SPEAKER_ON" else "SPEAKER_OFF",
            if (enabled) "Mama, speaker is on." else "Mama, speaker is off."
        )
    }

    private fun findSpeakerControl(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val raw = AccessibilityNodeFinder.findAll(root) { node ->
            if (!node.isEnabled || !node.isVisibleToUser) return@findAll false
            val label = normalize(label(node))
            label == "speaker" ||
                label == "speakerphone" ||
                label.startsWith("speaker,") ||
                label.startsWith("speaker ") ||
                label.startsWith("speakerphone,") ||
                label.startsWith("speakerphone ") ||
                label == "handsfree" ||
                label.startsWith("handsfree,")
        }

        val clickable = raw.mapNotNull { AccessibilityNodeFinder.findClickableParent(it) }
            .filter { it.isEnabled && it.isVisibleToUser }
            .distinctBy(::boundsKey)

        if (clickable.size == 1) return clickable.single()

        val exact = clickable.filter {
            val value = normalize(label(it))
            value == "speaker" || value == "speakerphone"
        }
        return if (exact.size == 1) exact.single() else null
    }

    private fun speakerState(node: AccessibilityNodeInfo): Boolean? {
        val value = normalize(label(node))
        if (value.contains("speaker on") || value.contains("speakerphone on") ||
            value.contains("speaker, on") || value.contains("speakerphone, on") ||
            value.contains("speaker selected") || value.contains("speakerphone selected") ||
            value.contains("handsfree on")) return true

        if (value.contains("speaker off") || value.contains("speakerphone off") ||
            value.contains("speaker, off") || value.contains("speakerphone, off") ||
            value.contains("handsfree off")) return false

        if (node.isCheckable) return node.isChecked
        if (node.isSelected) return true

        val parent = node.parent
        if (parent != null) {
            if (parent.isCheckable) return parent.isChecked
            if (parent.isSelected) return true
        }
        return null
    }

    private fun label(node: AccessibilityNodeInfo): String =
        node.contentDescription?.toString()?.takeIf { it.isNotBlank() }
            ?: node.text?.toString().orEmpty()

    private fun normalize(value: String): String = value
        .lowercase(Locale.ROOT)
        .replace(Regex("\\s+"), " ")
        .trim()

    private fun boundsKey(node: AccessibilityNodeInfo): String {
        val rect = Rect().also(node::getBoundsInScreen)
        return "${rect.left}:${rect.top}:${rect.right}:${rect.bottom}"
    }
}
