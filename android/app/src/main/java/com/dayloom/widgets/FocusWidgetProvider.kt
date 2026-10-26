package com.dayloom.widgets

import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import com.dayloom.R
import com.dayloom.data.DayloomDb

/**
 * Focus timer. The countdown is a native Chronometer driven by the wall clock,
 * so it keeps ticking without the app being open. Tapping opens the focus screen.
 */
class FocusWidgetProvider : DayloomWidgetProvider() {
  override fun renderInstance(context: Context, appWidgetId: Int): RemoteViews =
      render(context, appWidgetId)

  companion object {
    fun render(context: Context, appWidgetId: Int): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.widget_focus)
      val session = DayloomDb.activeFocus(context)
      views.setOnClickPendingIntent(R.id.widget_root, openAppIntent(context, "focus", appWidgetId))
      views.setTextColor(R.id.widget_title, color(context, R.color.ink))
      views.setTextColor(R.id.widget_subtitle, color(context, R.color.ink_muted))

      if (session == null) {
        views.setTextViewText(R.id.widget_title, context.getString(R.string.widget_no_focus))
        views.setTextViewText(R.id.widget_subtitle, "Tap to start one")
        views.setViewVisibility(R.id.focus_chronometer, View.GONE)
        views.setViewVisibility(R.id.widget_empty, View.GONE)
        return views
      }

      val endsAt = session.startedAt + session.plannedMinutes * 60_000L
      val remainingMs = endsAt - System.currentTimeMillis()
      views.setTextViewText(R.id.widget_title, session.label)
      views.setTextViewText(
              R.id.widget_subtitle,
              if (remainingMs > 0) "Until ${DayloomDb.timeLabel(endsAt)}" else "Finished")
      views.setViewVisibility(R.id.focus_chronometer, View.VISIBLE)
      views.setViewVisibility(R.id.widget_empty, View.GONE)
      val base = SystemClock.elapsedRealtime() + maxOf(remainingMs, 0)
      views.setChronometer(R.id.focus_chronometer, base, null, true)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        views.setChronometerCountDown(R.id.focus_chronometer, true)
      }
      views.setTextColor(R.id.focus_chronometer, color(context, R.color.terracotta))
      return views
    }
  }
}
