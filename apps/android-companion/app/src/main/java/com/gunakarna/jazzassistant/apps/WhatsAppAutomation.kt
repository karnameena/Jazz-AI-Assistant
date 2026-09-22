package com.gunakarna.jazzassistant.apps

import android.accessibilityservice.AccessibilityService
import android.os.SystemClock
import com.gunakarna.jazzassistant.accessibility.AccessibilityActions
import com.gunakarna.jazzassistant.accessibility.AccessibilityLogger
import com.gunakarna.jazzassistant.accessibility.AccessibilityNodeFinder
import com.gunakarna.jazzassistant.accessibility.UiWaiter
import com.gunakarna.jazzassistant.automation.AutomationResult
import java.util.Locale

class WhatsAppAutomation(
    private val service: AccessibilityService,
    private val launcher: AppLauncher,
    private val actions: AccessibilityActions,
    private val waiter: UiWaiter
) {
    private val packageName = "com.whatsapp"

    fun searchContact(contact: String): AutomationResult = run(contact, null, false)

    fun sendMessage(contact: String, message: String): AutomationResult = run(contact, message, true)

    private fun run(contact: String, message: String?, send: Boolean): AutomationResult {
        if (contact.isBlank()) return AutomationResult.failure("CONTACT_NOT_FOUND", "A WhatsApp contact name is required.")
        if (send && message.isNullOrBlank()) return AutomationResult.failure("TEXT_NOT_ENTERED", "A message is required.")

        AccessibilityLogger.info("Intent: ${if (send) "whatsapp_message" else "whatsapp_search"}")
        AccessibilityLogger.info("Opening WhatsApp")

        val openResult = launcher.launchByName("WhatsApp")
        if (openResult["ok"] != true) {
            return AutomationResult.failure("APP_NOT_INSTALLED", openResult["error"]?.toString() ?: "WhatsApp is not installed.")
        }
        if (waiter.waitForPackage(packageName, 6000) == null) {
            return AutomationResult.failure("TIMEOUT", "WhatsApp did not become visible in time.")
        }

        val root = service.rootInActiveWindow ?: return AutomationResult.failure("WRONG_SCREEN", "WhatsApp has no active accessibility window.")
        val searchNode = AccessibilityNodeFinder.findNodeByContentDescription(root, "Search", false)
            ?: AccessibilityNodeFinder.findNodeByText(root, "Search", false)
        if (!actions.clickNode(searchNode)) {
            return AutomationResult.failure("NODE_NOT_FOUND", "WhatsApp Search button was not found.")
        }
        AccessibilityLogger.info("Search button found")

        val searchField = waiter.waitForEditable(3500)
            ?: return AutomationResult.failure("NODE_NOT_FOUND", "WhatsApp search field was not found.")
        if (!actions.setText(searchField, contact)) {
            return AutomationResult.failure("TEXT_NOT_ENTERED", "Could not enter the WhatsApp contact name.")
        }
        AccessibilityLogger.info("Searching: $contact")
        SystemClock.sleep(650)

        val searchRoot = service.rootInActiveWindow ?: return AutomationResult.failure("WRONG_SCREEN", "WhatsApp search results are not visible.")
        val exactMatches = AccessibilityNodeFinder.findNodesByText(searchRoot, contact, true)
            .filter { normalize(it.text?.toString().orEmpty()) == normalize(contact) }
            .distinctBy {
                val rect = android.graphics.Rect().also(it::getBoundsInScreen)
                "${rect.left}:${rect.top}:${rect.right}:${rect.bottom}"
            }

        if (exactMatches.size > 1) {
            AccessibilityLogger.warn("Contact ambiguous: $contact")
            return AutomationResult.failure(
                "CONTACT_AMBIGUOUS",
                "Multiple visible WhatsApp contacts match $contact. I stopped before opening or sending.",
                mapOf("matches" to exactMatches.size)
            )
        }

        val contactNode = exactMatches.firstOrNull()
            ?: AccessibilityNodeFinder.findNodeByText(searchRoot, contact, false)
            ?: return AutomationResult.failure("CONTACT_FOUND", "WhatsApp contact '$contact' was not found.")

        if (!actions.clickNode(contactNode)) {
            return AutomationResult.failure("NODE_NOT_FOUND", "The WhatsApp contact result could not be opened.")
        }
        AccessibilityLogger.info("Contact matched: $contact")
        SystemClock.sleep(700)

        if (!send) {
            AccessibilityLogger.info("Chat opened")
            return AutomationResult.success("CHAT_OPENED", "Opened WhatsApp chat with $contact.", mapOf("contact" to contact))
        }

        val messageField = waiter.waitForEditable(4500)
            ?: return AutomationResult.failure("NODE_NOT_FOUND", "WhatsApp message field was not found after opening $contact.")
        if (!actions.setText(messageField, message!!)) {
            return AutomationResult.failure("TEXT_NOT_ENTERED", "Could not enter the WhatsApp message.")
        }
        AccessibilityLogger.info("Message entered")
        SystemClock.sleep(250)

        val chatRoot = service.rootInActiveWindow ?: return AutomationResult.failure("WRONG_SCREEN", "WhatsApp chat is not active.")
        val sendNode = AccessibilityNodeFinder.findNodeByContentDescription(chatRoot, "Send", true)
            ?: AccessibilityNodeFinder.findNodeByContentDescription(chatRoot, "Send", false)
            ?: AccessibilityNodeFinder.findNodeByText(chatRoot, "Send", true)
        if (!actions.clickNode(sendNode)) {
            return AutomationResult.failure("NODE_NOT_FOUND", "WhatsApp Send button was not found. Message was typed but not sent.")
        }
        AccessibilityLogger.info("Message sent")
        return AutomationResult.success(
            "MESSAGE_SENT",
            "Sent WhatsApp message to $contact.",
            mapOf("contact" to contact, "message" to message)
        )
    }

    private fun normalize(value: String): String = value.lowercase(Locale.ROOT).replace(Regex("\\s+"), " ").trim()
}
