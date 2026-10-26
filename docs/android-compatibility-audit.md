# Android compatibility audit — Dayloom

Date of source review: 2026-10-24. Scope: every project-owned source/configuration/artifact outside the two pinned upstream submodules; the submodule references and project-built integration points are included. This is a source audit and test record, **not a completed built-artifact or device compatibility certification**.

## Executive result

- **Source and JS checks:** passed as recorded below.
- **Android release APK, install, native runtime, device behavior, and 16 KB artifact compatibility:** **not verified**. This workspace has no Java/JDK, Android SDK/NDK, `adb`, or emulator. Running `./gradlew :app:assembleRelease` fails immediately: `JAVA_HOME is not set and no 'java' command could be found in your PATH`.
- **Distribution status:** not a shippable verified APK. Do not claim release-ready or complete compatibility until the blocked checks are performed on a built artifact.

## Project file inventory reviewed

The app-owned inventory contains 174 tracked-or-untracked project files at audit time. Source inventory includes root app/config/lock/license files; TypeScript and TSX under `src/`; Gradle wrapper/configuration; Android manifest, Kotlin modules, JNI C++, resource XML/drawables/layouts; scripts; and docs. A scoped marker scan over app-owned `src/` and Android app/native module sources found no production TODO/FIXME/“coming soon” or explicit not-implemented marker; ICS import intentionally reports unsupported VTODO/VALARM components. Third-party vendored source under `native/llama.cpp` and `native/whisper.cpp` is pinned separately and is not represented as authored application logic.

Reviewed specific build/security files: `.gitignore`, `.gitmodules`, `package.json`, `package-lock.json`, TypeScript/Babel/Metro/RN configs, model fetch script and manifest, SQLite schema and migrations, model manager/downloader, agent/action schemas and executor, native module declarations/wiring, `android/build.gradle`, `android/settings.gradle`, `android/gradle.properties`, Gradle wrapper properties, app/library Gradle files, both CMake files, both JNI bridges, all app Kotlin modules, Android manifest, backup rules, launcher widget layouts/providers/resources, and the app-owned UI/screens/widget renderers.

Submodule pins resolved locally:

- whisper.cpp v1.9.5, commit `d1be6fde11ac6e0407606b4e42fe72d34add8037`.
- llama.cpp v0.7.0, commit `620d2225cc436ab0b001e3200e590e3b286ef9ab`.

## Implemented configuration reviewed

- `minSdkVersion=24`; `targetSdkVersion=36`; `compileSdkVersion=37`.
- React Native 0.88.0, Hermes, Java/Kotlin target 17, new architecture enabled.
- Release `abiFilters` only `arm64-v8a`; debug also configures `x86_64`.
- Network permission exists for optional in-app model downloads. Microphone and notification permissions are present in the manifest and requested in feature flows; no calendar/contact permission is declared. Exact alarms use inexact fallback if unavailable.
- JSON and ICS import/export use Android Storage Access Framework pickers; no broad storage permission.
- Data is SQLite in app-private storage with versioned transactions. Models and recordings are excluded from Android backup rules. Local backup validates the document and uses a table/column allowlist.
- The required Whisper Tiny weight exists at `android/app/src/main/assets/models/ggml-tiny.bin` (77,691,713 bytes); its computed SHA-256 equals `be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21`. This adds ~74 MiB to the release before packaging/compression. Optional LLM weights are not bundled.
- App-owned whisper/llama JNI target flags include `-Wl,-z,max-page-size=16384`; this does not prove every transitive `.so` segment/zip entry is compatible. Inspect the produced APK/AAB after build.
- Network is described as limited to the explicit model downloader. The Kotlin downloader now limits redirects to HTTPS subdomains of huggingface.co and validates partial content ranges; still verify actual production redirects and server behavior.
- Model source URLs for offered weights now use immutable Hugging Face commit revisions and pinned hashes. Gemma remains unavailable. See [model-assets.md](model-assets.md).

## Checks performed

