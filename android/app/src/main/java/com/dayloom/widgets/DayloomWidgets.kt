package com.dayloom.widgets

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context

/** Re-renders every launcher widget from the shared local database. */
object DayloomWidgets {

  fun refreshAll(context: Context) {
    val manager = AppWidgetManager.getInstance(context) ?: return
    val providers =
        listOf(
            AgendaWidgetProvider::class.java to AgendaWidgetProvider::render,
            MonthWidgetProvider::class.java to MonthWidgetProvider::render,
            TasksWidgetProvider::class.java to TasksWidgetProvider::render,
            FocusWidgetProvider::class.java to FocusWidgetProvider::render,
            CaptureWidgetProvider::class.java to CaptureWidgetProvider::render,
        )
    for ((provider, render) in providers) {
      val ids = manager.getAppWidgetIds(ComponentName(context, provider))
      if (ids.isEmpty()) continue
      for (id in ids) {
        try {
          manager.updateAppWidget(id, render(context, id))
        } catch (_: Throwable) {
          // One broken widget must not stop the others from refreshing.
        }
      }
    }
  }
}
