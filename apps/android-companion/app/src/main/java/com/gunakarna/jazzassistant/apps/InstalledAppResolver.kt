package com.gunakarna.jazzassistant.apps

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import java.util.Locale

class InstalledAppResolver(private val context: Context) {
    data class InstalledApp(val label: String, val packageName: String)

    private fun normalize(value: String): String = value
        .lowercase(Locale.ROOT)
        .replace("what's app", "whatsapp")
        .replace("what’s app", "whatsapp")
        .replace(Regex("[^a-z0-9]"), "")

    fun listLaunchableApps(): List<InstalledApp> {
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return pm.queryIntentActivities(intent, PackageManager.MATCH_ALL)
            .mapNotNull { info ->
                val pkg = info.activityInfo?.packageName ?: return@mapNotNull null
                val label = info.loadLabel(pm)?.toString()?.trim().orEmpty()
                if (label.isBlank()) null else InstalledApp(label, pkg)
            }
            .distinctBy { it.packageName }
            .sortedBy { it.label.lowercase(Locale.ROOT) }
    }

    fun resolve(requestedName: String): InstalledApp? {
        val requested = normalize(requestedName)
        if (requested.isBlank()) return null
        val apps = listLaunchableApps()

        apps.firstOrNull { normalize(it.label) == requested || normalize(it.packageName) == requested }?.let { return it }
        apps.firstOrNull { normalize(it.label).contains(requested) || requested.contains(normalize(it.label)) }?.let { return it }

        return apps
            .map { app -> app to similarity(requested, normalize(app.label)) }
            .filter { (_, score) -> score >= 0.62 }
            .maxByOrNull { it.second }
            ?.first
    }

    private fun similarity(a: String, b: String): Double {
        if (a == b) return 1.0
        if (a.isEmpty() || b.isEmpty()) return 0.0
        val distance = levenshtein(a, b)
        return 1.0 - distance.toDouble() / maxOf(a.length, b.length).toDouble()
    }

    private fun levenshtein(a: String, b: String): Int {
        val previous = IntArray(b.length + 1) { it }
        val current = IntArray(b.length + 1)
        for (i in 1..a.length) {
            current[0] = i
            for (j in 1..b.length) {
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                current[j] = minOf(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost)
            }
            for (j in previous.indices) previous[j] = current[j]
        }
        return previous[b.length]
    }
}
