package com.gunakarna.jazzassistant.apps

import android.content.Context
import android.content.Intent
import android.os.Build

class AppLauncher(
    private val context: Context,
    private val resolver: InstalledAppResolver = InstalledAppResolver(context)
) {
    fun listApps(): List<Map<String, String>> = resolver.listLaunchableApps().map {
        mapOf("label" to it.label, "package" to it.packageName)
    }

    fun launchByName(name: String): Map<String, Any?> {
        val app = resolver.resolve(name)
            ?: return mapOf("ok" to false, "status" to "APP_NOT_INSTALLED", "error" to "App not installed: $name")
        return launchPackage(app.packageName, app.label)
    }

    fun launchPackage(packageName: String, label: String? = null): Map<String, Any?> = try {
        require(packageName.matches(Regex("^[A-Za-z0-9._]+$"))) { "Invalid package name" }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.packageManager.getLaunchIntentSenderForPackage(packageName)
                .sendIntent(context, 0, null, null, null)
        } else {
            val intent = context.packageManager.getLaunchIntentForPackage(packageName)
                ?: error("App not found: $packageName")
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        mapOf(
            "ok" to true,
            "status" to "OPEN_APP_SUCCESS",
            "message" to "Opened ${label ?: packageName}.",
            "packageName" to packageName,
            "label" to label
        )
    } catch (e: Exception) {
        mapOf("ok" to false, "status" to "APP_NOT_INSTALLED", "error" to (e.message ?: "App not found"), "packageName" to packageName)
    }
}
