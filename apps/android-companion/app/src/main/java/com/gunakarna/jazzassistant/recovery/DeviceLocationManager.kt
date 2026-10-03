package com.gunakarna.jazzassistant.recovery

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.google.android.gms.tasks.Tasks
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class DeviceLocationManager(private val context: Context) {
    companion object {
        private const val PREFS = "jazz_recovery"
        private const val LAST_LAT = "last_lat"
        private const val LAST_LON = "last_lon"
        private const val LAST_ACCURACY = "last_accuracy"
        private const val LAST_PROVIDER = "last_provider"
        private const val LAST_TIME = "last_location_time"
        private const val FRESH_LOCATION_MAX_AGE_MS = 10_000L
        private const val LAST_LOCATION_WAIT_MS = 1_500L
    }

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val client = LocationServices.getFusedLocationProviderClient(context)
    private val history = RecoveryLocationHistory(context)

    fun currentLocation(timeoutSeconds: Long = 6): JSONObject {
        if (!hasLocationPermission()) {
            return JSONObject()
                .put("ok", false)
                .put("status", "LOCATION_PERMISSION_REQUIRED")
                .put("error", "Location permission has not been granted to Jazz Android Companion.")
        }

        // Fused Location normally already has a very recent fix. Use it immediately
        // when it is fresh instead of forcing a new GPS fix and making the owner wait.
        try {
            val recent = Tasks.await(client.lastLocation, LAST_LOCATION_WAIT_MS, TimeUnit.MILLISECONDS)
            if (recent != null && recent.time > 0L && System.currentTimeMillis() - recent.time <= FRESH_LOCATION_MAX_AGE_MS) {
                save(recent.latitude, recent.longitude, recent.accuracy.toDouble(), recent.provider ?: "fused", recent.time)
                return jsonLocation(
                    latitude = recent.latitude,
                    longitude = recent.longitude,
                    accuracy = recent.accuracy.toDouble(),
                    provider = recent.provider ?: "fused",
                    timestamp = recent.time,
                    kind = "LIVE_LOCATION"
                )
            }
        } catch (_: Exception) {
            // Continue to an active high-accuracy request.
        }

        val cancellation = CancellationTokenSource()
        return try {
            val location = Tasks.await(
                client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cancellation.token),
                timeoutSeconds,
                TimeUnit.SECONDS
            )
            if (location != null) {
                save(location.latitude, location.longitude, location.accuracy.toDouble(), location.provider ?: "fused", location.time)
                jsonLocation(
                    latitude = location.latitude,
                    longitude = location.longitude,
                    accuracy = location.accuracy.toDouble(),
                    provider = location.provider ?: "fused",
                    timestamp = location.time,
                    kind = "LIVE_LOCATION"
                )
            } else {
                lastKnownLocation("LAST_KNOWN_LOCATION")
            }
        } catch (_: Exception) {
            cancellation.cancel()
            try {
                val last = Tasks.await(client.lastLocation, LAST_LOCATION_WAIT_MS, TimeUnit.MILLISECONDS)
                if (last != null) {
                    save(last.latitude, last.longitude, last.accuracy.toDouble(), last.provider ?: "fused", last.time)
                    jsonLocation(
                        latitude = last.latitude,
                        longitude = last.longitude,
                        accuracy = last.accuracy.toDouble(),
                        provider = last.provider ?: "fused",
                        timestamp = last.time,
                        kind = "LAST_KNOWN_LOCATION"
                    )
                } else {
                    lastKnownLocation("LAST_KNOWN_LOCATION")
                }
            } catch (_: Exception) {
                lastKnownLocation("LAST_KNOWN_LOCATION")
            }
        } finally {
            cancellation.cancel()
        }
    }

    fun cachedLocation(): JSONObject? {
        if (!prefs.contains(LAST_LAT) || !prefs.contains(LAST_LON)) return null
        return lastKnownLocation("LAST_KNOWN_LOCATION").takeIf { it.optBoolean("ok") }
    }

    fun encryptedHistory() = history.readForRecovery()

    private fun lastKnownLocation(kind: String): JSONObject {
        if (!prefs.contains(LAST_LAT) || !prefs.contains(LAST_LON)) {
            return JSONObject()
                .put("ok", false)
                .put("status", "LOCATION_UNAVAILABLE")
                .put("error", "No trustworthy location is currently available.")
        }
        return jsonLocation(
            latitude = java.lang.Double.longBitsToDouble(prefs.getLong(LAST_LAT, 0L)),
            longitude = java.lang.Double.longBitsToDouble(prefs.getLong(LAST_LON, 0L)),
            accuracy = java.lang.Double.longBitsToDouble(prefs.getLong(LAST_ACCURACY, 0L)),
            provider = prefs.getString(LAST_PROVIDER, "fused") ?: "fused",
            timestamp = prefs.getLong(LAST_TIME, 0L),
            kind = kind
        )
    }

    private fun jsonLocation(
        latitude: Double,
        longitude: Double,
        accuracy: Double,
        provider: String,
        timestamp: Long,
        kind: String
    ): JSONObject = JSONObject()
        .put("ok", true)
        .put("status", kind)
        .put("latitude", latitude)
        .put("longitude", longitude)
        .put("accuracyMeters", accuracy)
        .put("provider", provider)
        .put("timestamp", timestamp)

    private fun save(latitude: Double, longitude: Double, accuracy: Double, provider: String, timestamp: Long) {
        prefs.edit()
            .putLong(LAST_LAT, java.lang.Double.doubleToRawLongBits(latitude))
            .putLong(LAST_LON, java.lang.Double.doubleToRawLongBits(longitude))
            .putLong(LAST_ACCURACY, java.lang.Double.doubleToRawLongBits(accuracy))
            .putString(LAST_PROVIDER, provider)
            .putLong(LAST_TIME, timestamp)
            .apply()
        history.append(latitude, longitude, accuracy, provider, timestamp)
    }

    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
}
