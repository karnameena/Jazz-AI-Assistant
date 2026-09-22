package com.gunakarna.jazzassistant.recovery

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import com.gunakarna.jazzassistant.MainActivity
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class RecoveryForegroundService : Service() {
    companion object {
        private const val CHANNEL_ID = "jazz_device_recovery"
        private const val NOTIFICATION_ID = 7301

        fun intent(context: Context): Intent = Intent(context, RecoveryForegroundService::class.java)
    }

    private val scheduler = Executors.newSingleThreadScheduledExecutor()

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startForeground(NOTIFICATION_ID, notification())
        scheduler.scheduleWithFixedDelay({
            try {
                if (LostDeviceManager(this).isEnabled()) {
                    RecoveryNetworkClient(this).syncOnce()
                }
            } catch (_: Exception) {}
        }, 0, 10, TimeUnit.SECONDS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!LostDeviceManager(this).isEnabled()) {
            stopSelf()
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    override fun onDestroy() {
        scheduler.shutdownNow()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createChannel() {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Jazz Device Recovery",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Visible owner-authorized lost-device recovery connection"
            }
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
            .setContentTitle("Jazz Device Recovery active")
            .setContentText("Secure recovery heartbeat is connected when internet is available.")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }
}
