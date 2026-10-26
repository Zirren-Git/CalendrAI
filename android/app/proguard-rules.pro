# React Native
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }

# Dayloom native bridge: module names and @ReactMethod signatures are resolved
# reflectively by the bridge, so they must not be renamed.
-keep class com.dayloom.native.** { *; }
-keepclassmembers class * extends com.facebook.react.bridge.ReactContextBaseJavaModule {
  @com.facebook.react.bridge.ReactMethod <methods>;
}

# Launcher widget providers and receivers are instantiated by the system.
-keep class com.dayloom.widgets.** { *; }
-keep class com.dayloom.reminders.** { *; }
