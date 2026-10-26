package com.dayloom.widgets

import android.content.Context
import android.widget.RemoteViews
import com.dayloom.R
import com.dayloom.data.DayloomDb
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * Month grid. Days with at least one event get a dot marker; today is ringed.
 * Uses a 7x6 grid of text cells, which RemoteViews supports natively.
 */
class MonthWidgetProvider : DayloomWidgetProvider() {
  override fun renderInstance(context: Context, appWidgetId: Int): RemoteViews =
      render(context, appWidgetId)

  companion object {
    private val cells =
        intArrayOf(
            R.id.day_0, R.id.day_1, R.id.day_2, R.id.day_3, R.id.day_4, R.id.day_5, R.id.day_6)

    fun render(context: Context, appWidgetId: Int): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.widget_month)
      val calendar = Calendar.getInstance()
      val today = calendar.get(Calendar.DAY_OF_MONTH)
      val todayMonth = calendar.get(Calendar.MONTH)
      val todayYear = calendar.get(Calendar.YEAR)
      calendar.set(Calendar.DAY_OF_MONTH, 1)
      val firstWeekday = calendar.get(Calendar.DAY_OF_WEEK) - 1
      val daysInMonth = calendar.getActualMaximum(Calendar.DAY_OF_MONTH)
      val monthStart = calendar.timeInMillis
      calendar.set(Calendar.DAY_OF_MONTH, daysInMonth)
      val monthEnd = calendar.timeInMillis + 86_399_999L
      val eventDays = DayloomDb.monthEventDays(context, monthStart, monthEnd)

      views.setTextViewText(
          R.id.widget_title,
          SimpleDateFormat("MMMM yyyy", Locale.getDefault()).format(monthStart))
      views.setTextColor(R.id.widget_title, color(context, R.color.ink))
      views.setOnClickPendingIntent(R.id.widget_root, openAppIntent(context, "calendar", appWidgetId))
      views.removeAllViews(R.id.month_rows)

      var day = 1
      for (row in 0..5) {
        val rowViews = RemoteViews(context.packageName, R.layout.widget_month_row)
        for (column in 0..6) {
          val cellId = cells[column]
          val slot = row * 7 + column
          if (slot >= firstWeekday && day <= daysInMonth) {
            rowViews.setTextViewText(cellId, if (eventDays.contains(day)) "$day·" else "$day")
            val isToday = day == today
            rowViews.setTextColor(
                cellId,
                color(context, if (isToday) R.color.ink else R.color.ink_muted))
            rowViews.setInt(
                cellId,
                "setBackgroundResource",
                if (isToday) R.drawable.widget_day_today else R.drawable.widget_day_plain)
            day += 1
          } else {
            rowViews.setTextViewText(cellId, "")
            rowViews.setInt(cellId, "setBackgroundResource", R.drawable.widget_day_plain)
          }
        }
        views.addView(R.id.month_rows, rowViews)
      }
      return views
    }
  }
}
