cmake_minimum_required(VERSION 3.22.1)
project(dayloom_whisper C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Pinned checkout: native/whisper.cpp at tag v1.9.5 (see .gitmodules).
set(WHISPER_SRC ${CMAKE_CURRENT_LIST_DIR}/../../native/whisper.cpp)

if(NOT EXISTS ${WHISPER_SRC}/include/whisper.h)
    message(FATAL_ERROR
        "whisper.cpp sources are missing. Run: git submodule update --init --recursive")
endif()

# Only the inference library is needed on Android.
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
# llama and whisper vendor independent ggml copies. Link dependencies statically
# into their JNI libraries so duplicate ggml .so names do not collide in the APK.
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(WHISPER_OPENVINO OFF CACHE BOOL "" FORCE)
set(WHISPER_COREML OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_VULKAN OFF CACHE BOOL "" FORCE)
set(GGML_CUDA OFF CACHE BOOL "" FORCE)
set(GGML_METAL OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)

add_subdirectory(${WHISPER_SRC} ${CMAKE_BINARY_DIR}/whisper.cpp)

add_library(dayloom_whisper SHARED src/main/cpp/whisper_jni.cpp)
target_include_directories(dayloom_whisper PRIVATE
    ${WHISPER_SRC}/include
    ${WHISPER_SRC}/ggml/include
    ${WHISPER_SRC}/src)
target_link_libraries(dayloom_whisper PRIVATE whisper)
# 16 KB page-size compatibility, required for Android 15+ devices.
target_link_options(dayloom_whisper PRIVATE "-Wl,-z,max-page-size=16384")
set_target_properties(dayloom_whisper PROPERTIES CXX_VISIBILITY_PRESET default)
