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

        // Keep the secure paired recovery channel alive in both NORMAL_MODE and
        // LOST_DEVICE_MODE. Otherwise Jazz could not remotely enable Lost Mode when
        // the phone is already missing. The service remains owner-authenticated and
        // only starts when a recovery server has been configured.
        if (RecoveryNetworkClient(context).isConfigured()) {
            try {
                ContextCompat.startForegroundService(
                    context,
                    RecoveryForegroundService.intent(context)
                )
            } catch (_: Exception) {
                RecoveryHeartbeatWorker.syncNow(context)
            }
        }
    }
}
