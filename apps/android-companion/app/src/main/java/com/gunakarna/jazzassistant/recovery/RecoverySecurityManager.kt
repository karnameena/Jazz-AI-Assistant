package com.gunakarna.jazzassistant.recovery

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.content.ContextCompat
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class RecoverySecurityManager(private val context: Context) {
    companion object {
        private const val PREFS = "jazz_recovery"
        private const val KEY_ALIAS = "jazz_recovery_storage_key"
        private const val DEVICE_ID = "device_id"
        private const val TOKEN_CT = "token_ciphertext"
        private const val TOKEN_IV = "token_iv"
        private const val SERVER_URL = "server_url"
        private const val DEVICE_NAME = "device_name"
    }

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun deviceId(): String = prefs.getString(DEVICE_ID, null)
        ?: "jazz-phone-${UUID.randomUUID()}".also {
            prefs.edit().putString(DEVICE_ID, it).apply()
        }

    fun deviceName(): String = prefs.getString(DEVICE_NAME, "Mama Android") ?: "Mama Android"

    fun setDeviceName(value: String) {
        prefs.edit().putString(DEVICE_NAME, value.trim().ifBlank { "Mama Android" }).apply()
    }

    fun serverUrl(): String = prefs.getString(SERVER_URL, "") ?: ""

    fun setServerUrl(value: String) {
        val normalized = value.trim().trimEnd('/')
        require(normalized.isBlank() || normalized.startsWith("https://")) {
            "Recovery server must use HTTPS."
        }
        prefs.edit().putString(SERVER_URL, normalized).apply()

        if (normalized.isNotBlank()) {
            RecoveryHeartbeatWorker.schedule(context)
            try {
                ContextCompat.startForegroundService(context, RecoveryForegroundService.intent(context))
            } catch (_: Exception) {
                RecoveryHeartbeatWorker.syncNow(context)
            }
        } else {
            context.stopService(RecoveryForegroundService.intent(context))
        }
    }

    fun pairingToken(): String {
        val encrypted = prefs.getString(TOKEN_CT, null)
        val iv = prefs.getString(TOKEN_IV, null)
        if (!encrypted.isNullOrBlank() && !iv.isNullOrBlank()) {
            return decrypt(encrypted, iv)
        }

        val raw = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val token = Base64.encodeToString(raw, Base64.NO_WRAP or Base64.URL_SAFE)
        val pair = encrypt(token)
        prefs.edit()
            .putString(TOKEN_CT, pair.first)
            .putString(TOKEN_IV, pair.second)
            .apply()
        return token
    }

    fun signedHeaders(method: String, path: String, body: String): Map<String, String> {
        val timestamp = System.currentTimeMillis().toString()
        val nonce = UUID.randomUUID().toString()
        val bodyHash = sha256Hex(body)
        val canonical = listOf(timestamp, nonce, method.uppercase(), path, bodyHash).joinToString("\n")
        val signature = hmacHex(pairingToken(), canonical)
        return mapOf(
            "Authorization" to "Bearer ${pairingToken()}",
            "X-Jazz-Device-Id" to deviceId(),
            "X-Jazz-Timestamp" to timestamp,
            "X-Jazz-Nonce" to nonce,
            "X-Jazz-Signature" to signature
        )
    }

    private fun storageKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
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
        cipher.init(Cipher.ENCRYPT_MODE, storageKey())
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
            storageKey(),
            GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP))
        )
        return String(
            cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)),
            StandardCharsets.UTF_8
        )
    }

    private fun sha256Hex(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private fun hmacHex(secret: String, value: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(StandardCharsets.UTF_8), "HmacSHA256"))
        return mac.doFinal(value.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }
}
