package com.gunakarna.jazzassistant.recovery

import android.content.Context
import androidx.core.content.ContextCompat

class LostDeviceManager(private val context: Context) {
    companion object {
        private const val PREFS = "jazz_recovery"
        private const val LOST_MODE = "lost_device_mode"
        const val NORMAL_MODE = "NORMAL_MODE"
        const val LOST_DEVICE_MODE = "LOST_DEVICE_MODE"
    }

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isEnabled(): Boolean = prefs.getBoolean(LOST_MODE, false)

    fun mode(): String = if (isEnabled()) LOST_DEVICE_MODE else NORMAL_MODE

    fun setEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(LOST_MODE, enabled).apply()
        RecoveryHeartbeatWorker.schedule(context)
        if (enabled) {
            try {
                ContextCompat.startForegroundService(
                    context,
                    RecoveryForegroundService.intent(context)
                )
            } catch (_: Exception) {
                // Android can temporarily refuse foreground-service starts depending
                // on app/device state. The WorkManager heartbeat remains scheduled.
            }
        } else {
            context.stopService(RecoveryForegroundService.intent(context))
        }
    }
}
