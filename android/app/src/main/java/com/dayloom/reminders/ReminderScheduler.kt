package com.dayloom.reminders

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.dayloom.data.DayloomDb

/**
 * Schedules local reminders with AlarmManager. Exact alarms are used when the
 * user has granted the exact-alarm permission; otherwise alarms are inexact and
 * the UI says so rather than pretending precision.
 */
object ReminderScheduler {

  const val CHANNEL_ID = "dayloom_reminders"
  const val EXTRA_ID = "reminder_id"
  const val EXTRA_TITLE = "reminder_title"
  const val EXTRA_BODY = "reminder_body"

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) {
      return
    }
    manager.createNotificationChannel(
        NotificationChannel(
                CHANNEL_ID, "Reminders", NotificationManager.IMPORTANCE_DEFAULT)
            .apply { description = "Event and task reminders from Dayloom" })
  }

  private const val PREFS_NAME = "dayloom_reminders"
  private const val SCHEDULED_IDS = "scheduled_ids"

  private fun scheduledIds(context: Context): MutableSet<String> =
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
          .getStringSet(SCHEDULED_IDS, emptySet())
          ?.toMutableSet()
          ?: mutableSetOf()

  private fun saveScheduledIds(context: Context, ids: Set<String>) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putStringSet(SCHEDULED_IDS, ids.toSet())
        .apply()
  }

  private fun pendingIntent(context: Context, id: String, title: String, body: String):
      PendingIntent {
    val intent =
        Intent(context, ReminderReceiver::class.java)
            .setAction("com.dayloom.REMINDER")
            .putExtra(EXTRA_ID, id)
            .putExtra(EXTRA_TITLE, title)
            .putExtra(EXTRA_BODY, body)
    return PendingIntent.getBroadcast(
        context,
        id.hashCode(),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  fun notificationsAllowed(context: Context): Boolean =
      DayloomDb.notificationsEnabled(context) &&
          (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
              ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
                  PackageManager.PERMISSION_GRANTED) &&
          NotificationManagerCompat.from(context).areNotificationsEnabled()

  fun schedule(context: Context, id: String, triggerAt: Long, title: String, body: String): Boolean {
    if (!notificationsAllowed(context)) {
      cancel(context, id)
      return false
    }
    if (triggerAt <= System.currentTimeMillis()) {
      cancel(context, id)
      return false
    }
    ensureChannel(context)
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pending = pendingIntent(context, id, title, body)
    val exactAllowed =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()
    return try {
      if (exactAllowed) {
        alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending)
      } else {
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending)
      }
      rememberScheduled(context, id)
      true
    } catch (_: SecurityException) {
      // Exact alarms were revoked between the check and the call.
      try {
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending)
        rememberScheduled(context, id)
        true
      } catch (_: Throwable) {
        cancel(context, id)
        false
      }
    } catch (_: Throwable) {
      cancel(context, id)
      false
    }
  }

  private fun rememberScheduled(context: Context, id: String) {
    val ids = scheduledIds(context)
    ids.add(id)
    saveScheduledIds(context, ids)
  }

  fun cancel(context: Context, id: String) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    alarmManager.cancel(pendingIntent(context, id, "", ""))
    val ids = scheduledIds(context)
    ids.remove(id)
    saveScheduledIds(context, ids)
  }

  fun cancelAll(context: Context) {
    val knownIds = scheduledIds(context)
    (knownIds + DayloomDb.allReminderIds(context)).forEach { cancel(context, it) }
    saveScheduledIds(context, emptySet())
    val notifications = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    notifications.cancelAll()
  }

  /** Re-registers pending reminders and removes alarms for disabled or stale rows. */
  fun syncFromDatabase(context: Context): Int {
    val now = System.currentTimeMillis()
    val reminders = DayloomDb.pendingReminders(context, now)
    val pendingIds = reminders.mapTo(mutableSetOf()) { it.id }
    val knownIds = scheduledIds(context)
    if (!notificationsAllowed(context)) {
      cancelAll(context)
      return 0
    }
    val allIds = DayloomDb.allReminderIds(context)
    (knownIds - allIds).forEach { cancel(context, it) }

    (knownIds - pendingIds).forEach { cancel(context, it) }
    var scheduled = 0
    for (reminder in reminders) {
      if (schedule(context, reminder.id, reminder.triggerAt, reminder.title, reminder.body)) {
        scheduled += 1
      }
    }
    return scheduled
  }
}
