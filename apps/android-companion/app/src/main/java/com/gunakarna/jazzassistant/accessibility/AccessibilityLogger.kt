package com.gunakarna.jazzassistant.accessibility

import android.util.Log

object AccessibilityLogger {
    private const val TAG = "JAZZ-A11Y"

    fun intent(message: String) = Log.i(TAG, "[JAZZ-INTENT] $message")
    fun plan(message: String) = Log.i(TAG, "[JAZZ-PLAN] $message")
    fun accessibility(message: String) = Log.i(TAG, "[JAZZ-ACCESSIBILITY] $message")
    fun node(message: String) = Log.d(TAG, "[JAZZ-NODE] $message")
    fun action(message: String) = Log.i(TAG, "[JAZZ-ACTION] $message")
    fun waitLog(message: String) = Log.d(TAG, "[JAZZ-WAIT] $message")
    fun verify(message: String) = Log.i(TAG, "[JAZZ-VERIFY] $message")
    fun info(message: String) = Log.i(TAG, message)
    fun warn(message: String) = Log.w(TAG, message)
    fun error(message: String, throwable: Throwable? = null) = Log.e(TAG, "[JAZZ-ERROR] $message", throwable)
}
