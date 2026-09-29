package com.gunakarna.jazzassistant.lostmode

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Visible owner-authorized service for the separate Lost Mode gateway. */
class LostModeForegroundService : Service() {
    companion object {
        private const val CHANNEL = "jazz_lost_mode_gateway"
        private const val NOTIFICATION_ID = 7310
        fun intent(context: Context) = Intent(context, LostModeForegroundService::class.java)
    }

    private val scheduler = Executors.newSingleThreadScheduledExecutor()

    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Jazz Lost Mode", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Secure owner-authorized Lost Mode recovery connection"
        })
        startForeground(NOTIFICATION_ID, notification())
        scheduler.scheduleWithFixedDelay({
            val client = LostModeNetworkClient(this)
            if (!client.isConfigured()) return@scheduleWithFixedDelay
            try { client.syncOnce() } catch (_: Exception) { LostModeHeartbeatWorker.syncNow(this) }
        }, 0, 12, TimeUnit.SECONDS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!LostModeSecurityManager(this).isConfigured()) {
            stopSelf()
            return START_NOT_STICKY
        }
        LostModeHeartbeatWorker.syncNow(this)
        return START_STICKY
    }

    override fun onDestroy() {
        scheduler.shutdownNow()
        if (LostModeSecurityManager(this).isConfigured()) LostModeHeartbeatWorker.syncNow(this)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun notification(): Notification = Notification.Builder(this, CHANNEL)
        .setContentTitle("Jazz Lost Mode ready")
        .setContentText("Secure recovery gateway connection active")
        .setSmallIcon(android.R.drawable.ic_menu_mylocation)
        .setOngoing(true)
        .build()
}
