package com.gunakarna.jazzassistant.recovery

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class RecoveryBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        RecoveryHeartbeatWorker.schedule(context)

        // The secure channel must be available even while Lost Mode is OFF so the
        // owner can remotely enable Lost Mode after the device has already gone
        // missing. This does not bypass authentication; it only restarts the existing
        // paired outbound connection when Android permits background startup.
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
