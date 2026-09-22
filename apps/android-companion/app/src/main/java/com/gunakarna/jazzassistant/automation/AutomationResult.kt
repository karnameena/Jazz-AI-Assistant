package com.gunakarna.jazzassistant.automation

data class AutomationResult(
    val ok: Boolean,
    val status: String,
    val message: String,
    val details: Map<String, Any?> = emptyMap()
) {
    fun toMap(): Map<String, Any?> = linkedMapOf(
        "ok" to ok,
        "status" to status,
        "message" to message
    ) + details

    companion object {
        fun success(status: String, message: String, details: Map<String, Any?> = emptyMap()) =
            AutomationResult(true, status, message, details)

        fun failure(status: String, message: String, details: Map<String, Any?> = emptyMap()) =
            AutomationResult(false, status, message, details)
    }
}
