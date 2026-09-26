package com.gunakarna.jazzassistant.apps

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.graphics.Rect
import android.media.AudioManager
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
    private val audioManager = service.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    fun setSpeaker(enabled: Boolean): AutomationResult {
        val root = service.rootInActiveWindow
            ?: return AutomationResult.failure("WRONG_SCREEN", "I can't inspect the current call screen.")

        AccessibilityLogger.action("call_speaker target=${if (enabled) "on" else "off"}")

        val directControl = findSpeakerControl(root)
        val currentState = directControl?.let(::speakerState) ?: systemSpeakerState()
        if (currentState == enabled) {
            AccessibilityLogger.verify("call_speaker already=${if (enabled) "on" else "off"}")
            return success(enabled, already = true)
        }

        val clicked = when {
            directControl != null -> {
                AccessibilityLogger.node("call_speaker direct=${label(directControl)} id=${directControl.viewIdResourceName.orEmpty()}")
                actions.clickNode(directControl)
            }
            else -> openAudioRouteAndChooseSpeaker(enabled)
        }

        if (!clicked) {
            return AutomationResult.failure(
                "SPEAKER_CONTROL_NOT_FOUND",
                "I couldn't find a usable Speaker or Audio output control on the current call screen."
            )
        }

        SystemClock.sleep(180)
        val verified = waiter.waitUntil(4500, 150) { currentRoot ->
            val currentControl = findSpeakerControl(currentRoot)
            val uiState = currentControl?.let(::speakerState)
            val systemState = systemSpeakerState()
            if (uiState == enabled || systemState == enabled) true else null
        } == true

        if (!verified) {
            AccessibilityLogger.error("call_speaker state verification failed target=$enabled")
            return AutomationResult.failure(
                "SPEAKER_NOT_VERIFIED",
                "I changed the call audio control, but I couldn't verify the speaker state, so I won't claim it succeeded."
            )
        }

        AccessibilityLogger.verify("call_speaker verified=${if (enabled) "on" else "off"}")
        return success(enabled, already = false)
    }

    private fun openAudioRouteAndChooseSpeaker(enabled: Boolean): Boolean {
        if (!enabled) return false
        val root = service.rootInActiveWindow ?: return false
        val routeControl = findAudioRouteControl(root) ?: return false
        if (!actions.clickNode(routeControl)) return false
        AccessibilityLogger.action("call_speaker opened audio route chooser")

        val speakerOption = waiter.waitUntil(2500, 120) { currentRoot ->
            findSpeakerOption(currentRoot)
        } ?: return false

        AccessibilityLogger.node("call_speaker route_option=${label(speakerOption)}")
        return actions.clickNode(speakerOption)
    }

    private fun findSpeakerControl(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val raw = AccessibilityNodeFinder.findAll(root) { node ->
            if (!node.isEnabled || !node.isVisibleToUser) return@findAll false
            val value = normalize(label(node))
            val id = normalize(node.viewIdResourceName.orEmpty())
            isSpeakerLabel(value) || id.contains("speaker") || id.contains("speakerphone")
        }

        val clickable = raw.mapNotNull { AccessibilityNodeFinder.findClickableParent(it) ?: it.takeIf { n -> n.isClickable } }
            .filter { it.isEnabled && it.isVisibleToUser }
            .distinctBy(::boundsKey)

        if (clickable.size == 1) return clickable.single()

        val exact = clickable.filter {
            val value = normalize(label(it))
            value == "speaker" || value == "speakerphone" || value == "handsfree"
        }
        return if (exact.size == 1) exact.single() else null
    }

    private fun findAudioRouteControl(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val candidates = AccessibilityNodeFinder.findAll(root) { node ->
            if (!node.isEnabled || !node.isVisibleToUser) return@findAll false
            val value = normalize(label(node))
            val id = normalize(node.viewIdResourceName.orEmpty())
            value == "audio" || value == "audio output" || value == "audio route" ||
                value.startsWith("audio,") || value.startsWith("audio output,") ||
                id.contains("audio_route") || id.contains("audio_output")
        }.mapNotNull { AccessibilityNodeFinder.findClickableParent(it) ?: it.takeIf { n -> n.isClickable } }
            .distinctBy(::boundsKey)

        return candidates.singleOrNull()
    }

    private fun findSpeakerOption(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val candidates = AccessibilityNodeFinder.findAll(root) { node ->
            if (!node.isEnabled || !node.isVisibleToUser) return@findAll false
            val value = normalize(label(node))
            value == "speaker" || value == "speakerphone" || value == "phone speaker" || value == "handsfree"
        }.mapNotNull { AccessibilityNodeFinder.findClickableParent(it) ?: it.takeIf { n -> n.isClickable } }
            .distinctBy(::boundsKey)
        return candidates.singleOrNull()
    }

    private fun speakerState(node: AccessibilityNodeInfo): Boolean? {
        val value = normalize(label(node))
        if (value.contains("speaker on") || value.contains("speakerphone on") ||
            value.contains("speaker, on") || value.contains("speakerphone, on") ||
            value.contains("speaker selected") || value.contains("speakerphone selected") ||
            value.contains("handsfree on") || value.contains("audio output, speaker")) return true

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

    @Suppress("DEPRECATION")
    private fun systemSpeakerState(): Boolean? = runCatching { audioManager.isSpeakerphoneOn }.getOrNull()

    private fun isSpeakerLabel(value: String): Boolean =
        value == "speaker" || value == "speakerphone" || value == "handsfree" ||
            value.startsWith("speaker,") || value.startsWith("speaker ") ||
            value.startsWith("speakerphone,") || value.startsWith("speakerphone ") ||
            value.startsWith("handsfree,") || value == "phone speaker"

    private fun success(enabled: Boolean, already: Boolean): AutomationResult = AutomationResult.success(
        if (enabled) {
            if (already) "SPEAKER_ALREADY_ON" else "SPEAKER_ON"
        } else {
            if (already) "SPEAKER_ALREADY_OFF" else "SPEAKER_OFF"
        },
        if (enabled) "Mama, speaker is on." else "Mama, speaker is off."
    )

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
