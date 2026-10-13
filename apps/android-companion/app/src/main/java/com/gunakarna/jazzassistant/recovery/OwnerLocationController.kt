package com.gunakarna.jazzassistant.recovery

import android.Manifest
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import org.json.JSONObject

/** Android Enterprise device-owner-only global Location Services control.
 * No ADB shell execution, root, accessibility, or insecure setting writes.
 * A personally owned phone is not necessarily an Android-managed device owner.
 */
class JazzLocationAdminReceiver : DeviceAdminReceiver()

class OwnerLocationController(private val context: Context) {
    private val prefs = context.getSharedPreferences("jazz_lostmode_owner_location", Context.MODE_PRIVATE)
    private val statusManager = DeviceStatusManager(context)

    fun ownerOptedIn(): Boolean = prefs.getBoolean("allow_remote_location", false)

    fun hasSecureSettingsPermission(): Boolean =
        context.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS) == PackageManager.PERMISSION_GRANTED
    fun setOwnerOptIn(allowed: Boolean) {
        prefs.edit().putBoolean("allow_remote_location", allowed).apply()
    }

    fun currentState(): JSONObject {
        val snapshot = statusManager.snapshot()
        return JSONObject().put("ok", true)
            .put("locationServices", snapshot.optString("locationServices", "UNKNOWN"))
            .put("timestamp", snapshot.optLong("locationServicesTimestamp", System.currentTimeMillis()))
            .put("ownerOptIn", ownerOptedIn())
    }

    @Synchronized
    fun execute(enabled: Boolean, commandId: String): JSONObject {
        val before = currentState()
        if (!ownerOptedIn()) {
            return failure(before, "OPT_IN_REQUIRED", "Enable this feature locally in the Jazz Lost Mode Setup screen.")
        }
        val manager = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val desired = if (enabled) "ON" else "OFF"

        // Keep the original supported Android Enterprise device-owner route.
        if (manager.isDeviceOwnerApp(context.packageName)) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                return failure(before, "UNSUPPORTED", "Device-owner location control requires Android 11 or newer.")
            }
            if (before.optString("locationServices") == desired) {
                return before.put("confirmed", true).put("status", "ALREADY_SET")
                    .put("commandId", commandId)
            }
            val admin = ComponentName(context, JazzLocationAdminReceiver::class.java)
            try {
                manager.setLocationEnabled(admin, enabled)
            } catch (_: SecurityException) {
                return failure(currentState(), "PERMISSION_REQUIRED", "Android denied this device-owner operation.")
            } catch (_: Exception) {
                return failure(currentState(), "UNSUPPORTED", "Device-owner location control is unsupported on this phone.")
            }
            return confirmState(desired, commandId, "DEVICE_OWNER")
        }

        // Explicitly owner-granted ADB route; never grant privileges from this app.
        if (!hasSecureSettingsPermission()) {
            return failure(before, "SECURE_SETTINGS_PERMISSION_REQUIRED",
                "Grant WRITE_SECURE_SETTINGS locally via authorized ADB, if supported.")
        }
        if (before.optString("locationServices") == desired) {
            return before.put("confirmed", true).put("status", "ALREADY_SET")
                .put("commandId", commandId)
        }

        try {
            // Best effort on newer Android versions: LOCATION_MODE is deprecated.
            // Do NOT equate write success with a confirmed global location change.
            @Suppress("DEPRECATION")
            val mode = if (enabled) Settings.Secure.LOCATION_MODE_HIGH_ACCURACY
                       else Settings.Secure.LOCATION_MODE_OFF
            @Suppress("DEPRECATION")
            val accepted = Settings.Secure.putInt(context.contentResolver, Settings.Secure.LOCATION_MODE, mode)
            if (!accepted) {
                return failure(currentState(), "SECURE_SETTINGS_WRITE_FAILED",
                    "Android rejected the Location Services setting write.")
            }
        } catch (_: SecurityException) {
            return failure(currentState(), "SECURE_SETTINGS_PERMISSION_DENIED",
                "Android denied the secure-settings operation.")
        } catch (_: Exception) {
            return failure(currentState(), "SECURE_SETTINGS_UNSUPPORTED",
                "This Android version does not support changing Location Services by secure settings.")
        }
        return confirmState(desired, commandId, "ADB_SECURE_SETTINGS")
    }

    private fun confirmState(desired: String, commandId: String, method: String): JSONObject {
        var updated = currentState()
        repeat(8) {
            if (updated.optString("locationServices") == desired) {
                return updated.put("ok", true).put("confirmed", true)
                    .put("status", "CONFIRMED").put("commandId", commandId)
                    .put("appliedBy", method)
            }
            try {
                Thread.sleep(250L)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                return failure(updated, "INTERRUPTED", "Interrupted while confirming Location Services.")
            }
            updated = currentState()
        }
        return failure(updated, "NOT_CONFIRMED",
            "Android did not confirm the requested global Location Services setting.")
    }

    private fun failure(current: JSONObject, status: String, error: String): JSONObject =
        current.put("ok", false).put("confirmed", false).put("status", status).put("error", error)
}
