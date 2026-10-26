package com.dayloom.widgets

import android.content.Context
import android.view.View
import android.widget.RemoteViews
import com.dayloom.R

/**
 * Quick capture: opens the assistant with the mic ready. Android launcher
 * widgets cannot record audio themselves, so this is a one-tap entry point
 * rather than a background recorder.
 */
class CaptureWidgetProvider : DayloomWidgetProvider() {
  override fun renderInstance(context: Context, appWidgetId: Int): RemoteViews =
      render(context, appWidgetId)

  companion object {
    fun render(context: Context, appWidgetId: Int): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.widget_capture)
      views.setOnClickPendingIntent(
          R.id.capture_button, openAppIntent(context, "assistant", appWidgetId))
      views.setTextViewText(R.id.capture_label, "Capture")
      views.setTextColor(R.id.capture_label, color(context, R.color.ink))
      views.setTextColor(R.id.capture_hint, color(context, R.color.ink_muted))
      views.setViewVisibility(R.id.widget_empty, View.GONE)
      return views
    }
  }
}
