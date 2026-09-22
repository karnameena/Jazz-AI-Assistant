package com.gunakarna.jazzassistant.recovery

import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

class RecoveryRingManager(private val context: Context) {
    fun ring(durationMs: Long = 30_000): JSONObject {
        return try {
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            val ringtone = RingtoneManager.getRingtone(context, uri)
                ?: return JSONObject().put("ok", false).put("status", "RING_UNAVAILABLE")
            ringtone.audioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            ringtone.play()
            Handler(Looper.getMainLooper()).postDelayed({
                try { if (ringtone.isPlaying) ringtone.stop() } catch (_: Exception) {}
            }, durationMs.coerceIn(5_000, 60_000))
            JSONObject()
                .put("ok", true)
                .put("status", "RINGING")
                .put("message", "Jazz recovery ring started using Android-supported audio APIs.")
        } catch (e: Exception) {
            JSONObject()
                .put("ok", false)
                .put("status", "RING_FAILED")
                .put("error", e.message ?: "Unable to ring the device")
        }
    }
}
