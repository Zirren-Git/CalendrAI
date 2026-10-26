// whisper.cpp JNI bridge for Dayloom, targeting the pinned upstream v1.9.5.

#include <jni.h>

#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>

#include "whisper.h"

namespace {

struct WhisperHandle {
    whisper_context * ctx = nullptr;
    std::atomic<bool> cancel{false};
    std::mutex mutex;
};

struct Emitter {
    JNIEnv * env = nullptr;
    jobject object = nullptr;
    jmethodID method = nullptr;
};

void throw_exception(JNIEnv * env, const char * klass, const std::string & message) {
    jclass clazz = env->FindClass(klass);
    if (clazz != nullptr) {
        env->ThrowNew(clazz, message.c_str());
        env->DeleteLocalRef(clazz);
    }
}

std::string jstring_to_string(JNIEnv * env, jstring value) {
    if (value == nullptr) return {};
    const char * chars = env->GetStringUTFChars(value, nullptr);
    std::string result = chars != nullptr ? std::string(chars) : std::string();
    if (chars != nullptr) env->ReleaseStringUTFChars(value, chars);
    return result;
}

bool read_wav(const char * path, std::vector<float> & out, std::string & error) {
    FILE * file = fopen(path, "rb");
    if (file == nullptr) {
        error = "Could not open the recording";
        return false;
    }
    char header[12];
    if (fread(header, 1, sizeof(header), file) != sizeof(header) ||
        memcmp(header, "RIFF", 4) != 0 || memcmp(header + 8, "WAVE", 4) != 0) {
        fclose(file);
        error = "Recording is not a WAV file";
        return false;
    }
    if (fseek(file, 0, SEEK_END) != 0) {
        fclose(file);
        error = "Could not inspect the recording size";
        return false;
    }
    const long file_size = ftell(file);
    if (file_size < 12 || file_size > 2'000'000 || fseek(file, 12, SEEK_SET) != 0) {
        fclose(file);
        error = "Recording has an invalid or oversized WAV file";
        return false;
    }

    uint16_t channels = 0;
    uint16_t bits = 0;
    uint32_t rate = 0;
    bool have_format = false;
    for (;;) {
        char chunk_id[4];
        uint32_t chunk_size = 0;
        if (fread(chunk_id, 1, 4, file) != 4 || fread(&chunk_size, 4, 1, file) != 1) break;
        const long chunk_start = ftell(file);
        const long padded_size = static_cast<long>(chunk_size) + (chunk_size % 2);
        if (chunk_start < 0 || padded_size > file_size - chunk_start) {
            fclose(file);
            error = "WAV chunk exceeds the recording bounds";
            return false;
        }
        if (memcmp(chunk_id, "fmt ", 4) == 0) {
            if (chunk_size < 16) {
                fclose(file);
                error = "WAV format chunk is incomplete";
                return false;
            }
            unsigned char fmt[16];
            if (fread(fmt, 1, sizeof(fmt), file) != sizeof(fmt)) {
                fclose(file);
                error = "WAV format chunk is incomplete";
                return false;
            }
            const uint16_t format = static_cast<uint16_t>(fmt[0] | (fmt[1] << 8));
            channels = static_cast<uint16_t>(fmt[2] | (fmt[3] << 8));
            rate = static_cast<uint32_t>(fmt[4] | (fmt[5] << 8) | (fmt[6] << 16) | (fmt[7] << 24));
            bits = static_cast<uint16_t>(fmt[14] | (fmt[15] << 8));
            if (format != 1) {
                fclose(file);
                error = "Recording must be uncompressed PCM";
                return false;
            }
            have_format = true;
            if (fseek(file, chunk_start + padded_size, SEEK_SET) != 0) {
                fclose(file);
                error = "Could not read the WAV format chunk";
                return false;
            }
        } else if (memcmp(chunk_id, "data", 4) == 0) {
            if (!have_format) {
                fclose(file);
                error = "WAV data appeared before its format chunk";
                return false;
            }
            if (channels != 1 || bits != 16 || rate != 16000 || chunk_size % 2 != 0) {
                fclose(file);
                error = "Recording must be 16 kHz mono 16-bit PCM";
                return false;
            }
            std::vector<unsigned char> raw(chunk_size);
            const size_t read = fread(raw.data(), 1, chunk_size, file);
            fclose(file);
            if (read != chunk_size) {
                error = "WAV audio data is incomplete";
                return false;
            }
            out.resize(read / 2);
            for (size_t i = 0; i < out.size(); ++i) {
                const int16_t sample = static_cast<int16_t>(raw[i * 2] | (raw[i * 2 + 1] << 8));
                out[i] = static_cast<float>(sample) / 32768.0f;
            }
            return true;
        } else if (fseek(file, chunk_start + padded_size, SEEK_SET) != 0) {
            fclose(file);
            error = "Could not read a WAV chunk";
            return false;
        }
    }
    fclose(file);
    error = "Recording has no audio data";
    return false;
}

void on_new_segment(whisper_context * ctx, whisper_state *, int n_new, void * user_data) {
    auto * emitter = static_cast<Emitter *>(user_data);
    if (emitter == nullptr || emitter->env == nullptr) return;
    const int total = whisper_full_n_segments(ctx);
    for (int i = total - n_new; i < total; ++i) {
        if (i < 0) continue;
        const char * text = whisper_full_get_segment_text(ctx, i);
        const jlong start_ms = whisper_full_get_segment_t0(ctx, i) * 10;
        const jlong end_ms = whisper_full_get_segment_t1(ctx, i) * 10;
        jstring segment = emitter->env->NewStringUTF(text != nullptr ? text : "");
        if (segment != nullptr) {
            emitter->env->CallVoidMethod(emitter->object, emitter->method, segment, start_ms, end_ms);
            emitter->env->DeleteLocalRef(segment);
        }
    }
}

bool should_abort(void * user_data) {
    auto * handle = static_cast<WhisperHandle *>(user_data);
    return handle == nullptr || handle->cancel.load(std::memory_order_relaxed);
}

} // namespace

