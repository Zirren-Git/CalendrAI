package com.dayloom.reminders

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.dayloom.MainActivity
import com.dayloom.R
import com.dayloom.data.DayloomDb

/** Posts the reminder notification and marks it as fired in the database. */
class ReminderReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(ReminderScheduler.EXTRA_ID) ?: return
    val title = intent.getStringExtra(ReminderScheduler.EXTRA_TITLE) ?: "Reminder"
    val body = intent.getStringExtra(ReminderScheduler.EXTRA_BODY) ?: ""

    if (!ReminderScheduler.notificationsAllowed(context) ||
        (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED)) {
      ReminderScheduler.cancel(context, id)
      // Without permission there is nothing useful to show; the reminder stays
      // in the in-app reminder inbox.
      return
    }

    ReminderScheduler.ensureChannel(context)
    val openIntent =
        Intent(context, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_ROUTE, "dashboard")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    val contentIntent =
        PendingIntent.getActivity(
            context,
            id.hashCode(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    val notification =
        NotificationCompat.Builder(context, ReminderScheduler.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(Notification.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(contentIntent)
            .build()

    try {
      NotificationManagerCompat.from(context).notify(id.hashCode(), notification)
    } catch (_: SecurityException) {
      return
    }
    DayloomDb.markReminderFired(context, id)
    ReminderScheduler.cancel(context, id)
  }
}
