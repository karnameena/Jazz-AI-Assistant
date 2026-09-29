package com.gunakarna.jazzassistant.lostmode

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class LostModeBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (LostModeSecurityManager(context).isConfigured()) {
            LostModeHeartbeatWorker.schedule(context)
            LostModeHeartbeatWorker.syncNow(context)
            LostModeForegroundService.start(context)
        }
    }
}
