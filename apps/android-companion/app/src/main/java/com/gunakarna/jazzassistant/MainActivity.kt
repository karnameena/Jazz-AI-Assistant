package com.gunakarna.jazzassistant

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.UUID

class MainActivity : Activity() {
    private val prefs by lazy { getSharedPreferences("jazz", Context.MODE_PRIVATE) }
    private lateinit var statusView: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val token = prefs.getString("bridge_token", null) ?: UUID.randomUUID().toString().replace("-", "")
            .also { prefs.edit().putString("bridge_token", it).apply() }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 48, 32, 32)
        }
        content.addView(TextView(this).apply { text = "Jazz Android Companion"; textSize = 26f })
        content.addView(TextView(this).apply {
            text = "Local Android automation engine powered by Jazz Accessibility Service."
            textSize = 16f
        })

        statusView = TextView(this).apply {
            textSize = 14f
            setPadding(0, 24, 0, 20)
        }
        content.addView(statusView)

        content.addView(Button(this).apply {
            text = "Open Accessibility Settings"
            setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        })
        content.addView(Button(this).apply {
            text = "Copy Bridge Token"
            setOnClickListener { copyText("Jazz bridge token", token) }
        })
        content.addView(Button(this).apply {
            text = "Copy Current UI Tree"
            setOnClickListener {
                val compact = JazzAccessibilityService.instance?.dumpUiTree()?.get("compact")?.toString()
                    ?: "Accessibility service is not enabled."
                copyText("Jazz accessibility tree", compact)
            }
        })
        content.addView(Button(this).apply {
            text = "Refresh Status"
            setOnClickListener { refreshStatus() }
        })
        content.addView(TextView(this).apply {
            text = "Windows channel: ADB → port forward → Android Companion → Jazz Accessibility Service"
            textSize = 13f
            setPadding(0, 28, 0, 0)
        })

        setContentView(ScrollView(this).apply { addView(content) })
        refreshStatus()
    }

    override fun onResume() {
        super.onResume()
        if (::statusView.isInitialized) refreshStatus()
    }

    private fun refreshStatus() {
        val service = JazzAccessibilityService.instance
        val enabled = isJazzAccessibilityEnabled()
        val currentPackage = service?.rootInActiveWindow?.packageName?.toString()
            ?: service?.lastForegroundPackage
            ?: "Unknown"
        statusView.text = buildString {
            appendLine("Android Companion: Connected")
            appendLine("Accessibility: ${if (enabled) "Enabled" else "Disabled"}")
            appendLine("Jazz local API: ${if (service != null) "Connected" else "Waiting"}")
            appendLine("Current App: $currentPackage")
            append("Automation: ${if (service != null) "Ready" else "Waiting for Accessibility Service"}")
        }
    }

    private fun isJazzAccessibilityEnabled(): Boolean {
        val manager = getSystemService(ACCESSIBILITY_SERVICE) as AccessibilityManager
        return manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
            .any { info -> info.resolveInfo.serviceInfo.packageName == packageName && info.resolveInfo.serviceInfo.name.endsWith("JazzAccessibilityService") }
    }

    private fun copyText(label: String, value: String) {
        val clipboard = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText(label, value))
    }
}