extern "C" {

JNIEXPORT jlong JNICALL
Java_com_dayloom_native_WhisperModule_nativeLoadModel(JNIEnv * env, jobject, jstring path, jint threads) {
    const std::string model_path = jstring_to_string(env, path);
    if (model_path.empty()) {
        throw_exception(env, "java/lang/IllegalArgumentException", "Model path is empty");
        return 0;
    }
    whisper_context_params params = whisper_context_default_params();
    params.use_gpu = false;
    whisper_context * ctx = whisper_init_from_file_with_params(model_path.c_str(), params);
    if (ctx == nullptr) return 0;
    auto * handle = new WhisperHandle();
    handle->ctx = ctx;
    (void) threads;
    return reinterpret_cast<jlong>(handle);
}

JNIEXPORT void JNICALL
Java_com_dayloom_native_WhisperModule_nativeFreeModel(JNIEnv *, jobject, jlong handle_ptr) {
    auto * handle = reinterpret_cast<WhisperHandle *>(handle_ptr);
    if (handle == nullptr) return;
    {
        std::lock_guard<std::mutex> guard(handle->mutex);
        if (handle->ctx != nullptr) {
            whisper_free(handle->ctx);
            handle->ctx = nullptr;
        }
    }
    delete handle;
}

JNIEXPORT void JNICALL
Java_com_dayloom_native_WhisperModule_nativeCancel(JNIEnv *, jobject, jlong handle_ptr) {
    auto * handle = reinterpret_cast<WhisperHandle *>(handle_ptr);
    if (handle != nullptr) handle->cancel.store(true, std::memory_order_relaxed);
}

JNIEXPORT void JNICALL
Java_com_dayloom_native_WhisperModule_nativeResetCancel(JNIEnv *, jobject, jlong handle_ptr) {
    auto * handle = reinterpret_cast<WhisperHandle *>(handle_ptr);
    if (handle != nullptr) {
        std::lock_guard<std::mutex> guard(handle->mutex);
        handle->cancel.store(false, std::memory_order_relaxed);
    }
}

JNIEXPORT jstring JNICALL
Java_com_dayloom_native_WhisperModule_nativeTranscribe(JNIEnv * env, jobject, jlong handle_ptr,
                                                       jstring audio_path, jstring language,
                                                       jint threads, jobject emitter) {
    auto * handle = reinterpret_cast<WhisperHandle *>(handle_ptr);
    if (handle == nullptr) {
        throw_exception(env, "java/lang/IllegalStateException", "Model is not loaded");
        return nullptr;
    }
    std::lock_guard<std::mutex> guard(handle->mutex);
    if (handle->ctx == nullptr || handle->cancel.load(std::memory_order_relaxed)) {
        throw_exception(env, "java/lang/IllegalStateException", "Model is not loaded or transcription was cancelled");
        return nullptr;
    }
    std::vector<float> pcm;
    std::string error;
    if (!read_wav(jstring_to_string(env, audio_path).c_str(), pcm, error)) {
        throw_exception(env, "java/lang/IllegalArgumentException", error);
        return nullptr;
    }
    if (pcm.size() < 800) {
        throw_exception(env, "java/lang/IllegalArgumentException", "Recording is too short");
        return nullptr;
    }

    Emitter bridge{env, emitter, nullptr};
    if (emitter != nullptr) {
        jclass cls = env->GetObjectClass(emitter);
        bridge.method = env->GetMethodID(cls, "emit", "(Ljava/lang/String;JJ)V");
        env->DeleteLocalRef(cls);
        if (bridge.method == nullptr) return nullptr;
    }

    whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.print_progress = false;
    params.print_realtime = false;
    params.print_timestamps = false;
    params.print_special = false;
    params.translate = false;
    params.no_timestamps = false;
    params.suppress_blank = true;
    params.n_threads = threads > 0 ? threads : 2;
    params.abort_callback = should_abort;
    params.abort_callback_user_data = handle;
    params.new_segment_callback = on_new_segment;
    params.new_segment_callback_user_data = &bridge;

    const std::string lang = jstring_to_string(env, language);
    if (lang.empty() || lang == "auto") {
        params.language = nullptr;
        params.detect_language = true;
    } else {
        params.language = lang.c_str();
        params.detect_language = false;
    }
    const int status = whisper_full(handle->ctx, params, pcm.data(), static_cast<int>(pcm.size()));
    if (status != 0) {
        throw_exception(env, "java/lang/IllegalStateException",
            handle->cancel.load(std::memory_order_relaxed) ? "Transcription cancelled" : "whisper.cpp failed to transcribe");
        return nullptr;
    }
    std::string text;
    const int segments = whisper_full_n_segments(handle->ctx);
    for (int i = 0; i < segments; ++i) {
        const char * segment = whisper_full_get_segment_text(handle->ctx, i);
        if (segment != nullptr) text += segment;
    }
    return env->NewStringUTF(text.c_str());
}

} // extern "C"
