package com.gunakarna.jazzassistant.lostmode

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Separate credentials for the new Lost Mode gateway. Existing recovery credentials are untouched. */
class LostModeSecurityManager(private val context: Context) {
    companion object {
        private const val PREFS = "jazz_lost_mode"
        private const val KEY_ALIAS = "jazz_lost_mode_storage_key"
        private const val SERVER_URL = "server_url"
        private const val DEVICE_ID = "device_id"
        private const val TOKEN_CT = "token_ct"
        private const val TOKEN_IV = "token_iv"
    }

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun serverUrl(): String = prefs.getString(SERVER_URL, "") ?: ""
    fun deviceId(): String = prefs.getString(DEVICE_ID, "") ?: ""

    fun credential(): String {
        val ct = prefs.getString(TOKEN_CT, null) ?: return ""
        val iv = prefs.getString(TOKEN_IV, null) ?: return ""
        return try { decrypt(ct, iv) } catch (_: Exception) { "" }
    }

    fun isConfigured(): Boolean = serverUrl().isNotBlank() && deviceId().isNotBlank() && credential().isNotBlank()

    fun configure(serverUrl: String, deviceId: String, credential: String) {
        val url = serverUrl.trim().trimEnd('/')
        val id = deviceId.trim()
        val suppliedToken = credential.trim()
        val existingToken = this.credential()
        val token = if (suppliedToken.isNotBlank()) suppliedToken else existingToken

        require(url.startsWith("https://")) { "Lost Mode server must use HTTPS." }
        require(id.length in 3..120) { "Lost Mode device ID is invalid." }
        require(token.length >= 32) { "Lost Mode device credential is invalid. Enter the credential when enrolling for the first time or after rotating it." }

        val encrypted = encrypt(token)
        prefs.edit()
            .putString(SERVER_URL, url)
            .putString(DEVICE_ID, id)
            .putString(TOKEN_CT, encrypted.first)
            .putString(TOKEN_IV, encrypted.second)
            .apply()
        LostModeHeartbeatWorker.schedule(context)
        LostModeHeartbeatWorker.syncNow(context)
        LostModeForegroundService.start(context)
    }

    fun clear() {
        LostModeForegroundService.stop(context)
        prefs.edit().clear().apply()
        LostModeHeartbeatWorker.cancel(context)
    }

    private fun storageKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
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
        val bytes = cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))
        return Base64.encodeToString(bytes, Base64.NO_WRAP) to Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
    }

    private fun decrypt(ciphertext: String, iv: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, storageKey(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
        return String(cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)), StandardCharsets.UTF_8)
    }
}
