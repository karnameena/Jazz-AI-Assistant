package com.gunakarna.jazzassistant.recovery

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.location.LocationManager
import android.os.Build
import android.provider.Settings
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.PowerManager
import android.view.accessibility.AccessibilityManager
import com.gunakarna.jazzassistant.JazzAccessibilityService
import org.json.JSONObject

class DeviceStatusManager(private val context: Context) {
    fun snapshot(): JSONObject {
        val batteryIntent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val status = batteryIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val plugged = batteryIntent?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0
        val battery = if (level >= 0 && scale > 0) ((level * 100f) / scale).toInt() else -1
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL

        val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = connectivity.activeNetwork
        val capabilities = network?.let { connectivity.getNetworkCapabilities(it) }
        val networkType = when {
            capabilities == null -> "OFFLINE"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "WIFI"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "CELLULAR"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ETHERNET"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "VPN"
            else -> "OTHER"
        }
        val hasInternetCapability = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        val validated = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
        val online = hasInternetCapability && validated

        val powerSource = when (plugged) {
            BatteryManager.BATTERY_PLUGGED_AC -> "AC"
            BatteryManager.BATTERY_PLUGGED_USB -> "USB"
            BatteryManager.BATTERY_PLUGGED_WIRELESS -> "WIRELESS"
            else -> "BATTERY"
        }

        val locationServices = try {
            val globalLocation = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            @Suppress("DEPRECATION")
            val enabled = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                globalLocation.isLocationEnabled
            } else {
                Settings.Secure.getInt(context.contentResolver, Settings.Secure.LOCATION_MODE, 0) != 0
            }
            if (enabled) "ON" else "OFF"
        } catch (_: Exception) {
            "UNKNOWN"
        }
        val locationServicesTimestamp = System.currentTimeMillis()

        val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val ignoringBatteryOptimizations = power.isIgnoringBatteryOptimizations(context.packageName)
        val accessibilityEnabled = isJazzAccessibilityEnabled()
        val accessibilityConnected = JazzAccessibilityService.instance != null

        return JSONObject()
            .put("battery", battery)
            .put("charging", charging)
            .put("powerSource", powerSource)
            .put("lowBattery", battery in 0..15)
            .put("online", online)
            .put("internetCapability", hasInternetCapability)
            .put("networkValidated", validated)
            .put("network", networkType)
            .put("locationServices", locationServices)
            .put("locationServicesTimestamp", locationServicesTimestamp)
            .put("batteryOptimizationIgnored", ignoringBatteryOptimizations)
            .put("accessibilityEnabled", accessibilityEnabled)
            .put("accessibilityConnected", accessibilityConnected)
            .put(
                "accessibilityHealth",
                when {
                    accessibilityConnected -> "READY"
                    accessibilityEnabled -> "ENABLED_BUT_NOT_CONNECTED"
                    else -> "MANUAL_REENABLE_REQUIRED"
                }
            )
            .put("timestamp", System.currentTimeMillis())
    }

    private fun isJazzAccessibilityEnabled(): Boolean {
        val manager = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
        return manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
            .any { info ->
                info.resolveInfo.serviceInfo.packageName == context.packageName &&
                    info.resolveInfo.serviceInfo.name.endsWith("JazzAccessibilityService")
            }
    }
}
