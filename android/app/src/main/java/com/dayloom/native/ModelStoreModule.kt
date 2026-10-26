package com.dayloom.native

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.StatFs
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

/**
 * App-private file access, streaming SHA-256 and resumable HTTPS downloads.
 * Model bytes are streamed straight to disk; nothing is buffered in JS or in
 * memory here.
 */
class ModelStoreModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  @Volatile private var cancelRequested = false
  private val downloadActive = AtomicBoolean(false)
  private val downloadStateLock = Any()
  @Volatile private var activeConnection: HttpURLConnection? = null
  private val downloadExecutor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "dayloom-model-download")
  }

  override fun getName(): String = "ModelStore"

  private fun modelsDir(): File = File(context.filesDir, "models").apply { mkdirs() }

  private fun safePrivateFile(path: String): File {
    val root = context.filesDir.canonicalFile
    val requested = File(path)
    if (!requested.isAbsolute) {
      throw SecurityException("File path must be absolute")
    }
    val requestedParent = requested.parentFile ?: throw SecurityException("File path must have a parent")
    val normalized = File(requestedParent.canonicalFile, requested.name)
    val rootPath = root.path + File.separator
    if (!normalized.path.startsWith(rootPath)) {
      throw SecurityException("File path is outside app-private storage")
    }
    val canonicalParent = normalized.parentFile?.canonicalFile ?: root
    val file = File(canonicalParent, normalized.name)
    if (!file.canonicalPath.startsWith(rootPath)) {
      throw SecurityException("File path is outside app-private storage")
    }
    return file
  }

  private fun safeModelFile(path: String): File {
    val file = safePrivateFile(path)
    val rootPath = File(context.filesDir, "models").canonicalFile.path + File.separator
    if (!file.path.startsWith(rootPath)) {
      throw SecurityException("File path is outside private model storage")
    }
    return file
  }

  @ReactMethod
  fun modelsDir(promise: Promise) {
    promise.resolve(modelsDir().absolutePath)
  }

  @ReactMethod
  fun freeSpaceBytes(promise: Promise) {
    try {
      val stat = StatFs(modelsDir().absolutePath)
      promise.resolve(stat.availableBytes.toDouble())
    } catch (error: Throwable) {
      promise.reject("stat_failed", error.message, error)
    }
  }

  @ReactMethod
  fun deviceRamMb(promise: Promise) {
    val info = android.app.ActivityManager.MemoryInfo()
    (context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager)
        .getMemoryInfo(info)
    promise.resolve((info.totalMem / (1024 * 1024)).toInt())
  }

  @ReactMethod
  fun deviceAbi(promise: Promise) {
    promise.resolve(Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown")
  }

  @ReactMethod
  fun isWifiConnected(promise: Promise) {
    try {
      val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val network = manager.activeNetwork
      val capabilities = network?.let { manager.getNetworkCapabilities(it) }
      promise.resolve(capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true)
    } catch (error: Throwable) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun sha256File(path: String, promise: Promise) {
    val file = try { safeModelFile(path) } catch (error: Throwable) {
      promise.reject("invalid_path", error.message, error)
      return
    }
    if (!file.isFile) {
      promise.reject("file_missing", "File not found")
      return
    }
    try {
      val digest = MessageDigest.getInstance("SHA-256")
      file.inputStream().use { stream ->
        val buffer = ByteArray(256 * 1024)
        while (true) {
          val read = stream.read(buffer)
          if (read <= 0) break
          digest.update(buffer, 0, read)
        }
      }
      promise.resolve(digest.digest().joinToString("") { "%02x".format(it) })
    } catch (error: Throwable) {
      promise.reject("hash_failed", error.message, error)
    }
  }

  @ReactMethod
  fun fileExists(path: String, promise: Promise) {
    promise.resolve(runCatching { safeModelFile(path).isFile }.getOrDefault(false))
  }

  @ReactMethod
  fun fileSize(path: String, promise: Promise) {
    val file = try { safeModelFile(path) } catch (_: Throwable) { promise.resolve(0.0); return }
    promise.resolve(if (file.isFile) file.length().toDouble() else 0.0)
  }

  @ReactMethod
  fun deleteFile(path: String, promise: Promise) {
    try {
      val file = safePrivateFile(path)
      if (!file.path.startsWith(File(context.filesDir, "models").canonicalFile.path + File.separator) ||
          file.name.endsWith(".promoting") || file.name.endsWith(".installing")) {
        promise.reject("invalid_path", "Only model files may be deleted through this method")
        return
      }
      if (file.exists() && !file.delete()) {
        promise.reject("delete_failed", "Could not delete ${file.name}")
        return
      }
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("delete_failed", error.message, error)
    }
  }

  @ReactMethod
  fun renameFile(from: String, to: String, promise: Promise) {
    try {
      val source = safeModelFile(from)
      val target = safeModelFile(to)
      if (!source.isFile) {
        promise.reject("rename_failed", "Source file does not exist")
        return
      }
      if (target.exists()) {
        promise.reject("rename_failed", "The destination file already exists")
        return
      }
      target.parentFile?.mkdirs()
      val temporary = File(target.parentFile, "${target.name}.promoting")
      if (temporary.exists() && !temporary.delete()) {
        promise.reject("rename_failed", "Could not clear the temporary promotion file")
        return
      }
      if (!source.renameTo(temporary)) {
        // Different mount or a locked handle: copy to a temporary file first.
        source.inputStream().use { input ->
          FileOutputStream(temporary).use { output -> input.copyTo(output); output.fd.sync() }
        }
      }
      if (target.exists()) {
        temporary.renameTo(source)
        promise.reject("rename_failed", "The destination file already exists")
        return
      }
      if (!temporary.renameTo(target)) {
        temporary.renameTo(source)
        temporary.delete()
        promise.reject("rename_failed", "Could not promote the completed model file")
        return
      }
      if (source.exists()) source.delete()
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("rename_failed", error.message, error)
    }
  }

  @ReactMethod
  fun readTextFile(path: String, promise: Promise) {
    try {
      val file = safePrivateFile(path)
      if (!file.path.startsWith(File(context.filesDir, "models").canonicalFile.path + File.separator)) {
        promise.reject("invalid_path", "Only model metadata may be accessed through this method")
        return
      }
      if (!file.isFile) {
        promise.reject("file_missing", "File not found")
        return
      }
      promise.resolve(file.readText())
    } catch (error: Throwable) {
      promise.reject("read_failed", error.message, error)
    }
  }

  @ReactMethod
  fun writeTextFile(path: String, contents: String, promise: Promise) {
    try {
      val file = safePrivateFile(path)
      if (!file.path.startsWith(File(context.filesDir, "models").canonicalFile.path + File.separator) ||
          !file.name.endsWith(".json") || contents.length > 1024) {
        promise.reject("invalid_path", "Only model verification metadata may be written through this method")
        return
      }
      file.parentFile?.mkdirs()
      file.writeText(contents)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("write_failed", error.message, error)
    }
  }

  @ReactMethod
  fun cancelDownload(promise: Promise) {
    synchronized(downloadStateLock) {
      if (downloadActive.get()) {
        cancelRequested = true
        activeConnection?.disconnect()
      }
    }
    promise.resolve(null)
  }

  @ReactMethod
  fun installBundledAsset(assetPath: String, destinationPath: String, promise: Promise) {
    try {
      val destination = safeModelFile(destinationPath)
      val expectedAsset = Regex("^models/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$")
      if (!expectedAsset.matches(assetPath) || (!assetPath.endsWith(".bin") && !assetPath.endsWith(".gguf"))) {
        promise.reject("invalid_asset", "Only verified model assets may be installed")
        return
      }
      if (!destination.path.startsWith(File(context.filesDir, "models").canonicalFile.path + File.separator)) {
        promise.reject("invalid_path", "Model assets must be installed into private model storage")
        return
      }
      if (destination.isFile && destination.length() > 0) {
        promise.resolve(true)
        return
      }
      if (destination.exists() && !destination.delete()) {
        promise.reject("asset_install_failed", "Could not remove the incomplete model")
        return
      }
      destination.parentFile?.mkdirs()
      val staging = File(destination.parentFile, "${destination.name}.installing")
      if (staging.exists() && !staging.delete()) {
        promise.reject("asset_install_failed", "Could not clear the previous staging file")
        return
      }
      context.assets.open(assetPath).use { input ->
        FileOutputStream(staging).use { output -> input.copyTo(output); output.fd.sync() }
      }
      if (!staging.renameTo(destination)) {
        staging.delete()
        promise.reject("asset_install_failed", "Could not promote the bundled model")
        return
      }
      promise.resolve(true)
    } catch (error: Throwable) {
      // A build that does not bundle the asset is a normal condition.
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun downloadFile(
      url: String,
      destinationPath: String,
      offset: Double,
      expectedSize: Double,
      onProgress: com.facebook.react.bridge.Callback,
      promise: Promise
  ) {
    if (!offset.isFinite() || offset < 0.0 || offset > 9_007_199_254_740_991.0 ||
        !expectedSize.isFinite() || expectedSize <= 0.0 || expectedSize > 9_007_199_254_740_991.0 ||
        offset % 1.0 != 0.0 || expectedSize % 1.0 != 0.0 || offset > expectedSize) {
      promise.reject("invalid_offset", "The requested model size or resume offset is invalid")
      return
    }
    val requestedOffset = offset.toLong()
    val expectedBytes = expectedSize.toLong()
    val destination = try { safeModelFile(destinationPath) } catch (error: Throwable) {
      promise.reject("invalid_path", error.message, error)
      return
    }
    synchronized(downloadStateLock) {
      if (!downloadActive.compareAndSet(false, true)) {
        promise.reject("download_busy", "Another model download is already running")
        return
      }
      cancelRequested = false
    }
    try {
      downloadExecutor.execute {
        try {
          performDownload(url, destination, requestedOffset, expectedBytes, onProgress, promise)
        } finally {
          synchronized(downloadStateLock) {
            activeConnection = null
            cancelRequested = false
            downloadActive.set(false)
          }
        }
      }
    } catch (error: RejectedExecutionException) {
      synchronized(downloadStateLock) {
        activeConnection = null
        cancelRequested = false
        downloadActive.set(false)
      }
      promise.reject("download_unavailable", "The model downloader is shutting down", error)
    }
  }

  private fun performDownload(
      url: String,
      destination: File,
      requestedOffset: Long,
      expectedBytes: Long,
      onProgress: com.facebook.react.bridge.Callback,
      promise: Promise
  ) {
    var connection: HttpURLConnection? = null
    try {
      if (isDownloadCancelled()) {
        promise.reject("cancelled", "Download cancelled")
        return
      }
      if (requestedOffset > 0 && (!destination.isFile || destination.length() != requestedOffset)) {
        promise.reject("invalid_offset", "The partial model file does not match the requested resume offset")
        return
      }
      val initialUrl = URL(url)
      if (!initialUrl.protocol.equals("https", ignoreCase = true) ||
          !initialUrl.host.equals("huggingface.co", ignoreCase = true) ||
          initialUrl.userInfo != null || initialUrl.port !in setOf(-1, 443)) {
        promise.reject("invalid_url", "Model downloads must start at the verified HTTPS host")
        return
      }
      connection = (initialUrl.openConnection() as HttpURLConnection).apply {
        connectTimeout = 20_000
        readTimeout = 30_000
        instanceFollowRedirects = false
        setRequestProperty("User-Agent", "Dayloom/1.0 (Android; offline model downloader)")
        if (requestedOffset > 0) setRequestProperty("Range", "bytes=$requestedOffset-")
      }
      var activeConnection = connection ?: throw IllegalStateException("Could not open model connection")
      setActiveConnection(activeConnection)
      var redirects = 0
      while (activeConnection.responseCode in 300..399) {
        if (isDownloadCancelled()) {
          promise.reject("cancelled", "Download cancelled")
          return
        }
        if (activeConnection.responseCode !in setOf(301, 302, 303, 307, 308) || redirects++ >= 5) {
          promise.reject("too_many_redirects", "The model server redirected too many times")
          return
        }
        val location = activeConnection.getHeaderField("Location")
        if (location.isNullOrBlank()) {
          promise.reject("invalid_redirect", "The model server returned a redirect without a destination")
          return
        }
        val redirectedUrl = URL(activeConnection.url, location)
        val redirectHost = redirectedUrl.host.lowercase()
        if (!redirectedUrl.protocol.equals("https", ignoreCase = true) ||
            redirectedUrl.userInfo != null || redirectedUrl.port !in setOf(-1, 443) ||
            (redirectHost != "huggingface.co" && !redirectHost.endsWith(".huggingface.co"))) {
          promise.reject("invalid_redirect", "The model server redirected to an unverified host")
          return
        }
        activeConnection.disconnect()
        activeConnection = (redirectedUrl.openConnection() as HttpURLConnection).apply {
          connectTimeout = 20_000
          readTimeout = 30_000
          instanceFollowRedirects = false
          setRequestProperty("User-Agent", "Dayloom/1.0 (Android; offline model downloader)")
          if (requestedOffset > 0) setRequestProperty("Range", "bytes=$requestedOffset-")
        }
        connection = activeConnection
        setActiveConnection(activeConnection)
      }
      connection = activeConnection
      val status = activeConnection.responseCode
      if (status !in setOf(HttpURLConnection.HTTP_OK, HttpURLConnection.HTTP_PARTIAL)) {
        promise.reject("http_$status", "The model server returned HTTP $status")
        return
      }
      val acceptRanges = activeConnection.getHeaderField("Accept-Ranges")?.split(',')
          ?.any { it.trim().equals("bytes", ignoreCase = true) } == true
      if (requestedOffset > 0 && status == HttpURLConnection.HTTP_PARTIAL && !acceptRanges) {
        promise.reject("invalid_range", "The server did not confirm byte-range support")
        return
      }
      val append = requestedOffset > 0 && status == HttpURLConnection.HTTP_PARTIAL
      if (status == HttpURLConnection.HTTP_PARTIAL && requestedOffset == 0L) {
        promise.reject("invalid_range", "The model server returned a partial response without a requested range")
        return
      }
      val fileOffset = if (append) requestedOffset else 0L
      val contentRange = activeConnection.getHeaderField("Content-Range")
      if (status == HttpURLConnection.HTTP_PARTIAL) {
        val range = Regex("^bytes (\\d+)-(\\d+)/(\\d+|\\*)$").find(contentRange.orEmpty())
        val rangeStart = range?.groupValues?.get(1)?.toLongOrNull()
        val rangeEnd = range?.groupValues?.get(2)?.toLongOrNull()
        val rangeTotal = range?.groupValues?.get(3)
        val totalMatches = rangeTotal?.toLongOrNull() == expectedBytes
        if (!append || rangeStart != requestedOffset || rangeEnd == null ||
            rangeEnd < requestedOffset || rangeEnd >= expectedBytes || !totalMatches) {
          promise.reject("invalid_range", "The model server returned an invalid byte range")
          return
        }
        val advertisedLength = activeConnection.contentLengthLong
        if (rangeEnd - rangeStart + 1 != expectedBytes - requestedOffset) {
          promise.reject("invalid_range", "The server returned an incomplete model range")
          return
        }
        if (advertisedLength >= 0 && advertisedLength != rangeEnd - rangeStart + 1) {
          promise.reject("invalid_range", "The model server range length did not match its Content-Range")
          return
        }
      }
      val responseLength = activeConnection.contentLengthLong
      if (status == HttpURLConnection.HTTP_OK && responseLength != expectedBytes) {
        promise.reject("size_mismatch", "The model server returned a response with an unexpected size")
        return
      }
      if (responseLength >= 0 && responseLength + fileOffset != expectedBytes) {
        promise.reject("size_mismatch", "The model server returned a response with an unexpected size")
        return
      }
      if (isDownloadCancelled()) {
        promise.reject("cancelled", "Download cancelled")
        return
      }
      if (!append && destination.exists() && !destination.delete()) {
        promise.reject("file_reset_failed", "Could not restart the partial model file")
        return
      }
      var written = fileOffset
      FileOutputStream(destination, append).use { output ->
        activeConnection.inputStream.use { input ->
          val buffer = ByteArray(256 * 1024)
          var lastReport = 0L
          while (true) {
            if (isDownloadCancelled()) throw IllegalStateException("Download cancelled")
            val read = input.read(buffer)
            if (read <= 0) break
            output.write(buffer, 0, read)
            written += read
            if (written > expectedBytes) {
              throw IllegalStateException("Downloaded model is larger than expected")
            }
            val now = System.currentTimeMillis()
            if (now - lastReport > 250) {
              lastReport = now
              try {
                onProgress.invoke(JSONObject().put("receivedBytes", written.toDouble()).toString())
              } catch (_: Throwable) {
                // A stale UI callback must not corrupt an otherwise valid download.
              }
            }
          }
          output.flush()
        }
      }
      if (written != expectedBytes) {
        promise.reject("size_mismatch", "The model response ended before its expected size")
        return
      }
      promise.resolve(
          JSONObject()
              .put("bytesWritten", written.toDouble())
              .put("resumedFrom", fileOffset.toDouble())
              .put("acceptRanges", acceptRanges)
              .put("status", status)
              .toString())
    } catch (error: Throwable) {
      promise.reject(if (isDownloadCancelled()) "cancelled" else "download_failed", error.message, error)
    } finally {
      connection?.disconnect()
      synchronized(downloadStateLock) {
        if (activeConnection === connection) activeConnection = null
      }
    }
  }

  private fun isDownloadCancelled(): Boolean = synchronized(downloadStateLock) { cancelRequested }

  private fun setActiveConnection(connection: HttpURLConnection) {
    synchronized(downloadStateLock) {
      activeConnection = connection
      if (cancelRequested) connection.disconnect()
    }
  }

  override fun invalidate() {
    synchronized(downloadStateLock) {
      cancelRequested = true
      activeConnection?.disconnect()
    }
    downloadExecutor.shutdownNow()
    super.invalidate()
  }
}
