package com.dayloom

import android.content.Intent
import android.os.Bundle
import com.dayloom.native.DocumentsModule
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun getMainComponentName(): String = "Dayloom"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    captureRoute(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    captureRoute(intent)
  }

  /**
   * Launcher widget taps carry a route (for example "assistant" for quick
   * capture). The JS layer consumes it once on mount; unknown values are
   * ignored rather than opening an arbitrary screen.
   */
  private fun captureRoute(intent: Intent?) {
    val route = intent?.getStringExtra(EXTRA_ROUTE) ?: return
    val allowed = setOf("dashboard", "calendar", "tasks", "notes", "habits", "focus", "assistant")
    if (route in allowed) {
      WidgetLaunch.route = route
    }
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    if (!DocumentsModule.handleActivityResult(requestCode, resultCode, data)) {
      super.onActivityResult(requestCode, resultCode, data)
    }
  }

  companion object {
    const val EXTRA_ROUTE = "com.dayloom.route"
  }
}

/** Process-wide holder for a pending widget route. */
object WidgetLaunch {
  @Volatile var route: String? = null

  fun consume(): String? {
    val value = route
    route = null
    return value
  }
}
