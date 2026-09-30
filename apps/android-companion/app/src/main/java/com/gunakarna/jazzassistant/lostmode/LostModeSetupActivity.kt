package com.gunakarna.jazzassistant.lostmode

import android.app.Activity
import android.os.Bundle
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** One-time local setup screen. It is separate from the existing Companion workflow. */
class LostModeSetupActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val security = LostModeSecurityManager(this)
        if (security.isConfigured()) {
            LostModeHeartbeatWorker.schedule(this)
            LostModeForegroundService.start(this)
        }

        val status = TextView(this).apply { textSize = 14f; setPadding(0, 14, 0, 14) }
        val server = EditText(this).apply { hint = "https://your-lost-mode-server.example.com"; setText(security.serverUrl()) }
        val deviceId = EditText(this).apply { hint = "Device ID from create-device"; setText(security.deviceId()) }
        val credential = EditText(this).apply {
            hint = if (security.isConfigured()) "Leave blank to keep current device credential" else "Device credential shown once by create-device"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 48, 32, 32)
            addView(TextView(this@LostModeSetupActivity).apply { text = "Jazz Lost Mode Setup"; textSize = 24f })
            addView(TextView(this@LostModeSetupActivity).apply { text = "This adds a second secure recovery channel. Existing Jazz recovery settings are not changed."; textSize = 14f })
            addView(TextView(this@LostModeSetupActivity).apply {
                text = if (security.isConfigured()) "Current server: ${security.serverUrl()}\nYou can change only the server URL and leave the credential blank to keep the existing enrollment secret." else "Enter the HTTPS server URL, Device ID, and one-time Device Credential."
                textSize = 13f
                setPadding(0, 12, 0, 12)
            })
            addView(server)
            addView(deviceId)
            addView(credential)
            addView(Button(this@LostModeSetupActivity).apply {
                text = "Save Lost Mode Enrollment"
                setOnClickListener {
                    try {
                        security.configure(server.text.toString(), deviceId.text.toString(), credential.text.toString())
                        credential.setText("")
                        status.text = "Lost Mode enrollment saved. Server URL: ${security.serverUrl()}\nLive sync restarted with the saved credential."
                    } catch (e: Exception) { status.text = "Setup error: ${e.message}" }
                }
            })
            addView(Button(this@LostModeSetupActivity).apply {
                text = "Test Lost Mode Connection"
                setOnClickListener {
                    status.text = "Testing ${security.serverUrl()}…"
                    LostModeForegroundService.start(this@LostModeSetupActivity)
                    Thread {
                        try {
                            val result = LostModeNetworkClient(applicationContext).syncOnce()
                            runOnUiThread { status.text = "Connection OK\nServer: ${security.serverUrl()}\nResult: ${result}" }
                        } catch (e: Exception) {
                            runOnUiThread { status.text = "Connection failed\nServer: ${security.serverUrl()}\nError: ${e.message ?: e.javaClass.simpleName}" }
                        }
                    }.start()
                }
            })
            addView(status)
        }
        setContentView(ScrollView(this).apply { addView(content) })
    }
}
