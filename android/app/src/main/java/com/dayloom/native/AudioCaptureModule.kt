package com.dayloom.native

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.SystemClock
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.roundToInt
import org.json.JSONObject

/**
 * Records mono PCM with AudioRecord and writes a real 16 kHz 16-bit WAV file,
 * which is exactly what whisper.cpp expects. If the device cannot capture at
 * 16 kHz, the captured audio is resampled explicitly; the file is never merely
 * renamed and assumed to be WAV.
 */
class AudioCaptureModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  private var recorder: AudioRecord? = null
  private var thread: Thread? = null
  private val buffer = ByteArrayOutputStream()
  private val running = AtomicBoolean(false)
  private var startedAt = 0L
  private var captureRate = TARGET_RATE
  private var lastAmplitude = 0.0

  override fun getName(): String = "AudioCapture"

  private fun hasPermission(): Boolean =
      ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
          PackageManager.PERMISSION_GRANTED

  @ReactMethod
  fun hasPermission(promise: Promise) {
    promise.resolve(hasPermission())
  }

  /**
   * The system dialog is requested from JS through PermissionsAndroid, which
   * owns the activity result. This reports the current state.
   */
  @ReactMethod
  fun requestPermission(promise: Promise) {
    promise.resolve(hasPermission())
  }

  @ReactMethod
  fun sampleRate(promise: Promise) {
    promise.resolve(TARGET_RATE)
  }

  @ReactMethod
  fun amplitude(promise: Promise) {
    promise.resolve(lastAmplitude)
  }

  @ReactMethod
  fun startCapture(promise: Promise) {
    if (!hasPermission()) {
      promise.reject("permission_denied", "Microphone permission is required")
      return
    }
    if (running.get()) {
      promise.reject("already_recording", "A recording is already in progress")
      return
    }
    val rate =
        if (AudioRecord.getMinBufferSize(
                TARGET_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT) > 0) TARGET_RATE
        else FALLBACK_RATE
    val minBuffer =
        AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (minBuffer <= 0) {
      promise.reject("audio_unavailable", "This device cannot record audio")
      return
    }
    val record =
        try {
          AudioRecord(
              MediaRecorder.AudioSource.VOICE_RECOGNITION,
              rate,
              AudioFormat.CHANNEL_IN_MONO,
              AudioFormat.ENCODING_PCM_16BIT,
              maxOf(minBuffer * 2, 8192))
        } catch (error: Throwable) {
          promise.reject("audio_unavailable", error.message, error)
          return
        }
    if (record.state != AudioRecord.STATE_INITIALIZED) {
      record.release()
      promise.reject("audio_unavailable", "The microphone could not be opened")
      return
    }
    buffer.reset()
    captureRate = rate
    startedAt = SystemClock.elapsedRealtime()
    running.set(true)
    recorder = record
    try {
      record.startRecording()
    } catch (error: Throwable) {
      running.set(false)
      record.release()
      recorder = null
      promise.reject("audio_start_failed", error.message, error)
      return
    }
    thread =
        Thread {
              val chunk = ByteArray(3200)
              val deadline = startedAt + MAX_DURATION_MS
              try {
                while (running.get() && SystemClock.elapsedRealtime() < deadline) {
                  val read = record.read(chunk, 0, chunk.size)
                  if (read > 0) {
                    buffer.write(chunk, 0, read)
                    lastAmplitude = rms(chunk, read)
                  } else if (read < 0) {
                    break
                  }
                }
              } catch (_: Throwable) {
                // Treat an interrupted read as the end of the recording.
              }
            }
            .also { it.name = "dayloom-audio-capture"; it.start() }
    promise.resolve(
        JSONObject().put("sampleRate", rate).put("maxDurationMs", MAX_DURATION_MS).toString())
  }

  private fun rms(chunk: ByteArray, length: Int): Double {
    if (length < 2) {
      return 0.0
    }
    var sum = 0.0
    var count = 0
    var index = 0
    while (index + 1 < length) {
      val sample = ((chunk[index + 1].toInt() shl 8) or (chunk[index].toInt() and 0xFF)).toShort()
      sum += abs(sample.toDouble())
      count += 1
      index += 2
    }
    return if (count == 0) 0.0 else sum / count / Short.MAX_VALUE
  }

  @ReactMethod
  fun stopCapture(promise: Promise) {
    if (!running.get() && recorder == null) {
      promise.reject("not_recording", "No recording is in progress")
      return
    }
    running.set(false)
    try {
      thread?.join(1500)
    } catch (_: InterruptedException) {
    }
    thread = null
    recorder?.let { record ->
      try {
        record.stop()
      } catch (_: Throwable) {
      }
      record.release()
    }
    recorder = null
    val durationMs = SystemClock.elapsedRealtime() - startedAt
    try {
      val pcm = buffer.toByteArray()
      if (pcm.isEmpty()) {
        promise.reject("empty_audio", "Nothing was recorded")
        return
      }
      val resampled = if (captureRate == TARGET_RATE) pcm else resample(pcm, captureRate, TARGET_RATE)
      val directory = File(context.filesDir, "recordings").apply { mkdirs() }
      val file = File(directory, "ptt-${System.currentTimeMillis()}.wav")
      writeWav(file, resampled, TARGET_RATE)
      promise.resolve(
          JSONObject()
              .put("path", file.absolutePath)
              .put("durationMs", durationMs)
              .put("bytes", resampled.size)
              .toString())
    } catch (error: Throwable) {
      promise.reject("audio_write_failed", error.message, error)
    }
  }

  @ReactMethod
  fun cancelCapture(promise: Promise) {
    running.set(false)
    try {
      thread?.join(500)
    } catch (_: InterruptedException) {
    }
    thread = null
    recorder?.let { record ->
      try {
        record.stop()
      } catch (_: Throwable) {
      }
      record.release()
    }
    recorder = null
    buffer.reset()
    promise.resolve(null)
  }

  /** Linear resampling; adequate for 16 kHz speech and fully deterministic. */
  private fun resample(input: ByteArray, from: Int, to: Int): ByteArray {
    if (from == to) {
      return input
    }
    val inSamples = input.size / 2
    if (inSamples == 0) {
      return input
    }
    val inBuffer = ByteBuffer.wrap(input).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
    val ratio = from.toDouble() / to.toDouble()
    val outSamples = (inSamples / ratio).roundToInt().coerceAtLeast(1)
    val out = ByteBuffer.allocate(outSamples * 2).order(ByteOrder.LITTLE_ENDIAN)
    for (index in 0 until outSamples) {
      val position = index * ratio
      val lower = position.toInt().coerceIn(0, inSamples - 1)
      val upper = (lower + 1).coerceAtMost(inSamples - 1)
      val fraction = position - lower
      val value = inBuffer.get(lower) * (1 - fraction) + inBuffer.get(upper) * fraction
      out.putShort(value.roundToInt().toShort())
    }
    return out.array()
  }

  private fun writeWav(file: File, pcm: ByteArray, sampleRate: Int) {
    RandomAccessFile(file, "rw").use { out ->
      out.setLength(0)
      out.writeBytes("RIFF")
      out.writeIntLe(36 + pcm.size)
      out.writeBytes("WAVE")
      out.writeBytes("fmt ")
      out.writeIntLe(16)
      out.writeShortLe(1) // PCM
      out.writeShortLe(1) // mono
      out.writeIntLe(sampleRate)
      out.writeIntLe(sampleRate * 2)
      out.writeShortLe(2)
      out.writeShortLe(16)
      out.writeBytes("data")
      out.writeIntLe(pcm.size)
      out.write(pcm)
    }
  }

  private fun RandomAccessFile.writeIntLe(value: Int) {
    write(ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(value).array())
  }

  private fun RandomAccessFile.writeShortLe(value: Int) {
    write(ByteBuffer.allocate(2).order(ByteOrder.LITTLE_ENDIAN).putShort(value.toShort()).array())
  }

  override fun invalidate() {
    running.set(false)
    recorder?.release()
    recorder = null
    super.invalidate()
  }

  companion object {
    private const val TARGET_RATE = 16000
    private const val FALLBACK_RATE = 44100
    private const val MAX_DURATION_MS = 60_000L
  }
}
