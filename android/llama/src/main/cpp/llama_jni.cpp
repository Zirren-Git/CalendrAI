// llama.cpp JNI bridge for Dayloom's optional local model, pinned v0.7.0.

#include <jni.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include <vector>

#include "llama.h"

namespace {

struct LlamaHandle {
    llama_model * model = nullptr;
    std::atomic<bool> cancel{false};
    std::mutex mutex;
    int n_ctx = 2048;
    int threads = 2;
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

void emit_piece(JNIEnv * env, jobject emitter, jmethodID method, const std::string & piece) {
    if (emitter == nullptr || method == nullptr) return;
    jstring text = env->NewStringUTF(piece.c_str());
    if (text != nullptr) {
        env->CallVoidMethod(emitter, method, text);
        env->DeleteLocalRef(text);
    }
}

} // namespace

extern "C" {

JNIEXPORT jlong JNICALL
Java_com_dayloom_native_LlamaModule_nativeLoadModel(JNIEnv * env, jobject, jstring path, jint context_size,
                                                    jint threads) {
    const std::string model_path = jstring_to_string(env, path);
    if (model_path.empty()) {
        throw_exception(env, "java/lang/IllegalArgumentException", "Model path is empty");
        return 0;
    }
    static std::once_flag backend_once;
    std::call_once(backend_once, []() { llama_backend_init(); });
    llama_model_params params = llama_model_default_params();
    params.n_gpu_layers = 0;
    llama_model * model = llama_model_load_from_file(model_path.c_str(), params);
    if (model == nullptr) return 0;
    auto * handle = new LlamaHandle();
    handle->model = model;
    handle->n_ctx = context_size > 0 ? context_size : 2048;
    handle->threads = threads > 0 ? threads : 2;
    return reinterpret_cast<jlong>(handle);
}

JNIEXPORT void JNICALL
Java_com_dayloom_native_LlamaModule_nativeFreeModel(JNIEnv *, jobject, jlong handle_ptr) {
    auto * handle = reinterpret_cast<LlamaHandle *>(handle_ptr);
    if (handle == nullptr) return;
    {
        std::lock_guard<std::mutex> guard(handle->mutex);
        if (handle->model != nullptr) {
            llama_model_free(handle->model);
            handle->model = nullptr;
        }
    }
    delete handle;
}

JNIEXPORT void JNICALL
Java_com_dayloom_native_LlamaModule_nativeCancel(JNIEnv *, jobject, jlong handle_ptr) {
    auto * handle = reinterpret_cast<LlamaHandle *>(handle_ptr);
    if (handle != nullptr) handle->cancel.store(true, std::memory_order_relaxed);
}

JNIEXPORT void JNICALL
Java_com_dayloom_native_LlamaModule_nativeResetCancel(JNIEnv *, jobject, jlong handle_ptr) {
    auto * handle = reinterpret_cast<LlamaHandle *>(handle_ptr);
    if (handle != nullptr) handle->cancel.store(false, std::memory_order_relaxed);
}

JNIEXPORT jstring JNICALL
Java_com_dayloom_native_LlamaModule_nativeGenerate(JNIEnv * env, jobject, jlong handle_ptr,
                                                   jstring prompt, jint max_tokens, jfloat temperature,
                                                   jobject emitter) {
    auto * handle = reinterpret_cast<LlamaHandle *>(handle_ptr);
    if (handle == nullptr) {
        throw_exception(env, "java/lang/IllegalStateException", "Model is not loaded");
        return nullptr;
    }
    std::lock_guard<std::mutex> guard(handle->mutex);
    if (handle->model == nullptr || handle->cancel.load(std::memory_order_relaxed)) {
        throw_exception(env, "java/lang/IllegalStateException", "Model is not loaded or generation was cancelled");
        return nullptr;
    }
    const std::string prompt_text = jstring_to_string(env, prompt);
    if (prompt_text.empty()) {
        throw_exception(env, "java/lang/IllegalArgumentException", "Prompt is empty");
        return nullptr;
    }

    llama_context_params ctx_params = llama_context_default_params();
    ctx_params.n_ctx = static_cast<uint32_t>(handle->n_ctx);
    ctx_params.n_batch = static_cast<uint32_t>(std::min(handle->n_ctx, 512));
    ctx_params.n_threads = handle->threads;
    ctx_params.n_threads_batch = handle->threads;
    ctx_params.no_perf = true;
    llama_context * ctx = llama_init_from_model(handle->model, ctx_params);
    if (ctx == nullptr) {
        throw_exception(env, "java/lang/IllegalStateException", "Could not create a llama.cpp context (out of memory?)");
        return nullptr;
    }

    jmethodID emit_method = nullptr;
    if (emitter != nullptr) {
        jclass cls = env->GetObjectClass(emitter);
        emit_method = env->GetMethodID(cls, "emit", "(Ljava/lang/String;)V");
        env->DeleteLocalRef(cls);
        if (emit_method == nullptr) {
            llama_free(ctx);
            return nullptr;
        }
    }

    const llama_vocab * vocab = llama_model_get_vocab(handle->model);
    const int32_t needed = -llama_tokenize(vocab, prompt_text.c_str(),
        static_cast<int32_t>(prompt_text.size()), nullptr, 0, true, true);
    if (needed <= 0) {
        llama_free(ctx);
        throw_exception(env, "java/lang/IllegalStateException", "Could not tokenize the prompt");
        return nullptr;
    }
    std::vector<llama_token> tokens(static_cast<size_t>(needed));
    const int32_t token_count = llama_tokenize(vocab, prompt_text.c_str(),
        static_cast<int32_t>(prompt_text.size()), tokens.data(), needed, true, true);
    if (token_count <= 0) {
        llama_free(ctx);
        throw_exception(env, "java/lang/IllegalStateException", "Could not tokenize the prompt");
        return nullptr;
    }
    tokens.resize(static_cast<size_t>(token_count));

    const int available = handle->n_ctx - static_cast<int>(tokens.size()) - 8;
    if (available <= 0) {
        llama_free(ctx);
        throw_exception(env, "java/lang/IllegalStateException", "Prompt does not fit in the model context window");
        return nullptr;
    }
    const int budget = std::min(max_tokens, available);
    const size_t batch_capacity = static_cast<size_t>(std::min(handle->n_ctx, 512));
    for (size_t offset = 0; offset < tokens.size(); offset += batch_capacity) {
        if (handle->cancel.load(std::memory_order_relaxed)) {
            llama_free(ctx);
            throw_exception(env, "java/lang/IllegalStateException", "Generation cancelled");
            return nullptr;
        }
        const size_t count = std::min(batch_capacity, tokens.size() - offset);
        llama_batch batch = llama_batch_get_one(tokens.data() + offset, static_cast<int32_t>(count));
        if (llama_decode(ctx, batch) != 0) {
            llama_free(ctx);
            throw_exception(env, "java/lang/IllegalStateException", "llama.cpp could not evaluate the prompt");
            return nullptr;
        }
    }

    llama_sampler_chain_params sampler_params = llama_sampler_chain_default_params();
    sampler_params.no_perf = true;
    llama_sampler * sampler = llama_sampler_chain_init(sampler_params);
    if (sampler == nullptr) {
        llama_free(ctx);
        throw_exception(env, "java/lang/IllegalStateException", "Could not create the llama.cpp sampler");
        return nullptr;
    }
    llama_sampler_chain_add(sampler, llama_sampler_init_temp(temperature > 0.01f ? temperature : 0.01f));
    llama_sampler_chain_add(sampler, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));

    std::string output;
    bool cancelled = false;
    for (int produced = 0; produced < budget; ++produced) {
        if (handle->cancel.load(std::memory_order_relaxed)) {
            cancelled = true;
            break;
        }
        const llama_token token = llama_sampler_sample(sampler, ctx, -1);
        if (llama_vocab_is_eog(vocab, token)) break;
        char piece[256];
        const int32_t piece_length = llama_token_to_piece(vocab, token, piece, sizeof(piece), 0, false);
        if (piece_length < 0) {
            std::vector<char> large_piece(static_cast<size_t>(-piece_length));
            const int32_t retry_length = llama_token_to_piece(vocab, token, large_piece.data(),
                static_cast<int32_t>(large_piece.size()), 0, false);
            if (retry_length < 0) {
                llama_sampler_free(sampler);
                llama_free(ctx);
                throw_exception(env, "java/lang/IllegalStateException", "Could not decode a llama.cpp token");
                return nullptr;
            }
            const std::string text(large_piece.data(), static_cast<size_t>(retry_length));
            output += text;
            emit_piece(env, emitter, emit_method, text);
        } else if (piece_length > 0) {
            const std::string text(piece, static_cast<size_t>(piece_length));
            output += text;
            emit_piece(env, emitter, emit_method, text);
        }
        llama_sampler_accept(sampler, token);
        llama_token next = token;
        llama_batch next_batch = llama_batch_get_one(&next, 1);
        if (llama_decode(ctx, next_batch) != 0) {
            llama_sampler_free(sampler);
            llama_free(ctx);
            throw_exception(env, "java/lang/IllegalStateException", "llama.cpp could not decode generated tokens");
            return nullptr;
        }
    }
    llama_sampler_free(sampler);
    llama_free(ctx);
    if (cancelled || handle->cancel.load(std::memory_order_relaxed)) {
        throw_exception(env, "java/lang/IllegalStateException", "Generation cancelled");
        return nullptr;
    }
    return env->NewStringUTF(output.c_str());
}

} // extern "C"
