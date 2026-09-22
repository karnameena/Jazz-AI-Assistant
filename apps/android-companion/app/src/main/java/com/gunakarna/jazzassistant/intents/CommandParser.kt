package com.gunakarna.jazzassistant.intents

import com.gunakarna.jazzassistant.automation.ActionPlan
import com.gunakarna.jazzassistant.automation.ActionStep

object CommandParser {
    data class ParsedCommand(
        val intent: String,
        val args: Map<String, Any?> = emptyMap(),
        val plan: ActionPlan? = null
    )

    fun parse(raw: String): ParsedCommand? {
        val text = raw.trim()
            .replace(Regex("(?i)^(hey\\s+)?jazz[,\\s:-]*"), "")
            .trim()
        if (text.isBlank()) return null

        parseWhatsApp(text)?.let { return it }

        when {
            text.matches(Regex("(?i)^(go\\s+)?back$")) -> return sequence(ActionStep("back"))
            text.matches(Regex("(?i)^(go\\s+)?home(\\s+screen)?$")) -> return sequence(ActionStep("home"))
            text.matches(Regex("(?i)^(open\\s+)?recent\\s+apps$")) -> return sequence(ActionStep("recents"))
            text.matches(Regex("(?i)^open\\s+notifications$")) -> return sequence(ActionStep("notifications"))
            text.matches(Regex("(?i)^(?:scroll|swipe)\\s+(up|down)$")) -> {
                val direction = Regex("(?i)^(?:scroll|swipe)\\s+(up|down)$").find(text)!!.groupValues[1].lowercase()
                return sequence(ActionStep(if (direction == "down") "scroll_forward" else "scroll_backward"))
            }
            text.matches(Regex("(?i)^(tap|click)\\s+.+$")) -> {
                val label = text.substringAfter(" ").trim()
                return sequence(ActionStep("click_text", mapOf("text" to label)))
            }
            text.matches(Regex("(?i)^long\\s+press\\s+.+$")) -> {
                val label = text.replaceFirst(Regex("(?i)^long\\s+press\\s+"), "").trim()
                return sequence(ActionStep("long_click_text", mapOf("text" to label)))
            }
            text.matches(Regex("(?i)^type\\s+.+$")) -> {
                val value = text.replaceFirst(Regex("(?i)^type\\s+"), "").trim().trim('"', '\'')
                return sequence(ActionStep("set_text", mapOf("text" to value)))
            }
            text.matches(Regex("(?i)^clear\\s+text$")) -> return sequence(ActionStep("clear_text"))
        }

        parseOpenSequence(text)?.let { return it }
        return null
    }

    private fun parseWhatsApp(text: String): ParsedCommand? {
        val normalized = text.replace(Regex("(?i)^open\\s+whats\\s*app[,;]\\s*"), "Open WhatsApp and ")

        val typedOnly = Regex("(?i)^open\\s+whats\\s*app\\s+and\\s+search(?:\\s+for)?\\s+(.+?)\\s+and\\s+type\\s+(.+)$").find(normalized)
        if (typedOnly != null) {
            val contact = typedOnly.groupValues[1].trim()
            val value = typedOnly.groupValues[2].trim().trim('"', '\'')
            return ParsedCommand(
                "android_sequence",
                plan = ActionPlan(steps = listOf(
                    ActionStep("open_app", mapOf("app" to "WhatsApp")),
                    ActionStep("whatsapp_search", mapOf("contact" to contact)),
                    ActionStep("set_text", mapOf("text" to value))
                ))
            )
        }

        val messagePatterns = listOf(
            Regex("(?i)^(?:open\\s+)?whats\\s*app(?:\\s+and)?\\s+(?:message|text)\\s+(.+?)\\s+(?:saying|say|that|tell(?:\\s+him|\\s+her)?)\\s+(.+)$"),
            Regex("(?i)^message\\s+(.+?)\\s+(.+)$"),
            Regex("(?i)^whats\\s*app\\s+(.+?)\\s+and\\s+tell(?:\\s+him|\\s+her)?\\s+(.+)$"),
            Regex("(?i)^send\\s+[\"'](.+?)[\"']\\s+to\\s+(.+?)\\s+on\\s+whats\\s*app$")
        )
        messagePatterns.forEachIndexed { index, pattern ->
            val match = pattern.find(normalized) ?: return@forEachIndexed
            val contact: String
            val message: String
            if (index == 3) {
                message = match.groupValues[1].trim()
                contact = match.groupValues[2].trim()
            } else {
                contact = match.groupValues[1].trim()
                message = match.groupValues[2].trim().trim('"', '\'')
            }
            if (contact.isNotBlank() && message.isNotBlank()) {
                return ParsedCommand("whatsapp_message", mapOf("contact" to contact, "message" to message, "send" to true))
            }
        }

        val search = Regex("(?i)^(?:open\\s+)?whats\\s*app(?:\\s+and)?\\s+(?:search|search\\s+for)\\s+(.+)$").find(normalized)
            ?: Regex("(?i)^search\\s+(.+?)\\s+on\\s+whats\\s*app$").find(normalized)
        if (search != null) {
            val contact = search.groupValues[1].trim()
            return ParsedCommand("whatsapp_search", mapOf("contact" to contact, "send" to false))
        }
        return null
    }

    private fun parseOpenSequence(text: String): ParsedCommand? {
        val openMatch = Regex("(?i)^open\\s+(.+?)(?:\\s+and\\s+(.+))?$").find(text) ?: return null
        val app = openMatch.groupValues[1].trim()
        val tail = openMatch.groupValues.getOrElse(2) { "" }.trim()
        val steps = mutableListOf(ActionStep("open_app", mapOf("app" to app), "Open $app"))
        if (tail.isBlank()) return ParsedCommand("android_sequence", plan = ActionPlan(steps = steps))

        val search = Regex("(?i)^search(?:\\s+for)?\\s+(.+)$").find(tail)
        if (search != null) {
            val query = search.groupValues[1].trim()
            steps += ActionStep("search_ui", mapOf("text" to query), "Search $query")
            return ParsedCommand("android_sequence", plan = ActionPlan(steps = steps))
        }

        val scroll = Regex("(?i)^(?:scroll|swipe)\\s+(up|down)(?:\\s+(one|two|three|four|five|\\d+)\\s+times?)?$").find(tail)
        if (scroll != null) {
            val direction = scroll.groupValues[1].lowercase()
            val count = wordNumber(scroll.groupValues.getOrElse(2) { "" }).coerceIn(1, 10)
            repeat(count) { steps += ActionStep(if (direction == "down") "scroll_forward" else "scroll_backward") }
            return ParsedCommand("android_sequence", plan = ActionPlan(steps = steps))
        }

        val click = Regex("(?i)^(?:open|tap|click)\\s+(.+)$").find(tail)
        if (click != null) {
            steps += ActionStep("click_text", mapOf("text" to click.groupValues[1].trim()))
            return ParsedCommand("android_sequence", plan = ActionPlan(steps = steps))
        }

        return ParsedCommand("android_sequence", plan = ActionPlan(steps = steps))
    }

    private fun sequence(vararg steps: ActionStep) = ParsedCommand("android_sequence", plan = ActionPlan(steps = steps.toList()))

    private fun wordNumber(value: String): Int = when (value.lowercase()) {
        "one" -> 1
        "two" -> 2
        "three" -> 3
        "four" -> 4
        "five" -> 5
        "" -> 1
        else -> value.toIntOrNull() ?: 1
    }
}
