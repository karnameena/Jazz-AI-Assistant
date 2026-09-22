package com.gunakarna.jazzassistant.accessibility

import android.util.Log

object AccessibilityLogger {
    private const val TAG = "JAZZ-A11Y"

    fun info(message: String) = Log.i(TAG, message)
    fun warn(message: String) = Log.w(TAG, message)
    fun error(message: String, throwable: Throwable? = null) = Log.e(TAG, message, throwable)
}
