package com.dayloom.widgets

import android.appwidget.AppWidgetManager
import android.content.Context
import android.view.View
import android.widget.RemoteViews
import com.dayloom.R
import com.dayloom.data.DayloomDb

/** Compact agenda: today's next few occurrences from the local database. */
class AgendaWidgetProvider : DayloomWidgetProvider() {
  override fun renderInstance(context: Context, appWidgetId: Int): RemoteViews =
      render(context, appWidgetId)

  companion object {
    private val titles = intArrayOf(R.id.agenda_title_1, R.id.agenda_title_2, R.id.agenda_title_3)
    private val times = intArrayOf(R.id.agenda_time_1, R.id.agenda_time_2, R.id.agenda_time_3)
    private val rows = intArrayOf(R.id.agenda_row_1, R.id.agenda_row_2, R.id.agenda_row_3)

    fun render(context: Context, appWidgetId: Int): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.widget_agenda)
      views.setTextViewText(R.id.widget_title, "Today · ${DayloomDb.todayLabel()}")
      views.setTextColor(R.id.widget_title, color(context, R.color.ink))
      views.setTextColor(R.id.widget_subtitle, color(context, R.color.ink_muted))
      views.setTextViewText(R.id.widget_subtitle, "${DayloomDb.openTasks(context).size} open tasks")
      views.setOnClickPendingIntent(R.id.widget_root, openAppIntent(context, "calendar", appWidgetId))

      val events = DayloomDb.todayEvents(context, 3)
      if (events.isEmpty()) {
        views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
        views.setTextViewText(R.id.widget_empty, context.getString(R.string.widget_empty_agenda))
        views.setTextColor(R.id.widget_empty, color(context, R.color.ink_muted))
        rows.forEach { views.setViewVisibility(it, View.GONE) }
        return views
      }
      views.setViewVisibility(R.id.widget_empty, View.GONE)
      events.forEachIndexed { index, event ->
        views.setViewVisibility(rows[index], View.VISIBLE)
        views.setTextViewText(
            times[index],
            if (event.allDay) "All day" else DayloomDb.timeLabel(event.startAt))
        views.setTextViewText(titles[index], event.title)
        views.setTextColor(times[index], color(context, R.color.terracotta))
        views.setTextColor(titles[index], color(context, R.color.ink))
      }
      for (index in events.size until rows.size) {
        views.setViewVisibility(rows[index], View.GONE)
      }
      return views
    }
  }
}
