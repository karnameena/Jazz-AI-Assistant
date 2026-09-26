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
        val requestedContact = contact.trim()
        if (requestedContact.isBlank()) return AutomationResult.failure("CONTACT_NOT_FOUND", "A WhatsApp contact name is required.")
        if (send && message.isNullOrEmpty()) return AutomationResult.failure("TEXT_NOT_ENTERED", "A message is required.")

        AccessibilityLogger.intent(if (send) "whatsapp_message" else "whatsapp_search")
        AccessibilityLogger.action("whatsapp open")

        val openResult = launcher.launchByName("WhatsApp")
        if (openResult["ok"] != true) {
            return AutomationResult.failure("APP_NOT_INSTALLED", openResult["error"]?.toString() ?: "WhatsApp is not installed.")
        }
        if (waiter.waitForPackage(packageName, 7000) == null) {
            return AutomationResult.failure("TIMEOUT", "WhatsApp did not become visible in time.")
        }

        val searchField = openSearchAndGetField()
            ?: return AutomationResult.failure(
                "NODE_NOT_FOUND",
                "I couldn't find or open WhatsApp Search on the current screen."
            )

        if (!actions.setText(searchField, requestedContact)) {
            return AutomationResult.failure("TEXT_NOT_ENTERED", "Could not enter the WhatsApp contact name.")
        }
        AccessibilityLogger.action("whatsapp search contact=${safeContact(requestedContact)}")

        val resultsRoot = waiter.waitUntil(4500, 180) { root ->
            root.takeIf {
                it.packageName?.toString() == packageName && exactContactNodes(it, requestedContact).isNotEmpty()
            }
        } ?: return AutomationResult.failure(
            "CONTACT_NOT_FOUND",
            "No visible WhatsApp result exactly matched '$requestedContact'. I stopped instead of choosing a similar contact."
        )

        val exactMatches = exactContactNodes(resultsRoot, requestedContact)
        if (exactMatches.size > 1) {
            AccessibilityLogger.warn("WhatsApp contact ambiguous: ${safeContact(requestedContact)}")
            return AutomationResult.failure(
                "CONTACT_AMBIGUOUS",
                "Multiple visible WhatsApp contacts match $requestedContact. I stopped before opening or sending.",
                mapOf("matches" to exactMatches.size)
            )
        }

        val contactNode = exactMatches.singleOrNull()
            ?: return AutomationResult.failure("CONTACT_NOT_FOUND", "No exact WhatsApp contact matched '$requestedContact'.")
        if (!actions.clickNode(contactNode)) {
            return AutomationResult.failure("NODE_NOT_FOUND", "The WhatsApp contact result could not be opened.")
        }

        val chatRoot = waiter.waitUntil(5000, 180) { root ->
            root.takeIf { it.packageName?.toString() == packageName && chatMatchesContact(it, requestedContact) }
        } ?: return AutomationResult.failure(
            "CONTACT_NOT_VERIFIED",
            "WhatsApp opened a screen, but I could not verify that it is $requestedContact's chat. I stopped."
        )
        AccessibilityLogger.verify("whatsapp chat verified contact=${safeContact(requestedContact)}")

        if (!send) {
            return AutomationResult.success("CHAT_OPENED", "Mama, opened WhatsApp chat with $requestedContact.", mapOf("contact" to requestedContact))
        }

        val exactMessage = message!! // Keep the caller's exact message. Never rewrite/paraphrase it.
        val messageField = findMessageField(chatRoot)
            ?: waiter.waitForEditable(4000)
            ?: return AutomationResult.failure("NODE_NOT_FOUND", "WhatsApp message field was not found after opening $requestedContact.")

        if (!actions.setText(messageField, exactMessage)) {
            return AutomationResult.failure("TEXT_NOT_ENTERED", "Could not enter the WhatsApp message.")
        }

        val typedVerified = waiter.waitUntil(2500, 120) { root ->
            val field = findMessageField(root) ?: return@waitUntil null
            if (field.text?.toString() == exactMessage) true else null
        } == true
        if (!typedVerified) {
            return AutomationResult.failure(
                "TEXT_NOT_VERIFIED",
                "I entered the WhatsApp message, but the text on screen did not exactly match what you dictated, so I did not send it."
            )
        }
        AccessibilityLogger.verify("whatsapp exact message verified before send")

        val beforeSendRoot = service.rootInActiveWindow
            ?: return AutomationResult.failure("WRONG_SCREEN", "WhatsApp chat is not active.")
        val sendNode = findSendNode(beforeSendRoot)
            ?: return AutomationResult.failure("NODE_NOT_FOUND", "WhatsApp Send button was not found. Message was typed but not sent.")
        if (!actions.clickNode(sendNode)) {
            return AutomationResult.failure("SEND_FAILED", "I found WhatsApp Send, but Android did not complete the click.")
        }

        val sentVerified = waiter.waitUntil(4000, 180) { root ->
            if (root.packageName?.toString() != packageName) return@waitUntil null
            val field = findMessageField(root)
            val fieldCleared = field == null || field.text.isNullOrEmpty()
            val messageVisible = AccessibilityNodeFinder.findNodesByText(root, exactMessage, true)
                .any { normalize(it.text?.toString().orEmpty()) == normalize(exactMessage) }
            if (fieldCleared || messageVisible) true else null
        } == true

        if (!sentVerified) {
            return AutomationResult.failure(
                "SEND_NOT_VERIFIED",
                "I pressed WhatsApp Send, but I could not verify that the exact message was sent."
            )
        }

        AccessibilityLogger.verify("whatsapp message send verified contact=${safeContact(requestedContact)}")
        return AutomationResult.success(
            "MESSAGE_SENT",
            "Mama, sent your exact message to $requestedContact.",
            mapOf("contact" to requestedContact)
        )
    }

    private fun openSearchAndGetField(): AccessibilityNodeInfo? {
        service.rootInActiveWindow?.let { root ->
            if (root.packageName?.toString() == packageName) {
                findSearchField(root)?.let { return it }
            }
        }

        repeat(3) { attempt ->
            val root = service.rootInActiveWindow ?: return@repeat
            if (root.packageName?.toString() != packageName) return@repeat

            val searchNode = findSearchControl(root)
            if (searchNode != null && actions.clickNode(searchNode)) {
                AccessibilityLogger.action("whatsapp search control clicked attempt=${attempt + 1}")
                waiter.waitUntil(2500, 120) { current ->
                    if (current.packageName?.toString() != packageName) null else findSearchField(current)
                }?.let { return it }
            }
            SystemClock.sleep(250)
        }
        return null
    }

    private fun findSearchControl(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val ids = listOf(
            "com.whatsapp:id/menuitem_search",
            "com.whatsapp:id/search",
            "com.whatsapp:id/search_bar",
            "com.whatsapp:id/search_button"
        )
        ids.firstNotNullOfOrNull { AccessibilityNodeFinder.findByViewId(root, it) }?.let { return it }

        AccessibilityNodeFinder.findBestActionNode(root, "Search")?.let { return it }

        val semanticCandidates = AccessibilityNodeFinder.findAll(root) { node ->
            if (!node.isVisibleToUser || !node.isEnabled) return@findAll false
            val id = node.viewIdResourceName.orEmpty().lowercase(Locale.ROOT)
            val desc = node.contentDescription?.toString().orEmpty().lowercase(Locale.ROOT)
            val text = node.text?.toString().orEmpty().lowercase(Locale.ROOT)
            id.contains("search") || desc == "search" || desc.startsWith("search,") || text == "search"
        }.mapNotNull { AccessibilityNodeFinder.findClickableParent(it) }
            .distinctBy(::boundsKey)

        return semanticCandidates.singleOrNull()
    }

    private fun findSearchField(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val fields = AccessibilityNodeFinder.findEditableFields(root).filter { it.isVisibleToUser && it.isEnabled }
        if (fields.isEmpty()) return null

        val searchFields = fields.filter { node ->
            val id = node.viewIdResourceName.orEmpty().lowercase(Locale.ROOT)
            val desc = node.contentDescription?.toString().orEmpty().lowercase(Locale.ROOT)
            val text = node.text?.toString().orEmpty().lowercase(Locale.ROOT)
            id.contains("search") || desc.contains("search") || text.contains("search")
        }
        return when {
            searchFields.size == 1 -> searchFields.single()
            fields.size == 1 -> fields.single()
            else -> null
        }
    }

    private fun exactContactNodes(root: AccessibilityNodeInfo, contact: String): List<AccessibilityNodeInfo> {
        return AccessibilityNodeFinder.findNodesByText(root, contact, true)
            .filter { it.isVisibleToUser && it.isEnabled && normalize(it.text?.toString().orEmpty()) == normalize(contact) }
            .mapNotNull { AccessibilityNodeFinder.findClickableParent(it) }
            .distinctBy(::boundsKey)
    }

    private fun chatMatchesContact(root: AccessibilityNodeInfo, contact: String): Boolean {
        val exact = AccessibilityNodeFinder.findNodesByText(root, contact, true)
            .any { it.isVisibleToUser && normalize(it.text?.toString().orEmpty()) == normalize(contact) }
        if (!exact) return false
        return findMessageField(root) != null
    }

    private fun findMessageField(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val ids = listOf(
            "com.whatsapp:id/entry",
            "com.whatsapp:id/message_entry",
            "com.whatsapp:id/compose_text"
        )
        ids.firstNotNullOfOrNull { AccessibilityNodeFinder.findByViewId(root, it) }
            ?.takeIf { it.isVisibleToUser && it.isEnabled }
            ?.let { return it }

        val fields = AccessibilityNodeFinder.findEditableFields(root).filter { it.isVisibleToUser && it.isEnabled }
        val likelyMessageFields = fields.filter { node ->
            val id = node.viewIdResourceName.orEmpty().lowercase(Locale.ROOT)
            val desc = node.contentDescription?.toString().orEmpty().lowercase(Locale.ROOT)
            id.contains("entry") || id.contains("message") || desc.contains("message") || desc.contains("type a message")
        }
        return when {
            likelyMessageFields.size == 1 -> likelyMessageFields.single()
            fields.size == 1 -> fields.single()
            else -> null
        }
    }

    private fun findSendNode(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val ids = listOf("com.whatsapp:id/send", "com.whatsapp:id/send_button")
        ids.firstNotNullOfOrNull { AccessibilityNodeFinder.findByViewId(root, it) }?.let { return it }
        return AccessibilityNodeFinder.findBestActionNode(root, "Send")
            ?: AccessibilityNodeFinder.findNodeByContentDescription(root, "Send", true)
            ?: AccessibilityNodeFinder.findNodeByContentDescription(root, "Send", false)
    }

    private fun boundsKey(node: AccessibilityNodeInfo): String {
        val rect = Rect().also(node::getBoundsInScreen)
        return "${rect.left}:${rect.top}:${rect.right}:${rect.bottom}"
    }

    private fun normalize(value: String): String = value.lowercase(Locale.ROOT).replace(Regex("\\s+"), " ").trim()

    private fun safeContact(value: String): String = value.take(80).replace(Regex("[\\r\\n\\t]"), " ")
}
