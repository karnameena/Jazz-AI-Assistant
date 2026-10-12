package com.gunakarna.jazzassistant.recovery

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
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
        if (!ownerOptedIn()) return failure(before, "OPT_IN_REQUIRED", "Enable this feature locally in the Jazz Lost Mode Setup screen.")
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return failure(before, "UNSUPPORTED", "Supported device-owner method requires Android 11 or newer.")
        val manager = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        if (!manager.isDeviceOwnerApp(context.packageName)) {
            return failure(before, "DEVICE_OWNER_REQUIRED", "Android Enterprise device-owner management is required. Being the phone's purchaser does not grant this API.")
        }
        val desired = if (enabled) "ON" else "OFF"
        if (before.optString("locationServices") == desired) return before.put("ok", true)
            .put("confirmed", true).put("status", "ALREADY_SET")
        val admin = ComponentName(context, JazzLocationAdminReceiver::class.java)
        try {
            manager.setLocationEnabled(admin, enabled)
        } catch (error: SecurityException) {
            return failure(currentState(), "PERMISSION_REQUIRED", "Android denied this device-owner operation.")
        } catch (error: Exception) {
            return failure(currentState(), "UNSUPPORTED", "This device cannot change global Location Services using its device-owner API.")
        }
        val updated = currentState()
        if (updated.optString("locationServices") != desired) {
            return failure(updated, "UNSUPPORTED", "Android did not confirm the requested Location Services setting.")
        }
        return updated.put("ok", true).put("confirmed", true).put("status", "CONFIRMED").put("commandId", commandId)
    }

    private fun failure(current: JSONObject, status: String, error: String): JSONObject =
        current.put("ok", false).put("confirmed", false).put("status", status).put("error", error)
}
