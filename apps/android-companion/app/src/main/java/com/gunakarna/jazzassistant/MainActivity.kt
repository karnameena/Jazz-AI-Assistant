package com.gunakarna.jazzassistant

import android.Manifest
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.gunakarna.jazzassistant.recovery.LostDeviceManager
import com.gunakarna.jazzassistant.recovery.RecoveryHeartbeatWorker
import com.gunakarna.jazzassistant.recovery.RecoverySecurityManager
import java.util.UUID

class MainActivity : Activity() {
    private val prefs by lazy { getSharedPreferences("jazz", Context.MODE_PRIVATE) }
    private val recoverySecurity by lazy { RecoverySecurityManager(this) }
    private val lostDeviceManager by lazy { LostDeviceManager(this) }
    private lateinit var statusView: TextView
    private lateinit var recoveryStatusView: TextView
    private lateinit var serverUrlInput: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val token = prefs.getString("bridge_token", null) ?: UUID.randomUUID().toString().replace("-", "")
            .also { prefs.edit().putString("bridge_token", it).apply() }

        RecoveryHeartbeatWorker.schedule(this)

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
            setPadding(0, 28, 0, 24)
        })

        content.addView(TextView(this).apply {
            text = "📱 Device Recovery"
            textSize = 22f
            setPadding(0, 18, 0, 6)
        })
        content.addView(TextView(this).apply {
            text = "Owner-authorized recovery uses an outbound HTTPS connection. It is separate from the existing ADB and Accessibility workflows."
            textSize = 14f
        })

        recoveryStatusView = TextView(this).apply {
            textSize = 14f
            setPadding(0, 18, 0, 14)
        }
        content.addView(recoveryStatusView)

        serverUrlInput = EditText(this).apply {
            hint = "https://your-jazz-recovery-relay.example.com"
            setSingleLine(true)
            setText(recoverySecurity.serverUrl())
        }
        content.addView(serverUrlInput)

        content.addView(Button(this).apply {
            text = "Save Recovery Server URL"
            setOnClickListener {
                try {
                    recoverySecurity.setServerUrl(serverUrlInput.text.toString())
                    RecoveryHeartbeatWorker.schedule(this@MainActivity)
                    refreshStatus()
                } catch (e: Exception) {
                    recoveryStatusView.text = "Recovery setup error: ${e.message}"
                }
            }
        })

        content.addView(Button(this).apply {
            text = "Request Recovery Permissions"
            setOnClickListener { requestRecoveryPermissions() }
        })

        content.addView(Button(this).apply {
            text = "Copy Recovery Device ID"
            setOnClickListener { copyText("Jazz recovery device ID", recoverySecurity.deviceId()) }
        })

        content.addView(Button(this).apply {
            text = "Copy Recovery Pairing Token"
            setOnClickListener { copyText("Jazz recovery pairing token", recoverySecurity.pairingToken()) }
        })

        content.addView(Button(this).apply {
            text = "Enable Lost Device Mode"
            setOnClickListener {
                lostDeviceManager.setEnabled(true)
                refreshStatus()
            }
        })

        content.addView(Button(this).apply {
            text = "Disable Lost Device Mode"
            setOnClickListener {
                lostDeviceManager.setEnabled(false)
                refreshStatus()
            }
        })

        content.addView(Button(this).apply {
            text = "Refresh Recovery Status"
            setOnClickListener { refreshStatus() }
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

        if (::recoveryStatusView.isInitialized) {
            recoveryStatusView.text = buildString {
                appendLine("Device: ${recoverySecurity.deviceName()}")
                appendLine("Device ID: ${recoverySecurity.deviceId()}")
                appendLine("Recovery mode: ${lostDeviceManager.mode()}")
                appendLine("Recovery server: ${recoverySecurity.serverUrl().ifBlank { "Not configured" }}")
                append("Security: Android Keystore encrypted pairing token + signed requests")
            }
        }
    }

    private fun requestRecoveryPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.CAMERA
        )
        if (Build.VERSION.SDK_INT >= 33) permissions += Manifest.permission.POST_NOTIFICATIONS
        requestPermissions(permissions.toTypedArray(), 7301)
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
