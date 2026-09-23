package com.gunakarna.jazzassistant.recovery

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

class RecoveryHeartbeatWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : Worker(appContext, workerParams) {
    override fun doWork(): Result {
        val client = RecoveryNetworkClient(applicationContext)
        if (!client.isConfigured()) return Result.success()
        return try {
            val result = client.syncOnce()
            if (result.optBoolean("ok", true)) Result.success() else Result.retry()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    companion object {
        private const val UNIQUE_PERIODIC_WORK = "jazz-recovery-heartbeat"
        private const val UNIQUE_NOW_WORK = "jazz-recovery-sync-now"

        private fun networkConstraints(): Constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        fun schedule(context: Context) {
            val periodic = PeriodicWorkRequestBuilder<RecoveryHeartbeatWorker>(15, TimeUnit.MINUTES)
                .setConstraints(networkConstraints())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                UNIQUE_PERIODIC_WORK,
                ExistingPeriodicWorkPolicy.UPDATE,
                periodic
            )

            // WorkManager periodic jobs have a 15-minute minimum interval. Queue an
            // immediate sync too so saving a relay URL or opening the Companion does
            // not make recovery setup look offline for up to 15 minutes.
            syncNow(context)
        }

        fun syncNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<RecoveryHeartbeatWorker>()
                .setConstraints(networkConstraints())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                UNIQUE_NOW_WORK,
                ExistingWorkPolicy.REPLACE,
                request
            )
        }
    }
}
