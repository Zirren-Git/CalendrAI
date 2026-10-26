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
import org.json.JSONObject

class LlamaModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  private data class Loaded(
      val handle: Long,
      val contextSize: Int,
      val threads: Int,
      val path: String,
      val busy: java.util.concurrent.atomic.AtomicBoolean = java.util.concurrent.atomic.AtomicBoolean(false)
  )

  private val handles = ConcurrentHashMap<Int, Loaded>()
  private val stateLock = Any()
  @Volatile private var invalidated = false
  private val nextId = AtomicInteger(1)
  private val inference = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "dayloom-llama-inference")
  }

  override fun getName(): String = "Llama"

  @Keep
  class TokenEmitter(private val consumer: (String) -> Unit) {
    @Keep
    fun emit(piece: String) = consumer(piece)
  }

  @ReactMethod
  fun loadModel(configJson: String, promise: Promise) {
    try {
      val config = JSONObject(configJson)
      val modelPath = config.getString("modelPath")
      val file = File(modelPath)
      val modelsRoot = File(context.filesDir, "models").canonicalFile
      if (!file.isAbsolute || file.canonicalFile.parentFile != modelsRoot || !file.isFile || file.length() < 1024) {
        promise.reject("invalid_model_path", "Models must be loaded from app-private model storage")
        return
      }
      if (!file.extension.equals("gguf", ignoreCase = true)) {
        promise.reject("invalid_model_format", "The local language model must be a GGUF file")
        return
      }
      val contextSize = config.optInt("contextSize", 2048).coerceIn(512, 8192)
      val threads = config.optInt("threads", 2)
          .coerceIn(1, maxOf(1, Runtime.getRuntime().availableProcessors() - 1))
      synchronized(stateLock) {
        if (invalidated) {
          promise.reject("module_invalidated", "The language model bridge is shutting down")
          return
        }
        if (handles.values.any { it.path == file.canonicalPath }) {
          promise.reject("model_already_loaded", "This model is already loaded")
          return
        }
        val handle = nativeLoadModel(file.absolutePath, contextSize, threads)
        if (handle == 0L) {
          promise.reject("model_load_failed", "llama.cpp could not load this model (out of memory or unsupported file)")
          return
        }
        val id = nextId.getAndIncrement()
        handles[id] = Loaded(handle, contextSize, threads, file.canonicalPath)
        promise.resolve(
            JSONObject()
                .put("contextId", id)
                .put("modelPath", file.absolutePath)
                .put("contextSize", contextSize)
                .put("threads", threads)
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
      val loaded = handles[contextId]
      if (loaded == null) {
        promise.resolve(null)
        return
      }
      if (loaded.busy.get()) {
        promise.reject("model_busy", "Wait for generation to finish before unloading this model")
        return
      }
      handles.remove(contextId, loaded)
      try {
        inference.execute {
          synchronized(loaded) {
            try {
              nativeFreeModel(loaded.handle)
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
  fun generate(contextId: Int, prompt: String, maxTokens: Int, temperature: Double, promise: Promise) =
      runGeneration(contextId, prompt, maxTokens, temperature, null, promise)

  @ReactMethod
  fun generateStreaming(
      contextId: Int,
      prompt: String,
      maxTokens: Int,
      temperature: Double,
      onToken: com.facebook.react.bridge.Callback,
      promise: Promise
  ) = runGeneration(contextId, prompt, maxTokens, temperature, onToken, promise)

  private fun runGeneration(
      contextId: Int,
      prompt: String,
      maxTokens: Int,
      temperature: Double,
      onToken: com.facebook.react.bridge.Callback?,
      promise: Promise
  ) {
    if (prompt.isBlank() || prompt.length > 32_000 || !temperature.isFinite() ||
        maxTokens <= 0 || maxTokens > 1024) {
      promise.reject("invalid_generation", "Prompt or generation settings are invalid")
      return
    }
    synchronized(stateLock) {
      if (invalidated) {
        promise.reject("module_invalidated", "The language model bridge is shutting down")
        return
      }
      val loaded = handles[contextId]
      if (loaded == null) {
        promise.reject("invalid_context", "The local model is not loaded")
        return
      }
      if (!loaded.busy.compareAndSet(false, true)) {
        promise.reject("inference_busy", "This model is already generating a response")
        return
      }
      nativeResetCancel(loaded.handle)
      try {
        inference.execute {
          synchronized(loaded) {
            var produced = 0
            val emitter = TokenEmitter { piece ->
              produced += 1
              onToken?.invoke(piece)
            }
            val started = SystemClock.elapsedRealtime()
            try {
              val text = nativeGenerate(
                  loaded.handle, prompt, maxTokens, temperature.coerceIn(0.0, 2.0).toFloat(), emitter)
              val durationMs = SystemClock.elapsedRealtime() - started
              val seconds = maxOf(durationMs / 1000.0, 0.001)
              promise.resolve(
                  JSONObject()
                      .put("text", text)
                      .put("tokens", produced)
                      .put("durationMs", durationMs)
                      .put("tokensPerSecond", produced / seconds)
                      .toString())
            } catch (error: Throwable) {
              promise.reject("generation_failed", error.message, error)
            } finally {
              loaded.busy.set(false)
            }
          }
        }
      } catch (error: RejectedExecutionException) {
        loaded.busy.set(false)
        promise.reject("generation_failed", "Inference worker is shutting down", error)
      }
    }
  }

  @ReactMethod
  fun cancel(contextId: Int, promise: Promise) {
    synchronized(stateLock) {
      val loaded = handles[contextId]
      if (loaded != null && loaded.busy.get()) nativeCancel(loaded.handle)
    }
    promise.resolve(null)
  }

  @ReactMethod
  fun getModelInfo(contextId: Int, promise: Promise) {
    val loaded = synchronized(stateLock) { handles[contextId] }
    if (loaded == null) {
      promise.reject("invalid_context", "The local model is not loaded")
      return
    }
    promise.resolve(
        JSONObject()
            .put("contextId", contextId)
            .put("modelPath", loaded.path)
            .put("contextSize", loaded.contextSize)
            .put("threads", loaded.threads)
            .toString())
  }

  override fun invalidate() {
    val staleHandles = synchronized(stateLock) {
      invalidated = true
      handles.values.toList().also { handles.clear() }
    }
    staleHandles.forEach { nativeCancel(it.handle) }
    try {
      inference.execute {
        staleHandles.forEach { loaded ->
          synchronized(loaded) {
            try {
              nativeFreeModel(loaded.handle)
            } catch (_: Throwable) {
              // Best effort during bridge teardown.
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

  private external fun nativeLoadModel(modelPath: String, contextSize: Int, threads: Int): Long
  private external fun nativeFreeModel(handle: Long)
  private external fun nativeGenerate(
      handle: Long,
      prompt: String,
      maxTokens: Int,
      temperature: Float,
      emitter: TokenEmitter
  ): String
  private external fun nativeCancel(handle: Long)
  private external fun nativeResetCancel(handle: Long)

  companion object {
    init {
      System.loadLibrary("dayloom_llama")
    }
  }
}
