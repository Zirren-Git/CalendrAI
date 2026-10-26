# Dayloom

An offline-first Android calendar and productivity app. Calendar events, tasks, notes, habits, routines, focus sessions, and assistant processing remain on-device. Voice commands use bundled Whisper Tiny speech recognition and deterministic local intent/date parsing; the optional local GGUF model is never required. The app has no backend, account, cloud AI, analytics, or sync service.

## Status: implementation and verification limits

The React Native app, SQLite schema and migrations, native Android modules, local assistant, 48 in-app dashboard widget types, and five Android launcher widgets are implemented. The TypeScript bundle and unit suite have been verified in this workspace. **An Android APK/release build is not verified or delivered:** this workspace does not have Java, Android SDK/NDK, or an Android device/emulator. Native compilation, installation, and device behavior must be verified in an Android build environment. See [docs/android-compatibility-audit.md](docs/android-compatibility-audit.md) and [docs/model-assets.md](docs/model-assets.md) for the audit and exact asset status.

## Requirements

- Node.js `>=22.11.0` and npm
- JDK 17
- Android SDK Platform 37, Build Tools 37.0.0, NDK `27.1.12297006`, and CMake 3.22.1
- Android Gradle Plugin 9.2.1 and Kotlin Gradle plugin 2.2.0 (aligned with React Native 0.88's version catalog)
- For local testing: arm64 Android device; x86_64 emulator support is configured for debug builds

The project uses React Native 0.88.0, TypeScript, Hermes, SQLite through `@op-engineering/op-sqlite`, and pinned upstream git submodules: whisper.cpp v1.9.5 and llama.cpp v0.7.0.

## Install and test

```sh
npm ci
npm run typecheck
npm test -- --runInBand
npm run bundle:android
```

The bundled Whisper Tiny model is present in this checkout at `android/app/src/main/assets/models/ggml-tiny.bin` (about 74 MiB) and its SHA-256 was verified. This required asset is committed with the project so that an offline release build does not depend on a download. To restore it if absent, explicitly fetch and verify the asset before building; that operation needs network access.

```sh
npm run models:bundled
node scripts/fetch-models.mjs --check
```

Network in the installed app is intended only for user-initiated optional model downloads.

Initialize native source submodules before configuring or building C++:

```sh
git submodule update --init --recursive
```

Build a local arm64 release APK (using the debug signing key only for local verification):

```sh
cd android
./gradlew :app:assembleRelease
```

The APK should be at `android/app/build/outputs/apk/release/app-release.apk`. Release builds include only `arm64-v8a`; debug builds also enable `x86_64`. Do not distribute an APK signed with the debug key. Configure a private `android/keystore.properties` for your own release signing; it is ignored by Git and must never contain credentials committed to source control. See the [Android compatibility audit](docs/android-compatibility-audit.md) for required pre-release artifact/device checks.

## Product and data

The app opens without requesting permissions. Microphone permission is requested when push-to-talk is used. Notification permission is requested when the user enables reminders. Exact alarms fall back to inexact alarms when unavailable. ICS and JSON backup/import use Android's Storage Access Framework. App data is in private SQLite storage; Android backups exclude model weights and audio recordings. Import replacement requires confirmation.

The assistant's built-in parser handles supported commands without a model download. It validates every action and presents a review/confirmation flow; destructive actions require confirmation and can be undone. The optional language model is an enhancement and runs locally after a user-initiated download.

## Release notes

`minSdkVersion=24`, `targetSdkVersion=36`, and `compileSdkVersion=37`. The project links its app-owned JNI shared libraries with a 16 KB maximum page size. That flag alone is not proof of APK compatibility: inspect every linked `.so` and the APK alignment in a built artifact, then test on a 16 KB Android environment. AGP 9.2.1, Kotlin 2.2.0, and Gradle 9.4.1 are specified; verify that toolchain compiles successfully with the installed SDK/NDK before claiming release compatibility.
