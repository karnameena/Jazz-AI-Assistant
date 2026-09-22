package com.gunakarna.jazzassistant.recovery

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class RecoveryBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        RecoveryHeartbeatWorker.schedule(context)
        if (LostDeviceManager(context).isEnabled()) {
            try {
                ContextCompat.startForegroundService(
                    context,
                    RecoveryForegroundService.intent(context)
                )
            } catch (_: Exception) {
                // Android may defer background service starts. The periodic worker
                // remains scheduled and will reconnect when the OS allows it.
            }
        }
    }
}
