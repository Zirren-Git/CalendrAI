package com.dayloom.widgets

import android.content.Context
import android.view.View
import android.widget.RemoteViews
import com.dayloom.R
import com.dayloom.data.DayloomDb
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Task list: the next open tasks, ordered by due date then priority. */
class TasksWidgetProvider : DayloomWidgetProvider() {
  override fun renderInstance(context: Context, appWidgetId: Int): RemoteViews =
      render(context, appWidgetId)

  companion object {
    private val titles = intArrayOf(R.id.task_title_1, R.id.task_title_2, R.id.task_title_3, R.id.task_title_4)
    private val dues = intArrayOf(R.id.task_due_1, R.id.task_due_2, R.id.task_due_3, R.id.task_due_4)
    private val rows = intArrayOf(R.id.task_row_1, R.id.task_row_2, R.id.task_row_3, R.id.task_row_4)
    private val dateFormat = SimpleDateFormat("EEE d MMM", Locale.getDefault())

    fun render(context: Context, appWidgetId: Int): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.widget_tasks)
      val tasks = DayloomDb.openTasks(context, 4)
      views.setTextViewText(R.id.widget_title, "Open tasks")
      views.setTextColor(R.id.widget_title, color(context, R.color.ink))
      views.setTextColor(R.id.widget_subtitle, color(context, R.color.ink_muted))
      views.setTextViewText(R.id.widget_subtitle, "${tasks.size} shown")
      views.setOnClickPendingIntent(R.id.widget_root, openAppIntent(context, "tasks", appWidgetId))

      if (tasks.isEmpty()) {
        views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
        views.setTextViewText(R.id.widget_empty, context.getString(R.string.widget_empty_tasks))
        views.setTextColor(R.id.widget_empty, color(context, R.color.ink_muted))
        rows.forEach { views.setViewVisibility(it, View.GONE) }
        return views
      }
      views.setViewVisibility(R.id.widget_empty, View.GONE)
      tasks.forEachIndexed { index, task ->
        views.setViewVisibility(rows[index], View.VISIBLE)
        views.setTextViewText(titles[index], task.title)
        views.setTextColor(titles[index], color(context, R.color.ink))
        views.setTextViewText(
            dues[index],
            task.dueAt?.let { dateFormat.format(Date(it)) } ?: "No date")
        views.setTextColor(dues[index], color(context, R.color.ink_muted))
      }
      for (index in tasks.size until rows.size) {
        views.setViewVisibility(rows[index], View.GONE)
      }
      return views
    }
  }
}
