package com.gunakarna.jazzassistant.recovery

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import android.util.Base64
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder

class RecoveryVoiceMessageManager(private val context: Context) {
    companion object {
        private const val MAX_AUDIO_BYTES = 900_000
        private const val SAMPLE_RATE = 16_000
    }

    fun play(args: JSONObject): JSONObject {
        return try {
            if (args.optString("mimeType") != "audio/wav") return blocked("VOICE_FORMAT_NOT_ALLOWED", "Recovery voice requires WAV audio.")
            val encoded = args.optString("audioBase64")
            if (encoded.isBlank()) return blocked("VOICE_AUDIO_MISSING", "Recovery voice message is missing.")
            val wav = Base64.decode(encoded, Base64.DEFAULT)
            if (wav.size <= 44 || wav.size > MAX_AUDIO_BYTES) return blocked("VOICE_AUDIO_INVALID", "Recovery voice message is invalid or too large.")

            val pcm = parsePcm16MonoWav(wav) ?: return blocked("VOICE_AUDIO_INVALID", "Recovery voice WAV is not 16 kHz mono PCM.")
            if (pcm.isEmpty()) return blocked("VOICE_AUDIO_EMPTY", "Recovery voice message is empty.")

            val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val oldVolume = audioManager.getStreamVolume(AudioManager.STREAM_ALARM)
            val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM)
            try { audioManager.setStreamVolume(AudioManager.STREAM_ALARM, maxVolume, 0) } catch (_: Exception) {}

            val track = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(SAMPLE_RATE)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build()
                )
                .setTransferMode(AudioTrack.MODE_STATIC)
                .setBufferSizeInBytes(pcm.size)
                .build()

            if (track.state != AudioTrack.STATE_INITIALIZED) {
                try { track.release() } catch (_: Exception) {}
                try { audioManager.setStreamVolume(AudioManager.STREAM_ALARM, oldVolume, 0) } catch (_: Exception) {}
                return blocked("VOICE_PLAYBACK_UNAVAILABLE", "Android could not initialize recovery voice playback.")
            }

            val written = track.write(pcm, 0, pcm.size)
            if (written <= 0) {
                try { track.release() } catch (_: Exception) {}
                try { audioManager.setStreamVolume(AudioManager.STREAM_ALARM, oldVolume, 0) } catch (_: Exception) {}
                return blocked("VOICE_PLAYBACK_FAILED", "Android could not load the recovery voice message.")
            }

            track.play()
            val durationMs = ((pcm.size / 2.0) / SAMPLE_RATE * 1000.0).toLong().coerceIn(250L, 25_000L)
            Handler(Looper.getMainLooper()).postDelayed({
                try { track.stop() } catch (_: Exception) {}
                try { track.release() } catch (_: Exception) {}
                try { audioManager.setStreamVolume(AudioManager.STREAM_ALARM, oldVolume, 0) } catch (_: Exception) {}
            }, durationMs + 350L)

            JSONObject()
                .put("ok", true)
                .put("status", "VOICE_PLAYBACK_STARTED")
                .put("durationMs", durationMs)
                .put("message", "Owner recovery voice is playing through the lost device audio channel.")
        } catch (e: Exception) {
            blocked("VOICE_PLAYBACK_FAILED", e.message ?: "Unable to play recovery voice message.")
        }
    }

    private fun parsePcm16MonoWav(wav: ByteArray): ByteArray? {
        if (wav.size < 44) return null
        if (String(wav, 0, 4, Charsets.US_ASCII) != "RIFF") return null
        if (String(wav, 8, 4, Charsets.US_ASCII) != "WAVE") return null
        val buffer = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN)
        if (buffer.getShort(20).toInt() != 1) return null
        if (buffer.getShort(22).toInt() != 1) return null
        if (buffer.getInt(24) != SAMPLE_RATE) return null
        if (buffer.getShort(34).toInt() != 16) return null
        if (String(wav, 36, 4, Charsets.US_ASCII) != "data") return null
        val dataSize = buffer.getInt(40)
        if (dataSize <= 0 || 44 + dataSize > wav.size) return null
        return wav.copyOfRange(44, 44 + dataSize)
    }

    private fun blocked(status: String, message: String): JSONObject = JSONObject()
        .put("ok", false)
        .put("status", status)
        .put("message", message)
}
