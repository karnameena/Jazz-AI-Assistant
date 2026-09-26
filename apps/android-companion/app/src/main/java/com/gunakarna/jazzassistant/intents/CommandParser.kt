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

        parseSystemCommand(text)?.let { return it }
        parseWhatsApp(text)?.let { return it }

        when {
            text.matches(Regex("(?i)^(go\\s+)?back(?:\\s+one\\s+step)?[.!? ]*$")) -> return sequence(ActionStep("back"))
            text.matches(Regex("(?i)^(go\\s+)?home(\\s+screen)?[.!? ]*$")) -> return sequence(ActionStep("home"))
            text.matches(Regex("(?i)^(open\\s+)?recent\\s+apps[.!? ]*$")) -> return sequence(ActionStep("recents"))
            text.matches(Regex("(?i)^open\\s+notifications[.!? ]*$")) -> return sequence(ActionStep("notifications"))
            text.matches(Regex("(?i)^(?:like|heart)(?:\\s+(?:this|the|current))?\\s+(?:reel|video)[.!? ]*$")) -> return ParsedCommand("instagram_like")
            text.matches(Regex("(?i)^double\\s+tap(?:\\s+(?:this|the|current))?\\s+(?:reel|video)[.!? ]*$")) -> return ParsedCommand("instagram_like")
            text.matches(Regex("(?i)^open\\s+instagram(?:\\s+(?:reel|reels|video|videos))[.!? ]*$")) -> return ParsedCommand(
                "android_sequence",
                plan = ActionPlan(steps = listOf(
                    ActionStep("open_app", mapOf("app" to "Instagram"), "Open Instagram"),
                    ActionStep("click_text", mapOf("text" to "Reels"), "Open Reels")
                ))
            )
            text.matches(Regex("(?i)^(?:scroll|swipe)\\s+(up|down)(?:\\s+(one|two|three|four|five|\\d+)\\s+times?)?[.!? ]*$")) -> {
                val match = Regex("(?i)^(?:scroll|swipe)\\s+(up|down)(?:\\s+(one|two|three|four|five|\\d+)\\s+times?)?[.!? ]*$").find(text)!!
                val direction = match.groupValues[1].lowercase()
                val count = wordNumber(match.groupValues.getOrElse(2) { "" }).coerceIn(1, 10)
                return ParsedCommand("android_sequence", plan = ActionPlan(steps = List(count) { ActionStep(if (direction == "up") "scroll_up" else "scroll_down") }))
            }
            text.matches(Regex("(?i)^(?:swipe|scroll)\\s+left[.!? ]*$")) -> return sequence(ActionStep("swipe_left"))
            text.matches(Regex("(?i)^(?:swipe|scroll)\\s+right[.!? ]*$")) -> return sequence(ActionStep("swipe_right"))
            text.matches(Regex("(?i)^(?:click|tap|press)\\s+(?:the\\s+)?x(?:\\s+button)?[.!? ]*$")) -> return sequence(ActionStep("click_text", mapOf("text" to "Close"), "Close current control"))
            text.matches(Regex("(?i)^close\\s+(?:this\\s+)?(?:popup|dialog|ad)[.!? ]*$")) -> return sequence(ActionStep("click_text", mapOf("text" to "Close"), "Close current popup"))
            text.matches(Regex("(?i)^(tap|click|press)\\s+.+$")) -> {
                val label = cleanArg(text.substringAfter(" ").replaceFirst(Regex("(?i)^the\\s+"), ""))
                return sequence(ActionStep("click_text", mapOf("text" to label)))
            }
            text.matches(Regex("(?i)^long\\s+press\\s+.+$")) -> {
                val label = cleanArg(text.replaceFirst(Regex("(?i)^long\\s+press\\s+"), ""))
                return sequence(ActionStep("long_click_text", mapOf("text" to label)))
            }
            text.matches(Regex("(?i)^type\\s+.+$")) -> {
                val value = cleanArg(text.replaceFirst(Regex("(?i)^type\\s+"), ""), preserveSentencePunctuation = true).trim('"', '\'')
                return sequence(ActionStep("set_text", mapOf("text" to value)))
            }
            text.matches(Regex("(?i)^search(?:\\s+for)?\\s+.+$")) -> {
                val value = cleanArg(text.replaceFirst(Regex("(?i)^search(?:\\s+for)?\\s+"), ""))
                return sequence(ActionStep("search_ui", mapOf("text" to value)))
            }
            text.matches(Regex("(?i)^clear\\s+text[.!? ]*$")) -> return sequence(ActionStep("clear_text"))
            text.matches(Regex("(?i)^close\\s+.+$")) -> {
                val app = cleanArg(text.replaceFirst(Regex("(?i)^close\\s+"), ""))
                return sequence(ActionStep("close_app", mapOf("app" to app)))
            }
        }

        parseOpenSequence(text)?.let { return it }
        return null
    }

    private fun parseSystemCommand(text: String): ParsedCommand? {
        return when {
            text.matches(Regex("(?i)^(?:put|turn|switch)(?:\\s+the)?\\s+speaker(?:phone)?\\s+on[.!? ]*$")) -> ParsedCommand("speaker_on")
            text.matches(Regex("(?i)^(?:speaker|speakerphone)\\s+on[.!? ]*$")) -> ParsedCommand("speaker_on")
            text.matches(Regex("(?i)^(?:put|turn|switch)(?:\\s+the)?\\s+speaker(?:phone)?\\s+off[.!? ]*$")) -> ParsedCommand("speaker_off")
            text.matches(Regex("(?i)^(?:speaker|speakerphone)\\s+off[.!? ]*$")) -> ParsedCommand("speaker_off")
            text.matches(Regex("(?i)^(?:pause|pause\\s+(?:it|music|media|this))[.!? ]*$")) -> ParsedCommand("media_pause")
            text.matches(Regex("(?i)^(?:play|resume|play\\s+(?:it|music|media|again))[.!? ]*$")) -> ParsedCommand("media_play")
            text.matches(Regex("(?i)^(?:next\\s+(?:song|track)|skip\\s+(?:song|track))[.!? ]*$")) -> ParsedCommand("media_next")
            text.matches(Regex("(?i)^(?:previous\\s+(?:song|track)|previous)[.!? ]*$")) -> ParsedCommand("media_previous")
            text.matches(Regex("(?i)^(?:increase|raise|turn\\s+up)\\s+(?:the\\s+)?volume[.!? ]*$")) -> ParsedCommand("volume_up")
            text.matches(Regex("(?i)^(?:decrease|lower|turn\\s+down)\\s+(?:the\\s+)?volume[.!? ]*$")) -> ParsedCommand("volume_down")
            text.matches(Regex("(?i)^mute(?:\\s+(?:the\\s+)?(?:phone|media|volume))?[.!? ]*$")) -> ParsedCommand("mute")
            text.matches(Regex("(?i)^unmute(?:\\s+(?:the\\s+)?(?:phone|media|volume))?[.!? ]*$")) -> ParsedCommand("unmute")
            text.matches(Regex("(?i)^(?:turn\\s+)?(?:the\\s+)?flash(?:light)?\\s+on[.!? ]*$")) -> ParsedCommand("flashlight_on")
            text.matches(Regex("(?i)^(?:turn\\s+)?(?:the\\s+)?flash(?:light)?\\s+off[.!? ]*$")) -> ParsedCommand("flashlight_off")
            text.matches(Regex("(?i)^(?:answer|answer\\s+the\\s+call)[.!? ]*$")) -> ParsedCommand("answer_call")
            text.matches(Regex("(?i)^(?:end|hang\\s+up|end\\s+the\\s+call)[.!? ]*$")) -> ParsedCommand("end_call")
            Regex("(?i)^call\\s+(.+?)[.!? ]*$").find(text) != null -> {
                val match = Regex("(?i)^call\\s+(.+?)[.!? ]*$").find(text)!!
                ParsedCommand("call_contact", mapOf("contact" to cleanArg(match.groupValues[1])))
            }
            else -> null
        }
    }

    private fun parseWhatsApp(text: String): ParsedCommand? {
        val normalized = text.replace(Regex("(?i)^open\\s+whats\\s*app[,;]\\s*"), "Open WhatsApp and ")

        val sendQuoted = Regex("(?i)^send\\s+(.+?)\\s+[\"'](.+?)[\"']$").find(normalized)
        if (sendQuoted != null) {
            val contact = cleanArg(sendQuoted.groupValues[1])
            val message = sendQuoted.groupValues[2]
            return ParsedCommand("whatsapp_message", mapOf("contact" to contact, "message" to message, "send" to true))
        }

        val colonMessage = Regex("(?i)^(?:send|message|text)\\s+(.+?)\\s*:\\s*(.+)$").find(normalized)
        if (colonMessage != null) {
            return ParsedCommand(
                "whatsapp_message",
                mapOf("contact" to cleanArg(colonMessage.groupValues[1]), "message" to colonMessage.groupValues[2].trim(), "send" to true)
            )
        }

        val typedOnly = Regex("(?i)^open\\s+whats\\s*app\\s+and\\s+search(?:\\s+for)?\\s+(.+?)\\s+and\\s+type\\s+(.+)$").find(normalized)
        if (typedOnly != null) {
            val contact = cleanArg(typedOnly.groupValues[1])
            val value = cleanArg(typedOnly.groupValues[2], preserveSentencePunctuation = true).trim('"', '\'')
            return ParsedCommand("android_sequence", plan = ActionPlan(steps = listOf(
                ActionStep("open_app", mapOf("app" to "WhatsApp")),
                ActionStep("whatsapp_search", mapOf("contact" to contact)),
                ActionStep("set_text", mapOf("text" to value))
            )))
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
                message = cleanArg(match.groupValues[1], preserveSentencePunctuation = true)
                contact = cleanArg(match.groupValues[2])
            } else {
                contact = cleanArg(match.groupValues[1])
                message = cleanArg(match.groupValues[2], preserveSentencePunctuation = true).trim('"', '\'')
            }
            if (contact.isNotBlank() && message.isNotBlank()) return ParsedCommand("whatsapp_message", mapOf("contact" to contact, "message" to message, "send" to true))
        }

        val search = Regex("(?i)^(?:open\\s+)?whats\\s*app(?:\\s+and)?\\s+(?:search|search\\s+for)\\s+(.+)$").find(normalized)
            ?: Regex("(?i)^search\\s+(.+?)\\s+on\\s+whats\\s*app$").find(normalized)
        if (search != null) return ParsedCommand("whatsapp_search", mapOf("contact" to cleanArg(search.groupValues[1]), "send" to false))
        return null
    }

    private fun parseOpenSequence(text: String): ParsedCommand? {
        val openMatch = Regex("(?i)^open\\s+(.+?)(?:\\s+and\\s+(.+))?[.!? ]*$").find(text) ?: return null
        val app = cleanArg(openMatch.groupValues[1])
        val tail = openMatch.groupValues.getOrElse(2) { "" }.trim()
        if (app.isBlank()) return null

        val steps = mutableListOf(ActionStep("open_app", mapOf("app" to app), "Open $app"))
        if (tail.isBlank()) return ParsedCommand("android_sequence", plan = ActionPlan(steps = steps))

        val search = Regex("(?i)^search(?:\\s+for)?\\s+(.+?)[.!? ]*$").find(tail)
        if (search != null) {
            val query = cleanArg(search.groupValues[1])
            steps += ActionStep("search_ui", mapOf("text" to query), "Search $query")
            return ParsedCommand("android_sequence", plan = ActionPlan(steps = steps))
        }

        val scroll = Regex("(?i)^(?:scroll|swipe)\\s+(up|down)(?:\\s+(one|two|three|four|five|\\d+)\\s+times?)?[.!? ]*$").find(tail)
        if (scroll != null) {
            val direction = scroll.groupValues[1].lowercase()
            val count = wordNumber(scroll.groupValues.getOrElse(2) { "" }).coerceIn(1, 10)
            repeat(count) { steps += ActionStep(if (direction == "up") "scroll_up" else "scroll_down") }
            return ParsedCommand("android_sequence", plan = ActionPlan(steps = steps))
        }

        val reels = Regex("(?i)^scroll\\s+(one|two|three|four|five|\\d+)\\s+reels?[.!? ]*$").find(tail)
        if (reels != null) {
            val count = wordNumber(reels.groupValues[1]).coerceIn(1, 10)
            repeat(count) { steps += ActionStep("scroll_up") }
            return ParsedCommand("android_sequence", plan = ActionPlan(steps = steps))
        }

        val click = Regex("(?i)^(?:open|tap|click|press)\\s+(.+?)[.!? ]*$").find(tail)
        if (click != null) {
            steps += ActionStep("click_text", mapOf("text" to cleanArg(click.groupValues[1])))
            return ParsedCommand("android_sequence", plan = ActionPlan(steps = steps))
        }

        return ParsedCommand("android_sequence", plan = ActionPlan(steps = steps))
    }

    private fun sequence(vararg steps: ActionStep) = ParsedCommand("android_sequence", plan = ActionPlan(steps = steps.toList()))

    private fun cleanArg(value: String, preserveSentencePunctuation: Boolean = false): String {
        val trimmed = value.trim()
        return if (preserveSentencePunctuation) trimmed else trimmed.trimEnd(' ', '.', ',', '!', '?', ';', ':')
    }

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
