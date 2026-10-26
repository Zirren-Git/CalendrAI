package com.dayloom.native

import com.dayloom.WidgetLaunch
import com.dayloom.widgets.DayloomWidgets
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class WidgetsModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  override fun getName(): String = "Widgets"

  @ReactMethod
  fun refresh(promise: Promise) {
    try {
      DayloomWidgets.refreshAll(context)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("widget_refresh_failed", error.message, error)
    }
  }

  @ReactMethod
  fun supported(promise: Promise) {
    promise.resolve(true)
  }

  /** Returns and clears the route requested by a widget tap, if any. */
  @ReactMethod
  fun consumeLaunchTarget(promise: Promise) {
    promise.resolve(WidgetLaunch.consume())
  }
}
