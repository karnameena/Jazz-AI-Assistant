package com.gunakarna.jazzassistant.automation

data class ActionStep(
    val action: String,
    val args: Map<String, Any?> = emptyMap(),
    val label: String = action
)

data class ActionPlan(
    val intent: String = "android_sequence",
    val steps: List<ActionStep>
)
