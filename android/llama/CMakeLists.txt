cmake_minimum_required(VERSION 3.22.1)
project(dayloom_llama C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Pinned checkout: native/llama.cpp at tag v0.7.0 (see .gitmodules).
set(LLAMA_SRC ${CMAKE_CURRENT_LIST_DIR}/../../native/llama.cpp)

if(NOT EXISTS ${LLAMA_SRC}/include/llama.h)
    message(FATAL_ERROR
        "llama.cpp sources are missing. Run: git submodule update --init --recursive")
endif()

set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_APP OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
# llama and whisper vendor independent ggml copies. Link dependencies statically
# into their JNI libraries so duplicate ggml .so names do not collide in the APK.
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_VULKAN OFF CACHE BOOL "" FORCE)
set(GGML_CUDA OFF CACHE BOOL "" FORCE)
set(GGML_METAL OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)

add_subdirectory(${LLAMA_SRC} ${CMAKE_BINARY_DIR}/llama.cpp)

add_library(dayloom_llama SHARED src/main/cpp/llama_jni.cpp)
target_include_directories(dayloom_llama PRIVATE
    ${LLAMA_SRC}/include
    ${LLAMA_SRC}/ggml/include)
target_link_libraries(dayloom_llama PRIVATE llama)
target_link_options(dayloom_llama PRIVATE "-Wl,-z,max-page-size=16384")
set_target_properties(dayloom_llama PROPERTIES CXX_VISIBILITY_PRESET default)
