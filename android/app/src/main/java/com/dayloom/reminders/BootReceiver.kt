package com.dayloom.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Alarms do not survive a reboot or a clock change, so the pending reminders are
 * rebuilt from the database when either happens.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      Intent.ACTION_TIME_CHANGED,
      Intent.ACTION_TIMEZONE_CHANGED -> {
        try {
          ReminderScheduler.syncFromDatabase(context)
        } catch (_: Throwable) {
          // Nothing actionable at boot; the app resyncs on next launch.
        }
      }
    }
  }
}
