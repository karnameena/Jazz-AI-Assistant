package com.gunakarna.jazzassistant.lostmode

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.content.ContextCompat
import com.gunakarna.jazzassistant.MainActivity
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class LostModeForegroundService : Service() {
    companion object {
        private const val CHANNEL_ID = "jazz_lost_mode_channel"
        private const val NOTIFICATION_ID = 7401
        // The recovery service is already a foreground service. A one-second poll keeps
        // owner-triggered location/camera commands feeling immediate without changing
        // the existing outbound-only recovery architecture.
        private const val ACTIVE_SYNC_SECONDS = 1L

        fun intent(context: Context) = Intent(context, LostModeForegroundService::class.java)

        fun start(context: Context) {
            if (!LostModeSecurityManager(context).isConfigured()) return
            try {
                ContextCompat.startForegroundService(context, intent(context))
            } catch (_: Exception) {
                LostModeHeartbeatWorker.schedule(context)
            }
        }

        fun stop(context: Context) {
            try { context.stopService(intent(context)) } catch (_: Exception) {}
        }
    }

    private val scheduler = Executors.newSingleThreadScheduledExecutor()

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startForeground(NOTIFICATION_ID, notification())
        scheduler.scheduleWithFixedDelay({
            val client = LostModeNetworkClient(this)
            if (!client.isConfigured()) {
                stopSelf()
                return@scheduleWithFixedDelay
            }
            try {
                client.syncOnce()
            } catch (_: Exception) {
                LostModeHeartbeatWorker.syncNow(this)
            }
        }, 0, ACTIVE_SYNC_SECONDS, TimeUnit.SECONDS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!LostModeNetworkClient(this).isConfigured()) {
            stopSelf()
            return START_NOT_STICKY
        }
        LostModeHeartbeatWorker.schedule(this)
        return START_STICKY
    }

    override fun onDestroy() {
        scheduler.shutdownNow()
        if (LostModeNetworkClient(this).isConfigured()) LostModeHeartbeatWorker.syncNow(this)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createChannel() {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Jazz Lost Mode Connection", NotificationManager.IMPORTANCE_LOW)
        )
    }

    private fun notification(): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Jazz Lost Mode connected")
            .setContentText("Secure recovery website connection active")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }
}
