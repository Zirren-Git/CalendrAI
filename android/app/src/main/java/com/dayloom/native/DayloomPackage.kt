package com.dayloom.native

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class DayloomPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
      listOf(
          WhisperModule(reactContext),
          LlamaModule(reactContext),
          AudioCaptureModule(reactContext),
          ModelStoreModule(reactContext),
          RemindersModule(reactContext),
          DocumentsModule(reactContext),
          WidgetsModule(reactContext),
      )

  override fun createViewManagers(
      reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> = emptyList()
}