| Check | Result |
|---|---|
| `npm ci` with committed lockfile | PASS; installed 676 packages, audit reported 0 vulnerabilities. |
| `npm run typecheck` | PASS before the final source-audit fixes; rerun after edits. |
| `npm test -- --runInBand` | PASS before final source-audit fixes; 12 suites, 149 tests. Rerun after edits; new tests cover bundled-model checksum and native downloader validation. |
| `node scripts/fetch-models.mjs --check` | PASS; 6 catalog entries, 5 marked downloadable and 1 bundled. |
| Bundled asset byte count + SHA-256 | PASS for checked-in local Whisper Tiny asset. Runtime bundled-asset copy now independently hashes it before marking installed. |
| `npm run bundle:android` | PASS; Metro generated `android/app/src/main/assets/index.android.bundle` and copied 19 asset files. |
| App-owned code marker scan | PASS; no TODO/FIXME/coming-soon/explicit unimplemented markers in app-owned source scan. |
| `./gradlew :app:assembleRelease` | BLOCKED before Gradle could start: Java is absent (`JAVA_HOME` unset and no `java`). |
| Kotlin/Gradle/CMake/JNI compilation | NOT RUN; blocked on missing JDK and Android SDK/NDK. Gradle plugin versions are now explicit (AGP 9.2.1/Kotlin 2.2.0) to align with the installed RN 0.88 version catalog; toolchain compatibility still requires the build. |
| APK/AAB inspect, 16 KB ELF/ZIP alignment | NOT RUN; no built artifact/toolchain. |
| Install, launch, permissions, SQLite migration on Android, widgets/reminders, backup picker, microphone capture and Whisper transcription | NOT RUN; no device/emulator. |
| LLM download/model loading and on-device token generation | NOT RUN; optional weights absent and no device. |
| Offline/airplane-mode end-to-end test | NOT RUN; no Android runtime/device. |

## Required before release approval

1. Use JDK 17 and install the exact Android SDK Platform 37, Build Tools 37.0.0, NDK `27.1.12297006`, and CMake 3.22.1 specified by the Gradle project. Resolve/pin the Android Gradle Plugin/Kotlin plugin versions explicitly if Gradle's plugin resolution does not provide a reproducible version.
2. Run `npm ci`, `npm run typecheck`, `npm test -- --runInBand`, `npm run models:bundled`, `node scripts/fetch-models.mjs --check`, `npm run bundle:android`, and `cd android && ./gradlew :app:assembleRelease` on the actual checked-out revision with both submodules initialized.
3. Fix all Gradle, Kotlin, JNI and CMake build errors; inspect release APK's native library list and all transitive `.so` ELF segment alignments. Verify APK ZIP alignment using current Android tooling (for example `zipalign -c -P 16 -v 4` where supported) and test on a 16 KB page-size emulator/device (`adb shell getconf PAGE_SIZE` returns `16384`).
4. Install and launch on minimum API 24 and current Android API devices; exercise cold start and upgrade migration, small/large layouts, backup/restore, ICS, reminder permission denial/grant/reboot/timezone change, voice permission denial/grant and push-to-talk transcription with airplane mode enabled.
5. Exercise every widget's data/empty states and all five launcher providers with actual database data; verify alarm scheduling and notification delivery on supported OS versions.
6. Exercise each supported assistant action and destructive confirmation/undo against a real device database. Test DST boundaries, all-day events, recurrence exceptions, and timezone change.
7. Test explicit model download on Wi-Fi and mobile data (Wi-Fi-only on/off), pause/cancel/resume, low-storage, invalid hashes, server range ignored, connection loss, redirects, integrity sidecar and delete. The Kotlin boundary now constrains filesystem paths to app-private storage, validates initial URL and redirect hosts/range responses, and the model manager verifies bundled asset bytes. Verify model inference stays offline after download.
8. Keep debug signing out of distribution. Build a release-signed APK/AAB only using private release credentials and review all shipped notices/licenses.
9. Update this audit with exact toolchain versions, artifact hashes, inspected native library alignments and devices/OS versions. Until then these checks remain unverified.

## 16 KB, Play policy, and sources

This is an October 2026 planning review. Android guidance says 16 KB support applies to 64-bit native apps on relevant newer Android devices; AGP 8.5.1+ is recommended for uncompressed library packaging, and NDK r28+ aligns ELF segments by default. This project currently specifies NDK r27.1 and therefore relies on explicit linker flags; the flags must still be verified on every built library. Google Play target API policy for ordinary apps requires API 36 for submissions from Aug 31, 2026 (extension availability is account-dependent).

Authoritative references:

- [Google Play target API requirements](https://developer.android.com/google/play/requirements/target-sdk)
- [Android 16 KB page-size guidance](https://developer.android.com/guide/practices/page-sizes)
- [Configure the NDK for AGP](https://developer.android.com/studio/projects/configure-agp-ndk)
