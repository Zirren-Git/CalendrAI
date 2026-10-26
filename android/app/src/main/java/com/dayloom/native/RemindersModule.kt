package com.dayloom.native

import android.Manifest
import android.app.AlarmManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationManagerCompat
import com.dayloom.data.DayloomDb
import com.dayloom.reminders.ReminderScheduler
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class RemindersModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  override fun getName(): String = "Reminders"

  private fun notificationsAllowed(): Boolean =
      DayloomDb.notificationsEnabled(context) &&
          (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
              ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
                  PackageManager.PERMISSION_GRANTED) &&
          NotificationManagerCompat.from(context).areNotificationsEnabled()

  @ReactMethod
  fun hasPermission(promise: Promise) {
    promise.resolve(notificationsAllowed())
  }

  /**
   * The system dialog itself is triggered from JS with PermissionsAndroid,
   * which owns the activity result. This reports the current state so the UI
   * can decide whether to ask.
   */
  @ReactMethod
  fun requestPermission(promise: Promise) {
    promise.resolve(notificationsAllowed())
  }

  @ReactMethod
  fun canScheduleExactAlarms(promise: Promise) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val allowed =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          alarmManager.canScheduleExactAlarms()
        } else {
          true
        }
    promise.resolve(allowed)
  }

  @ReactMethod
  fun schedule(id: String, triggerAt: Double, title: String, body: String, promise: Promise) {
    if (!triggerAt.isFinite() || triggerAt % 1.0 != 0.0 ||
        triggerAt < Long.MIN_VALUE.toDouble() || triggerAt > Long.MAX_VALUE.toDouble()) {
      promise.reject("invalid_trigger", "Reminder trigger time is invalid")
      return
    }
    try {
      if (!notificationsAllowed()) {
        ReminderScheduler.cancel(context, id)
        promise.reject("notifications_denied", "Notifications are disabled or permission is not granted")
        return
      }
      val scheduled =
          ReminderScheduler.schedule(context, id, triggerAt.toLong(), title, body ?: "")
      promise.resolve(scheduled)
    } catch (error: Throwable) {
      promise.reject("reminder_schedule_failed", error.message, error)
    }
  }

  @ReactMethod
  fun cancel(id: String, promise: Promise) {
    try {
      ReminderScheduler.cancel(context, id)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("reminder_cancel_failed", error.message, error)
    }
  }

  @ReactMethod
  fun syncFromDatabase(promise: Promise) {
    try {
      promise.resolve(ReminderScheduler.syncFromDatabase(context))
    } catch (error: Throwable) {
      promise.reject("reminder_sync_failed", error.message, error)
    }
  }

  @ReactMethod
  fun cancelAll(promise: Promise) {
    try {
      ReminderScheduler.cancelAll(context)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("reminder_cancel_failed", error.message, error)
    }
  }

  @ReactMethod
  fun pendingCount(promise: Promise) {
    try {
      val db = DayloomDb.open(context)
      db.rawQuery(
              "SELECT COUNT(*) FROM reminders WHERE dismissed_at IS NULL AND trigger_at > ?",
              arrayOf(System.currentTimeMillis().toString()))
          .use { cursor ->
            cursor.moveToFirst()
            promise.resolve(cursor.getInt(0))
          }
    } catch (error: Throwable) {
      promise.reject("reminder_count_failed", error.message, error)
    }
  }

  @ReactMethod
  fun openNotificationSettings(promise: Promise) {
    try {
      val intent =
          android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
              .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName)
              .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.resolve(false)
    }
  }

}
