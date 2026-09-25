package com.gunakarna.jazzassistant.notifications

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.util.concurrent.CopyOnWriteArrayList

class JazzNotificationListenerService : NotificationListenerService() {
    data class NotificationSummary(
        val key: String,
        val packageName: String,
        val postedAt: Long
    )

    companion object {
        private val recent = CopyOnWriteArrayList<NotificationSummary>()
        private const val MAX_ITEMS = 100

        fun recentSummaries(limit: Int = 20): List<Map<String, Any?>> = recent.asReversed().take(limit).map {
            mapOf(
                "packageName" to it.packageName,
                "timestamp" to it.postedAt
            )
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val item = sbn ?: return
        recent.removeAll { it.key == item.key }
        recent += NotificationSummary(item.key, item.packageName, item.postTime)
        while (recent.size > MAX_ITEMS) recent.removeAt(0)
        android.util.Log.i("JAZZ-NOTIFICATION", "notification package=${item.packageName}")
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        val key = sbn?.key ?: return
        recent.removeAll { it.key == key }
    }
}
