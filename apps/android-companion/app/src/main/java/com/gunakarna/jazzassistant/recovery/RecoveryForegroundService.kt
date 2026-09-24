package com.gunakarna.jazzassistant.recovery

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager
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
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startForeground(NOTIFICATION_ID, notification())

        val power = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Jazz:RecoveryHeartbeat").apply {
            setReferenceCounted(false)
            try { acquire(10 * 60 * 1000L) } catch (_: Exception) {}
        }

        // Keep the already-paired recovery channel alive even while Lost Mode is OFF.
        // That is what makes a remote "Enable Lost Mode" command possible. When Lost
        // Mode is ON this same channel also carries location/ring/photo commands.
        scheduler.scheduleWithFixedDelay({
            val client = RecoveryNetworkClient(this)
            if (!client.isConfigured()) return@scheduleWithFixedDelay
            try {
                client.syncOnce()
            } catch (_: Exception) {
                RecoveryHeartbeatWorker.syncNow(this)
            }
            try {
                if (wakeLock?.isHeld != true) wakeLock?.acquire(10 * 60 * 1000L)
            } catch (_: Exception) {}
        }, 0, 10, TimeUnit.SECONDS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!RecoveryNetworkClient(this).isConfigured()) {
            stopSelf()
            return START_NOT_STICKY
        }
        RecoveryHeartbeatWorker.syncNow(this)
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        RecoveryHeartbeatWorker.syncNow(this)
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        scheduler.shutdownNow()
        try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) {}
        wakeLock = null
        if (RecoveryNetworkClient(this).isConfigured()) RecoveryHeartbeatWorker.syncNow(this)
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
        val mode = LostDeviceManager(this).mode()
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Jazz Device Recovery ready")
            .setContentText(if (mode == LostDeviceManager.LOST_DEVICE_MODE) "Lost Mode active • Wi-Fi or mobile data" else "Secure recovery channel ready • Lost Mode off")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }
}
