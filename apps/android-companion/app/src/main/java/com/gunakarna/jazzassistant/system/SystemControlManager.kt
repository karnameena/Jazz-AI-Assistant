package com.gunakarna.jazzassistant.system

import android.Manifest
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.net.Uri
import android.os.Build
import android.provider.ContactsContract
import android.telecom.TelecomManager
import androidx.core.content.ContextCompat
import com.gunakarna.jazzassistant.notifications.JazzNotificationListenerService

class SystemControlManager(private val context: Context) {
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    fun volumeUp(): Map<String, Any?> = adjustVolume(AudioManager.ADJUST_RAISE, "Volume increased.")
    fun volumeDown(): Map<String, Any?> = adjustVolume(AudioManager.ADJUST_LOWER, "Volume decreased.")
    fun mute(): Map<String, Any?> = adjustVolume(AudioManager.ADJUST_MUTE, "Media muted.")
    fun unmute(): Map<String, Any?> = adjustVolume(AudioManager.ADJUST_UNMUTE, "Media unmuted.")

    private fun adjustVolume(direction: Int, message: String): Map<String, Any?> = try {
        audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI)
        ok(message)
    } catch (e: Exception) {
        fail("AUDIO_FAILED", e.message ?: "Audio control failed.")
    }

    fun mediaPlay() = mediaAction("play") { it.transportControls.play() }
    fun mediaPause() = mediaAction("pause") { it.transportControls.pause() }
    fun mediaNext() = mediaAction("next") { it.transportControls.skipToNext() }
    fun mediaPrevious() = mediaAction("previous") { it.transportControls.skipToPrevious() }

    private fun mediaAction(label: String, block: (MediaController) -> Unit): Map<String, Any?> = try {
        val manager = context.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
        val component = ComponentName(context, JazzNotificationListenerService::class.java)
        val controllers = manager.getActiveSessions(component)
        val controller = controllers.firstOrNull()
            ?: return fail("NO_ACTIVE_MEDIA", "No active media session is available. Grant Notification Access if media control is not working.")
        block(controller)
        ok("Media $label command sent.", mapOf("packageName" to controller.packageName))
    } catch (e: SecurityException) {
        fail("NOTIFICATION_ACCESS_REQUIRED", "Media control requires Notification Access for Jazz Android Companion.")
    } catch (e: Exception) {
        fail("MEDIA_FAILED", e.message ?: "Media control failed.")
    }

    fun flashlight(enabled: Boolean): Map<String, Any?> = try {
        val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val cameraId = manager.cameraIdList.firstOrNull { id ->
            val chars = manager.getCameraCharacteristics(id)
            chars.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true &&
                chars.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
        } ?: return fail("FLASHLIGHT_UNAVAILABLE", "No rear camera torch is available.")
        manager.setTorchMode(cameraId, enabled)
        ok(if (enabled) "Flashlight turned on." else "Flashlight turned off.")
    } catch (e: Exception) {
        fail("FLASHLIGHT_FAILED", e.message ?: "Flashlight control failed.")
    }

    fun callContact(name: String): Map<String, Any?> {
        if (name.isBlank()) return fail("CONTACT_REQUIRED", "A contact name is required.")
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            return fail("READ_CONTACTS_REQUIRED", "Contacts permission is required before Jazz can call a saved contact.")
        }
        val numbers = findPhoneNumbers(name)
        if (numbers.isEmpty()) return fail("CONTACT_NOT_FOUND", "No saved contact exactly matched '$name'.")
        if (numbers.size > 1) return fail("CONTACT_AMBIGUOUS", "Multiple saved contacts or numbers match '$name'. Please choose which one.", mapOf("matches" to numbers.size))
        val number = numbers.single()
        val callIntent = if (ContextCompat.checkSelfPermission(context, Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED) {
            Intent(Intent.ACTION_CALL, Uri.parse("tel:${Uri.encode(number)}"))
        } else {
            Intent(Intent.ACTION_DIAL, Uri.parse("tel:${Uri.encode(number)}"))
        }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(callIntent)
        return if (callIntent.action == Intent.ACTION_CALL) ok("Calling $name.", mapOf("contact" to name))
        else fail("CALL_PHONE_REQUIRED", "Opened the dialer for $name. Grant Phone permission to place calls directly.", mapOf("contact" to name, "dialerOpened" to true))
    }

    fun answerCall(): Map<String, Any?> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return fail("UNSUPPORTED", "Answer-call control requires Android 8 or newer.")
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ANSWER_PHONE_CALLS) != PackageManager.PERMISSION_GRANTED) {
            return fail("ANSWER_PHONE_CALLS_REQUIRED", "Phone permission is required to answer calls.")
        }
        return try {
            val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
            @Suppress("DEPRECATION")
            telecom.acceptRingingCall()
            ok("Answered the call.")
        } catch (e: Exception) {
            fail("ANSWER_CALL_FAILED", e.message ?: "Android did not allow Jazz to answer this call.")
        }
    }

    fun endCall(): Map<String, Any?> {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ANSWER_PHONE_CALLS) != PackageManager.PERMISSION_GRANTED) {
            return fail("ANSWER_PHONE_CALLS_REQUIRED", "Phone permission is required before Jazz can request call termination.")
        }
        return try {
            val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
            @Suppress("DEPRECATION")
            val ended = telecom.endCall()
            if (ended) ok("Ended the call.") else fail("DEFAULT_DIALER_OR_OS_RESTRICTION", "Android did not permit Jazz to end this call. Your device may require Jazz to be the default dialer.")
        } catch (e: Exception) {
            fail("END_CALL_FAILED", e.message ?: "Android did not allow Jazz to end this call.")
        }
    }

    private fun findPhoneNumbers(name: String): List<String> {
        val results = mutableListOf<String>()
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        )
        context.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            projection,
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} = ? COLLATE NOCASE",
            arrayOf(name),
            null
        )?.use { cursor ->
            val numberIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
            while (cursor.moveToNext()) {
                cursor.getString(numberIndex)?.takeIf { it.isNotBlank() }?.let(results::add)
            }
        }
        return results.distinct()
    }

    private fun ok(message: String, extra: Map<String, Any?> = emptyMap()): Map<String, Any?> =
        mapOf("ok" to true, "status" to "SUCCESS", "message" to message) + extra

    private fun fail(status: String, message: String, extra: Map<String, Any?> = emptyMap()): Map<String, Any?> =
        mapOf("ok" to false, "status" to status, "message" to message) + extra
}
