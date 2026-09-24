package com.gunakarna.jazzassistant.automation

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import com.gunakarna.jazzassistant.accessibility.AccessibilityActions
import com.gunakarna.jazzassistant.accessibility.AccessibilityLogger
import com.gunakarna.jazzassistant.accessibility.AccessibilityNodeFinder
import com.gunakarna.jazzassistant.accessibility.UiTreeReader
import com.gunakarna.jazzassistant.accessibility.UiWaiter
import com.gunakarna.jazzassistant.apps.AppLauncher
import com.gunakarna.jazzassistant.apps.InstalledAppResolver
import com.gunakarna.jazzassistant.apps.WhatsAppAutomation
import com.gunakarna.jazzassistant.intents.CommandParser

class AndroidAutomationEngine(private val service: AccessibilityService) {
    private val resolver = InstalledAppResolver(service)
    private val launcher = AppLauncher(service, resolver)
    private val actions = AccessibilityActions(service)
    private val waiter = UiWaiter { service.rootInActiveWindow }
    private val treeReader = UiTreeReader()
    private val whatsApp = WhatsAppAutomation(service, launcher, actions, waiter)

    fun listApps(): List<Map<String, String>> = launcher.listApps()

    fun execute(action: String, args: Map<String, Any?> = emptyMap()): Map<String, Any?> = when (action) {
        "open_app", "launch_app_name" -> launcher.launchByName(args["app"]?.toString() ?: args["name"]?.toString().orEmpty())
        "launch_app" -> launcher.launchPackage(args["packageName"]?.toString().orEmpty())
        "close_app" -> backgroundApp(args["app"]?.toString().orEmpty())
        "back" -> simple(actions.pressBack(), "BACK_SUCCESS", "Went back.")
        "home" -> simple(actions.pressHome(), "HOME_SUCCESS", "Android home screen opened.")
        "recents" -> simple(actions.openRecents(), "RECENTS_SUCCESS", "Opened recent apps.")
        "notifications" -> simple(actions.openNotifications(), "NOTIFICATIONS_SUCCESS", "Opened notifications.")
        "click_text" -> clickText(args["text"]?.toString().orEmpty())
        "long_click_text" -> simple(actions.longClickText(args["text"]?.toString().orEmpty()), "CLICK_SUCCESS", "Long press completed.")
        "double_tap_center" -> simple(actions.doubleTapCenter(), "DOUBLE_TAP_SUCCESS", "Double-tapped the reel to like it.")
        "set_text", "type" -> simple(actions.setText(args["text"]?.toString().orEmpty()), "TEXT_ENTERED", "Text entered.")
        "clear_text" -> simple(actions.clearText(), "TEXT_CLEARED", "Text cleared.")
        "scroll_forward", "scroll_down" -> simple(actions.scrollForward(), "SCROLL_SUCCESS", "Scrolled forward.")
        "scroll_backward", "scroll_up" -> simple(actions.scrollBackward(), "SCROLL_SUCCESS", "Scrolled backward.")
        "search_ui" -> searchUi(args["text"]?.toString().orEmpty())
        "read_screen", "dump_ui_tree" -> readUiTree()
        "current_app" -> currentApp()
        "open_url" -> openUrl(args["url"]?.toString().orEmpty())
        "dial_number" -> dialNumber(args["number"]?.toString().orEmpty())
        "whatsapp_search" -> whatsApp.searchContact(args["contact"]?.toString().orEmpty()).toMap()
        "whatsapp_message" -> whatsApp.sendMessage(args["contact"]?.toString().orEmpty(), args["message"]?.toString().orEmpty()).toMap()
        "execute_command" -> executeNaturalCommand(args["command"]?.toString() ?: args["text"]?.toString().orEmpty())
        else -> AutomationResult.failure("ACTION_NOT_ALLOWED", "Unsupported Android action: $action").toMap()
    }

    fun executeNaturalCommand(command: String): Map<String, Any?> {
        val parsed = CommandParser.parse(command)
            ?: return AutomationResult.failure("INTENT_NOT_RECOGNIZED", "I couldn't map that sentence to an Android action.").toMap()
        AccessibilityLogger.info("Intent: ${parsed.intent}")
        return when (parsed.intent) {
            "whatsapp_message" -> whatsApp.sendMessage(parsed.args["contact"]?.toString().orEmpty(), parsed.args["message"]?.toString().orEmpty()).toMap()
            "whatsapp_search" -> whatsApp.searchContact(parsed.args["contact"]?.toString().orEmpty()).toMap()
            "android_sequence" -> executePlan(parsed.plan ?: ActionPlan(steps = emptyList()))
            else -> AutomationResult.failure("INTENT_NOT_RECOGNIZED", "Unsupported Android intent: ${parsed.intent}").toMap()
        }
    }

    fun executeIntent(intent: String, args: Map<String, Any?>): Map<String, Any?> = when (intent) {
        "whatsapp_message" -> whatsApp.sendMessage(args["contact"]?.toString().orEmpty(), args["message"]?.toString().orEmpty()).toMap()
        "whatsapp_search" -> whatsApp.searchContact(args["contact"]?.toString().orEmpty()).toMap()
        else -> execute(intent, args)
    }

