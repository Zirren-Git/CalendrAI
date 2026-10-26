/**
 * Native module contracts.
 *
 * The Kotlin modules are registered through a ReactPackage (legacy bridge,
 * which the New Architecture supports through its interop layer). Keeping the
 * contract here means the JS side stays typed while the native side only has to
 * implement @ReactMethod signatures. Structured payloads cross as JSON strings.
 */
import {NativeModules} from 'react-native';

export interface WhisperNative {
  loadModel(modelPath: string, threads: number): Promise<string>;
  unloadModel(contextId: number): Promise<void>;
  transcribe(
    contextId: number,
    audioPath: string,
    language: string,
    threads: number,
  ): Promise<string>;
  transcribeStreaming(
    contextId: number,
    audioPath: string,
    language: string,
    threads: number,
    onSegment: (segmentJson: string) => void,
  ): Promise<string>;
  cancel(contextId: number): Promise<void>;
  getModelInfo(contextId: number): Promise<string>;
}

export interface LlamaNative {
  loadModel(configJson: string): Promise<string>;
  unloadModel(contextId: number): Promise<void>;
  generate(
    contextId: number,
    prompt: string,
    maxTokens: number,
    temperature: number,
  ): Promise<string>;
  generateStreaming(
    contextId: number,
    prompt: string,
    maxTokens: number,
    temperature: number,
    onToken: (token: string) => void,
  ): Promise<string>;
  cancel(contextId: number): Promise<void>;
  getModelInfo(contextId: number): Promise<string>;
}

export interface AudioCaptureNative {
  hasPermission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  startCapture(): Promise<string>;
  stopCapture(): Promise<string>;
  cancelCapture(): Promise<void>;
  amplitude(): Promise<number>;
  sampleRate(): Promise<number>;
}

export interface ModelStoreNative {
  modelsDir(): Promise<string>;
  freeSpaceBytes(): Promise<number>;
  sha256File(path: string): Promise<string>;
  downloadFile(
    url: string,
    destinationPath: string,
    offset: number,
    expectedSize: number,
    onProgress: (progressJson: string) => void,
  ): Promise<string>;
  cancelDownload(): Promise<void>;
  installBundledAsset(assetPath: string, destinationPath: string): Promise<boolean>;
  isWifiConnected(): Promise<boolean>;
  deviceRamMb(): Promise<number>;
  deviceAbi(): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  fileSize(path: string): Promise<number>;
  deleteFile(path: string): Promise<void>;
  renameFile(from: string, to: string): Promise<void>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, contents: string): Promise<void>;
}

export interface RemindersNative {
  requestPermission(): Promise<boolean>;
  hasPermission(): Promise<boolean>;
  canScheduleExactAlarms(): Promise<boolean>;
  schedule(id: string, triggerAt: number, title: string, body: string): Promise<boolean>;
  cancel(id: string): Promise<void>;
  syncFromDatabase(): Promise<number>;
  pendingCount(): Promise<number>;
  cancelAll(): Promise<void>;
}

export interface WidgetsNative {
  refresh(): Promise<void>;
  supported(): Promise<boolean>;
  /** Returns and clears the route a launcher-widget tap requested. */
  consumeLaunchTarget(): Promise<string | null>;
}

export interface DocumentsNative {
  pickImportFile(mimeType: string): Promise<string | null>;
  pickExportTarget(fileName: string, mimeType: string): Promise<string | null>;
  writeTextFile(uri: string, contents: string): Promise<boolean>;
  readTextFile(uri: string): Promise<string>;
}

interface NativeModuleMap {
  Whisper?: WhisperNative;
  Llama?: LlamaNative;
  AudioCapture?: AudioCaptureNative;
  ModelStore?: ModelStoreNative;
  Reminders?: RemindersNative;
  Widgets?: WidgetsNative;
  Documents?: DocumentsNative;
}

const modules = NativeModules as unknown as NativeModuleMap;

export const nativeWhisper: WhisperNative | null = modules.Whisper ?? null;
export const nativeLlama: LlamaNative | null = modules.Llama ?? null;
export const nativeAudioCapture: AudioCaptureNative | null = modules.AudioCapture ?? null;
export const nativeModelStore: ModelStoreNative | null = modules.ModelStore ?? null;
export const nativeReminders: RemindersNative | null = modules.Reminders ?? null;
export const nativeWidgets: WidgetsNative | null = modules.Widgets ?? null;
export const nativeDocuments: DocumentsNative | null = modules.Documents ?? null;
