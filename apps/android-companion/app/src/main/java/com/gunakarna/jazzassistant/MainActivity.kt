package com.gunakarna.jazzassistant

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.util.UUID

class MainActivity : Activity() {
    private val prefs by lazy { getSharedPreferences("jazz", Context.MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val token = prefs.getString("bridge_token", null) ?: UUID.randomUUID().toString().replace("-", "")
            .also { prefs.edit().putString("bridge_token", it).apply() }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 48, 32, 32)
        }
        root.addView(TextView(this).apply { text = "Jazz Android Companion"; textSize = 26f })
        root.addView(TextView(this).apply {
            text = "Enable Jazz Accessibility Service, then Windows can control this device through ADB port forwarding."
            textSize = 16f
        })
        root.addView(TextView(this).apply {
            text = "Bridge token:\n$token"
            textSize = 14f
            setPadding(0, 28, 0, 20)
        })
        root.addView(Button(this).apply {
            text = "Open Accessibility Settings"
            setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        })
        root.addView(Button(this).apply {
            text = "Copy Bridge Token"
            setOnClickListener {
                val clipboard = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("Jazz bridge token", token))
            }
        })
        root.addView(TextView(this).apply {
            text = "Windows command channel: ADB → local port forward → Jazz AccessibilityService"
            textSize = 13f
            setPadding(0, 28, 0, 0)
        })
        setContentView(root)
    }
}
