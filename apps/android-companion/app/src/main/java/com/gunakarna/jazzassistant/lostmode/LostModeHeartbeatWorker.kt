package com.gunakarna.jazzassistant.lostmode

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

class LostModeHeartbeatWorker(appContext: Context, params: WorkerParameters) : Worker(appContext, params) {
    override fun doWork(): Result {
        val client = LostModeNetworkClient(applicationContext)
        if (!client.isConfigured()) return Result.success()
        return try {
            val result = client.syncOnce()
            if (result.optBoolean("ok", false)) Result.success() else Result.retry()
        } catch (_: Exception) { Result.retry() }
    }

    companion object {
        private const val PERIODIC = "jazz-lost-mode-heartbeat"
        private const val NOW = "jazz-lost-mode-sync-now"
        private fun constraints() = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedule(context: Context) {
            val periodic = PeriodicWorkRequestBuilder<LostModeHeartbeatWorker>(15, TimeUnit.MINUTES).setConstraints(constraints()).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, periodic)
            syncNow(context)
        }

        fun syncNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<LostModeHeartbeatWorker>().setConstraints(constraints()).build()
            WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
            WorkManager.getInstance(context).cancelUniqueWork(NOW)
        }
    }
}
