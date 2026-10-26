package com.dayloom.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.RemoteViews
import com.dayloom.MainActivity

internal fun openAppIntent(context: Context, route: String, requestCode: Int): PendingIntent {
  val intent =
      Intent(context, MainActivity::class.java)
          .putExtra(MainActivity.EXTRA_ROUTE, route)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
  return PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
}

internal fun color(context: Context, resId: Int): Int =
    androidx.core.content.ContextCompat.getColor(context, resId)

/** Base provider that re-renders every instance on update, resize and boot. */
abstract class DayloomWidgetProvider : AppWidgetProvider() {
  protected abstract fun renderInstance(context: Context, appWidgetId: Int): RemoteViews

  override fun onUpdate(
      context: Context,
      appWidgetManager: AppWidgetManager,
      appWidgetIds: IntArray
  ) {
    for (id in appWidgetIds) {
      try {
        appWidgetManager.updateAppWidget(id, renderInstance(context, id))
      } catch (_: Throwable) {
        // Never let a single widget failure crash the launcher.
      }
    }
  }

  override fun onAppWidgetOptionsChanged(
      context: Context,
      appWidgetManager: AppWidgetManager,
      appWidgetId: Int,
      newOptions: Bundle
  ) {
    try {
      appWidgetManager.updateAppWidget(appWidgetId, renderInstance(context, appWidgetId))
    } catch (_: Throwable) {
    }
  }
}

internal fun idsFor(context: Context, provider: Class<out AppWidgetProvider>): IntArray =
    AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, provider))