    fun executePlan(plan: ActionPlan): Map<String, Any?> {
        if (plan.steps.isEmpty()) return AutomationResult.failure("EMPTY_PLAN", "No Android actions were planned.").toMap()
        val results = mutableListOf<Map<String, Any?>>()
        for (step in plan.steps) {
            AccessibilityLogger.info("Step: ${step.action} ${step.args}")
            val result = execute(step.action, step.args)
            results += mapOf("action" to step.action, "label" to step.label, "result" to result)
            if (result["ok"] != true) {
                AccessibilityLogger.warn("Stopped at ${step.action}: ${result["message"] ?: result["error"]}")
                return AutomationResult.failure(
                    result["status"]?.toString() ?: "STEP_FAILED",
                    result["message"]?.toString() ?: result["error"]?.toString() ?: "Android automation step failed.",
                    mapOf("steps" to results)
                ).toMap()
            }
            SystemClock.sleep(if (step.action == "open_app" || step.action == "launch_app_name") 900 else 250)
        }
        return AutomationResult.success("PLAN_COMPLETED", "Android automation completed.", mapOf("steps" to results)).toMap()
    }

    private fun backgroundApp(appName: String): Map<String, Any?> {
        val current = service.rootInActiveWindow?.packageName?.toString()
        val requested = if (appName.isBlank()) null else resolver.resolve(appName)?.packageName
        if (requested != null && current != null && requested != current) {
            return AutomationResult.failure("WRONG_SCREEN", "$appName is not the current foreground app.").toMap()
        }
        return if (actions.pressHome()) {
            AutomationResult.success("APP_BACKGROUNDED", "Moved ${appName.ifBlank { "the current app" }} to the background. Accessibility cannot force-stop third-party apps.").toMap()
        } else {
            AutomationResult.failure("ACTION_FAILED", "Could not leave the current app.").toMap()
        }
    }

    private fun clickText(text: String): Map<String, Any?> {
        if (text.isBlank()) return AutomationResult.failure("NODE_NOT_FOUND", "Visible text is required.").toMap()
        return simple(actions.clickText(text), "CLICK_SUCCESS", "Clicked '$text'.")
    }

    private fun searchUi(text: String): Map<String, Any?> {
        if (text.isBlank()) return AutomationResult.failure("TEXT_NOT_ENTERED", "Search text is required.").toMap()
        val root = service.rootInActiveWindow ?: return AutomationResult.failure("WRONG_SCREEN", "No active app window.").toMap()
        val searchNode = AccessibilityNodeFinder.findNodeByContentDescription(root, "Search", false)
            ?: AccessibilityNodeFinder.findNodeByText(root, "Search", false)
        if (searchNode != null) {
            actions.clickNode(searchNode)
            SystemClock.sleep(180)
        }
        val field = waiter.waitForEditable(3000)
            ?: return AutomationResult.failure("NODE_NOT_FOUND", "No editable search field was found.").toMap()
        if (!actions.setText(field, text)) return AutomationResult.failure("TEXT_NOT_ENTERED", "Could not enter search text.").toMap()
        return AutomationResult.success("TEXT_ENTERED", "Searched for $text.").toMap()
    }

    private fun readUiTree(): Map<String, Any?> {
        val root = service.rootInActiveWindow ?: return AutomationResult.failure("WRONG_SCREEN", "No active accessibility window.").toMap()
        val items = treeReader.read(root, 500)
        return AutomationResult.success(
            "UI_TREE_READY",
            "Accessibility tree captured.",
            mapOf("package" to root.packageName?.toString(), "items" to items, "compact" to treeReader.compact(root, 200))
        ).toMap()
    }

    private fun currentApp(): Map<String, Any?> {
        val root = service.rootInActiveWindow
        return AutomationResult.success(
            "CURRENT_APP",
            root?.packageName?.toString() ?: "No active app",
            mapOf("packageName" to root?.packageName?.toString())
        ).toMap()
    }

    private fun openUrl(url: String): Map<String, Any?> = try {
        require(Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(url)) { "Only http/https URLs are supported" }
        service.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        AutomationResult.success("OPEN_URL_SUCCESS", "URL opened.", mapOf("url" to url)).toMap()
    } catch (e: Exception) {
        AutomationResult.failure("OPEN_URL_FAILED", e.message ?: "Could not open URL.").toMap()
    }

    private fun dialNumber(number: String): Map<String, Any?> = try {
        val cleaned = number.filter { it.isDigit() || it == '+' }
        require(cleaned.length in 3..20) { "Invalid phone number" }
        service.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$cleaned")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        AutomationResult.success("DIALER_OPENED", "Dialer opened.", mapOf("number" to cleaned)).toMap()
    } catch (e: Exception) {
        AutomationResult.failure("DIALER_FAILED", e.message ?: "Could not open dialer.").toMap()
    }

    private fun simple(ok: Boolean, status: String, message: String): Map<String, Any?> =
        if (ok) AutomationResult.success(status, message).toMap()
        else AutomationResult.failure("NODE_NOT_FOUND", "Action could not be completed on the current screen.").toMap()
}
