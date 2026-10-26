package com.dayloom.native

import android.app.Activity
import android.content.Intent
import android.net.Uri
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Import/export through the Storage Access Framework: the user picks the file
 * or destination, so the app needs no storage permission and never touches
 * unrelated files.
 */
class DocumentsModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  override fun getName(): String = "Documents"

  @ReactMethod
  fun pickImportFile(mimeType: String, promise: Promise) {
    launch(
        Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mimeType),
        REQUEST_IMPORT,
        promise)
  }

  @ReactMethod
  fun pickExportTarget(fileName: String, mimeType: String, promise: Promise) {
    launch(
        Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mimeType)
            .putExtra(Intent.EXTRA_TITLE, fileName),
        REQUEST_EXPORT,
        promise)
  }

  private fun launch(intent: Intent, requestCode: Int, promise: Promise) {
    val activity = context.currentActivity
    if (activity == null) {
      promise.reject("no_activity", "The app is not in the foreground")
      return
    }
    synchronized(lock) {
      pending?.reject("superseded", "Another file picker was opened")
      pending = promise
      pendingCode = requestCode
    }
    try {
      activity.startActivityForResult(intent, requestCode)
    } catch (error: Throwable) {
      synchronized(lock) {
        if (pending === promise) {
          pending = null
        }
      }
      promise.reject("picker_failed", error.message, error)
    }
  }

  @ReactMethod
  fun readTextFile(uriString: String, promise: Promise) {
    try {
      val uri = Uri.parse(uriString)
      val text =
          context.contentResolver.openInputStream(uri)?.use { stream ->
            stream.bufferedReader().readText()
          } ?: throw IllegalStateException("Could not open the selected file")
      promise.resolve(text)
    } catch (error: Throwable) {
      promise.reject("read_failed", error.message, error)
    }
  }

  @ReactMethod
  fun writeTextFile(uriString: String, contents: String, promise: Promise) {
    try {
      val uri = Uri.parse(uriString)
      context.contentResolver.openOutputStream(uri, "wt")?.use { stream ->
        stream.bufferedWriter().use { it.write(contents) }
      } ?: throw IllegalStateException("Could not open the destination file")
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("write_failed", error.message, error)
    }
  }

  companion object {
    private const val REQUEST_IMPORT = 4301
    private const val REQUEST_EXPORT = 4302
    private val lock = Any()
    private var pending: Promise? = null
    private var pendingCode = 0

    /** Called from MainActivity; returns true when the result was ours. */
    @JvmStatic
    fun handleActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
      synchronized(lock) {
        if (pending == null || requestCode != pendingCode) {
          return false
        }
        val promise = pending
        pending = null
        if (resultCode == Activity.RESULT_OK) {
          val uri = data?.data
          if (uri == null) {
            promise?.reject("no_file", "No file was selected")
          } else {
            promise?.resolve(uri.toString())
          }
        } else {
          // A cancelled picker is not an error; null tells JS to do nothing.
          promise?.resolve(null)
        }
        return true
      }
    }
  }

  init {
    context.addActivityEventListener(
        object : ActivityEventListener {
          override fun onActivityResult(
              activity: Activity,
              requestCode: Int,
              resultCode: Int,
              data: Intent?
          ) {
            handleActivityResult(requestCode, resultCode, data)
          }

          override fun onNewIntent(intent: Intent) {}
        })
  }
}
