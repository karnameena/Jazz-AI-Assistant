package com.gunakarna.jazzassistant.recovery

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class RecoveryLocationHistory(private val context: Context) {
    companion object {
        private const val PREFS = "jazz_recovery"
        private const val KEY_ALIAS = "jazz_recovery_location_history_key"
        private const val HISTORY_CT = "location_history_ciphertext"
        private const val HISTORY_IV = "location_history_iv"
        private const val MAX_ENTRIES = 12
        private const val MIN_INTERVAL_MS = 60_000L
    }

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun append(latitude: Double, longitude: Double, accuracy: Double, provider: String, timestamp: Long) {
        if (!LostDeviceManager(context).isEnabled()) return
        val entries = readEntries()
        val last = if (entries.length() > 0) entries.optJSONObject(entries.length() - 1) else null
        if (last != null && timestamp - last.optLong("timestamp", 0L) < MIN_INTERVAL_MS) return

        val next = JSONArray()
        val start = (entries.length() - (MAX_ENTRIES - 1)).coerceAtLeast(0)
        for (index in start until entries.length()) next.put(entries.get(index))
        next.put(
            JSONObject()
                .put("latitude", latitude)
                .put("longitude", longitude)
                .put("accuracyMeters", accuracy)
                .put("provider", provider)
                .put("timestamp", timestamp)
        )
        writeEntries(next)
    }

    fun readForRecovery(): JSONArray = readEntries()

    fun clear() {
        prefs.edit().remove(HISTORY_CT).remove(HISTORY_IV).apply()
    }

    private fun readEntries(): JSONArray {
        val ciphertext = prefs.getString(HISTORY_CT, null)
        val iv = prefs.getString(HISTORY_IV, null)
        if (ciphertext.isNullOrBlank() || iv.isNullOrBlank()) return JSONArray()
        return try {
            JSONArray(decrypt(ciphertext, iv))
        } catch (_: Exception) {
            JSONArray()
        }
    }

    private fun writeEntries(entries: JSONArray) {
        val encrypted = encrypt(entries.toString())
        prefs.edit()
            .putString(HISTORY_CT, encrypted.first)
            .putString(HISTORY_IV, encrypted.second)
            .apply()
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    private fun encrypt(value: String): Pair<String, String> {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val ciphertext = cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))
        return Pair(
            Base64.encodeToString(ciphertext, Base64.NO_WRAP),
            Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        )
    }

    private fun decrypt(ciphertext: String, iv: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            key(),
            GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP))
        )
        return String(
            cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)),
            StandardCharsets.UTF_8
        )
    }
}
