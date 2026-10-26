package com.dayloom.native

import android.os.SystemClock
import androidx.annotation.Keep
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONArray
import org.json.JSONObject

class WhisperModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  private val handles = ConcurrentHashMap<Int, Long>()
  private val activeHandles = ConcurrentHashMap.newKeySet<Int>()
  private val handleLocks = ConcurrentHashMap<Int, Any>()
  private val cancelling = ConcurrentHashMap.newKeySet<Int>()
  private val stateLock = Any()
  @Volatile private var invalidated = false
  private val nextId = AtomicInteger(1)
  private val inference = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "dayloom-whisper-inference")
  }

  override fun getName(): String = "Whisper"

  @Keep
  class SegmentEmitter(private val consumer: (String, Long, Long) -> Unit) {
    @Keep
    fun emit(text: String, startMs: Long, endMs: Long) = consumer(text, startMs, endMs)
  }

  private fun boundedThreads(requested: Int): Int {
    val cores = Runtime.getRuntime().availableProcessors()
    return requested.coerceIn(1, maxOf(1, minOf(cores - 1, 4)))
  }

  @ReactMethod
  fun loadModel(modelPath: String, threads: Int, promise: Promise) {
    try {
      val file = File(modelPath)
      val modelsRoot = File(context.filesDir, "models").canonicalFile
      if (!file.isAbsolute || file.canonicalFile.parentFile != modelsRoot || !file.isFile || file.length() < 1024) {
        promise.reject("model_missing", "Model file not found at $modelPath")
        return
      }
      synchronized(stateLock) {
        if (invalidated) {
          promise.reject("module_invalidated", "The transcription bridge is shutting down")
          return
        }
        val threadCount = boundedThreads(threads)
        val handle = nativeLoadModel(file.absolutePath, threadCount)
        if (handle == 0L) {
          promise.reject("model_load_failed", "whisper.cpp could not load this model file")
          return
        }
        val id = nextId.getAndIncrement()
        handles[id] = handle
        handleLocks[id] = Any()
        promise.resolve(
            JSONObject()
                .put("contextId", id)
                .put("modelPath", file.absolutePath)
                .put("threads", threadCount)
                .put("sampleRate", 16000)
                .toString())
      }
    } catch (error: Throwable) {
      promise.reject("model_load_failed", error.message, error)
    }
  }

  @ReactMethod
  fun unloadModel(contextId: Int, promise: Promise) {
    synchronized(stateLock) {
      if (invalidated) {
        promise.resolve(null)
        return
      }
      val handle = handles[contextId]
      if (handle == null) {
        promise.resolve(null)
        return
      }
      if (contextId in activeHandles) {
        promise.reject("model_busy", "Wait for transcription to finish before unloading this model")
        return
      }
      handles.remove(contextId, handle)
      val handleLock = handleLocks.getOrPut(contextId) { Any() }
      try {
        inference.execute {
          synchronized(handleLock) {
            try {
              nativeFreeModel(handle)
              handleLocks.remove(contextId, handleLock)
              promise.resolve(null)
            } catch (error: Throwable) {
              promise.reject("model_unload_failed", error.message, error)
            }
          }
        }
      } catch (error: RejectedExecutionException) {
        promise.reject("model_unload_failed", "Inference worker is shutting down", error)
      }
    }
  }

  @ReactMethod
  fun transcribe(
      contextId: Int,
      audioPath: String,
      language: String,
      threads: Int,
      promise: Promise
  ) = runTranscription(contextId, audioPath, language, threads, null, promise)

  @ReactMethod
  fun transcribeStreaming(
      contextId: Int,
      audioPath: String,
      language: String,
      threads: Int,
      onSegment: com.facebook.react.bridge.Callback,
      promise: Promise
  ) = runTranscription(contextId, audioPath, language, threads, onSegment, promise)

  private fun runTranscription(
      contextId: Int,
      audioPath: String,
      language: String,
      threads: Int,
      onSegment: com.facebook.react.bridge.Callback?,
      promise: Promise
  ) {
    val audio = File(audioPath)
    val recordingsRoot = File(context.filesDir, "recordings").canonicalFile
    if (!audio.isAbsolute || audio.canonicalFile.parentFile != recordingsRoot || !audio.isFile ||
        audio.length() == 0L || audio.length() > 2_000_000) {
      promise.reject("audio_missing", "No private recording found to transcribe")
      return
    }
    synchronized(stateLock) {
      if (invalidated) {
        promise.reject("module_invalidated", "The transcription bridge is shutting down")
        return
      }
      val handle = handles[contextId]
      if (handle == null) {
        promise.reject("invalid_context", "This model is not loaded")
        return
      }
      if (!activeHandles.add(contextId)) {
        promise.reject("inference_busy", "This model is already transcribing")
        return
      }
      cancelling.remove(contextId)
      handleLocks.putIfAbsent(contextId, Any())
      nativeResetCancel(handle)
      try {
        val handleLock = handleLocks[contextId]!!
        inference.execute {
          synchronized(handleLock) {
            try {
              if (synchronized(stateLock) { cancelling.remove(contextId) }) {
                promise.reject("transcribe_cancelled", "Transcription cancelled")
                return@execute
              }
              val segments = mutableListOf<Triple<String, Long, Long>>()
              val emitter = SegmentEmitter { text, startMs, endMs ->
                segments.add(Triple(text, startMs, endMs))
                onSegment?.invoke(
                    JSONObject()
                        .put("text", text)
                        .put("startMs", startMs)
                        .put("endMs", endMs)
                        .toString())
              }
              val started = SystemClock.elapsedRealtime()
              val text = nativeTranscribe(
                  handle,
                  audio.absolutePath,
                  language.ifBlank { "auto" },
                  boundedThreads(threads),
                  emitter)
              if (synchronized(stateLock) { cancelling.contains(contextId) }) {
                throw IllegalStateException("Transcription cancelled")
              }
              val durationMs = SystemClock.elapsedRealtime() - started
              val segmentArray = JSONArray()
              segments.forEach { (segmentText, startMs, endMs) ->
                segmentArray.put(
                    JSONObject().put("text", segmentText).put("startMs", startMs).put("endMs", endMs))
              }
              promise.resolve(
                  JSONObject()
                      .put("text", text.trim())
                      .put("segments", segmentArray)
                      .put("language", language.ifBlank { "auto" })
                      .put("durationMs", durationMs)
                      .put("audioMs", segments.lastOrNull()?.third ?: 0L)
                      .toString())
            } catch (error: Throwable) {
              val cancelled = synchronized(stateLock) { cancelling.contains(contextId) }
              promise.reject(if (cancelled) "transcribe_cancelled" else "transcribe_failed", error.message, error)
            } finally {
              synchronized(stateLock) {
                cancelling.remove(contextId)
                activeHandles.remove(contextId)
              }
            }
          }
        }
      } catch (error: RejectedExecutionException) {
        activeHandles.remove(contextId)
        cancelling.remove(contextId)
        promise.reject("transcribe_failed", "Inference worker is shutting down", error)
      }
    }
  }

  @ReactMethod
  fun cancel(contextId: Int, promise: Promise) {
    synchronized(stateLock) {
      if (contextId in activeHandles) {
        cancelling.add(contextId)
        handles[contextId]?.let { nativeCancel(it) }
      }
    }
    promise.resolve(null)
  }

  @ReactMethod
  fun getModelInfo(contextId: Int, promise: Promise) {
    if (synchronized(stateLock) { handles[contextId] } == null) {
      promise.reject("invalid_context", "This model is not loaded")
      return
    }
    promise.resolve(
        JSONObject()
            .put("contextId", contextId)
            .put("modelPath", "")
            .put("threads", 0)
            .put("sampleRate", 16000)
            .toString())
  }

  override fun invalidate() {
    val stale = synchronized(stateLock) {
      invalidated = true
      val entries = handles.entries.toList()
      entries.filter { it.key in activeHandles }.forEach {
        cancelling.add(it.key)
        nativeCancel(it.value)
      }
      handles.clear()
      entries
    }
    try {
      inference.execute {
        stale.forEach { (contextId, handle) ->
          synchronized(handleLocks.getOrPut(contextId) { Any() }) {
            try {
              nativeFreeModel(handle)
            } catch (_: Throwable) {
              // Best effort during bridge teardown.
            } finally {
              handleLocks.remove(contextId)
            }
          }
        }
        inference.shutdown()
      }
    } catch (_: RejectedExecutionException) {
      inference.shutdown()
    }
    super.invalidate()
  }

  private external fun nativeLoadModel(modelPath: String, threads: Int): Long
  private external fun nativeFreeModel(handle: Long)
  private external fun nativeTranscribe(
      handle: Long,
      audioPath: String,
      language: String,
      threads: Int,
      emitter: SegmentEmitter
  ): String
  private external fun nativeCancel(handle: Long)
  private external fun nativeResetCancel(handle: Long)

  companion object {
    init {
      System.loadLibrary("dayloom_whisper")
    }
  }
}
