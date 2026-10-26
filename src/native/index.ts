/**
 * Typed facades over the native modules.
 *
 * Every native module can be absent (emulator, a build without the native
 * bridge, a device that cannot allocate the model). Nothing here throws at
 * import time: callers get an explicit unavailable result instead of a crash.
 */
import {
  nativeAudioCapture,
  nativeDocuments,
  nativeLlama,
  nativeModelStore,
  nativeReminders,
  nativeWhisper,
  nativeWidgets,
  type AudioCaptureNative,
  type DocumentsNative,
  type ModelStoreNative,
  type RemindersNative,
} from './modules';

export interface WhisperModelInfo {
  contextId: number;
  modelPath: string;
  threads: number;
  sampleRate: number;
}

export interface TranscriptionSegment {
  text: string;
  startMs: number;
  endMs: number;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptionSegment[];
  language: string;
  durationMs: number;
  audioMs: number;
}

export interface LlamaConfig {
  modelPath: string;
  contextSize: number;
  batchSize: number;
  threads: number;
}

export interface LlamaModelInfo {
  contextId: number;
  modelPath: string;
  contextSize: number;
  threads: number;
}

export interface GenerationResult {
  text: string;
  tokens: number;
  durationMs: number;
  tokensPerSecond: number;
}

export class NativeUnavailableError extends Error {
  constructor(module: string) {
    super(`${module} is not available in this build`);
    this.name = 'NativeUnavailableError';
  }
}

function requireModule<T>(module: T | null, name: string): T {
  if (!module) {
    throw new NativeUnavailableError(name);
  }
  return module;
}

function parseJson<T>(raw: string, context: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${context} returned an unreadable response`);
  }
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toSegments(input: unknown): TranscriptionSegment[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map(item => ({
      text: typeof item.text === 'string' ? item.text : '',
      startMs: toNumber(item.startMs),
      endMs: toNumber(item.endMs),
    }));
}

/* ---------------------------------- whisper ---------------------------------- */

export const whisper = {
  available(): boolean {
    return nativeWhisper !== null;
  },
  async loadModel(modelPath: string, threads: number): Promise<WhisperModelInfo> {
    const module = requireModule(nativeWhisper, 'Whisper');
    return parseJson<WhisperModelInfo>(await module.loadModel(modelPath, threads), 'Whisper');
  },
  async unload(contextId: number): Promise<void> {
    await requireModule(nativeWhisper, 'Whisper').unloadModel(contextId);
  },
  async transcribe(
    contextId: number,
    audioPath: string,
    language = 'auto',
    threads = 2,
  ): Promise<TranscriptionResult> {
    const module = requireModule(nativeWhisper, 'Whisper');
    const parsed = parseJson<Record<string, unknown>>(
      await module.transcribe(contextId, audioPath, language, threads),
      'Whisper',
    );
    return {
      text: typeof parsed.text === 'string' ? parsed.text.trim() : '',
      segments: toSegments(parsed.segments),
      language: typeof parsed.language === 'string' ? parsed.language : language,
      durationMs: toNumber(parsed.durationMs),
      audioMs: toNumber(parsed.audioMs),
    };
  },
  async transcribeStreaming(
    contextId: number,
    audioPath: string,
    onSegment: (segment: TranscriptionSegment) => void,
    language = 'auto',
    threads = 2,
  ): Promise<TranscriptionResult> {
    const module = requireModule(nativeWhisper, 'Whisper');
    const parsed = parseJson<Record<string, unknown>>(
      await module.transcribeStreaming(contextId, audioPath, language, threads, json => {
        try {
          const frame = JSON.parse(json) as Record<string, unknown>;
          onSegment({
            text: typeof frame.text === 'string' ? frame.text : '',
            startMs: toNumber(frame.startMs),
            endMs: toNumber(frame.endMs),
          });
        } catch {
          // Ignore a malformed streaming frame; the final result is authoritative.
        }
      }),
      'Whisper',
    );
    return {
      text: typeof parsed.text === 'string' ? parsed.text.trim() : '',
      segments: toSegments(parsed.segments),
      language: typeof parsed.language === 'string' ? parsed.language : language,
      durationMs: toNumber(parsed.durationMs),
      audioMs: toNumber(parsed.audioMs),
    };
  },
  async cancel(contextId: number): Promise<void> {
    await requireModule(nativeWhisper, 'Whisper').cancel(contextId);
  },
  async info(contextId: number): Promise<WhisperModelInfo> {
    return parseJson<WhisperModelInfo>(
      await requireModule(nativeWhisper, 'Whisper').getModelInfo(contextId),
      'Whisper',
    );
  },
};

/* ----------------------------------- llama ----------------------------------- */

export const llama = {
  available(): boolean {
    return nativeLlama !== null;
  },
  async load(config: LlamaConfig): Promise<LlamaModelInfo> {
    const module = requireModule(nativeLlama, 'Llama');
    return parseJson<LlamaModelInfo>(await module.loadModel(JSON.stringify(config)), 'Llama');
  },
  async unload(contextId: number): Promise<void> {
    await requireModule(nativeLlama, 'Llama').unloadModel(contextId);
  },
  async generate(
    contextId: number,
    prompt: string,
    maxTokens = 256,
    temperature = 0,
  ): Promise<GenerationResult> {
    const parsed = parseJson<Record<string, unknown>>(
      await requireModule(nativeLlama, 'Llama').generate(contextId, prompt, maxTokens, temperature),
      'Llama',
    );
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      tokens: toNumber(parsed.tokens),
      durationMs: toNumber(parsed.durationMs),
      tokensPerSecond: toNumber(parsed.tokensPerSecond),
    };
  },
  async generateStreaming(
    contextId: number,
    prompt: string,
    onToken: (token: string) => void,
    maxTokens = 256,
    temperature = 0,
  ): Promise<GenerationResult> {
    const parsed = parseJson<Record<string, unknown>>(
      await requireModule(nativeLlama, 'Llama').generateStreaming(
        contextId,
        prompt,
        maxTokens,
        temperature,
        onToken,
      ),
      'Llama',
    );
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      tokens: toNumber(parsed.tokens),
      durationMs: toNumber(parsed.durationMs),
      tokensPerSecond: toNumber(parsed.tokensPerSecond),
    };
  },
  async cancel(contextId: number): Promise<void> {
    await requireModule(nativeLlama, 'Llama').cancel(contextId);
  },
  async info(contextId: number): Promise<LlamaModelInfo> {
    return parseJson<LlamaModelInfo>(
      await requireModule(nativeLlama, 'Llama').getModelInfo(contextId),
      'Llama',
    );
  },
};

/* ----------------------------------- audio ----------------------------------- */

export const audioCapture = {
  available(): boolean {
    return nativeAudioCapture !== null;
  },
  async hasPermission(): Promise<boolean> {
    return nativeAudioCapture ? nativeAudioCapture.hasPermission() : false;
  },
  async requestPermission(): Promise<boolean> {
    return nativeAudioCapture ? nativeAudioCapture.requestPermission() : false;
  },
  async start(): Promise<string> {
    return requireModule<AudioCaptureNative>(nativeAudioCapture, 'Audio').startCapture();
  },
  async stop(): Promise<{path: string; durationMs: number; bytes: number}> {
    const parsed = parseJson<Record<string, unknown>>(
      await requireModule<AudioCaptureNative>(nativeAudioCapture, 'Audio').stopCapture(),
      'Audio',
    );
    if (typeof parsed.path !== 'string') {
      throw new Error('Audio capture returned no file');
    }
    return {
      path: parsed.path,
      durationMs: toNumber(parsed.durationMs),
      bytes: toNumber(parsed.bytes),
    };
  },
  async cancel(): Promise<void> {
    await requireModule<AudioCaptureNative>(nativeAudioCapture, 'Audio').cancelCapture();
  },
  async amplitude(): Promise<number> {
    return nativeAudioCapture ? nativeAudioCapture.amplitude() : 0;
  },
  async sampleRate(): Promise<number> {
    return nativeAudioCapture ? nativeAudioCapture.sampleRate() : 16000;
  },
};

/* -------------------------------- model store -------------------------------- */

export const modelStore = {
  available(): boolean {
    return nativeModelStore !== null;
  },
  module(): ModelStoreNative {
    return requireModule<ModelStoreNative>(nativeModelStore, 'ModelStore');
  },
};

/* --------------------------------- reminders --------------------------------- */

export const reminders = {
  available(): boolean {
    return nativeReminders !== null;
  },
  module(): RemindersNative {
    return requireModule<RemindersNative>(nativeReminders, 'Reminders');
  },
};

/* ---------------------------------- widgets ---------------------------------- */

export const launcherWidgets = {
  available(): boolean {
    return nativeWidgets !== null;
  },
  async refresh(): Promise<void> {
    if (nativeWidgets) {
      await nativeWidgets.refresh();
    }
  },
  async supported(): Promise<boolean> {
    return nativeWidgets ? nativeWidgets.supported() : false;
  },
  /** A widget tap stores a route natively; consume it once the app is mounted. */
  async consumeLaunchTarget(): Promise<string | null> {
    if (!nativeWidgets) {
      return null;
    }
    try {
      return await nativeWidgets.consumeLaunchTarget();
    } catch {
      return null;
    }
  },
};

/* --------------------------------- documents --------------------------------- */

export const documents = {
  available(): boolean {
    return nativeDocuments !== null;
  },
  module(): DocumentsNative {
    return requireModule<DocumentsNative>(nativeDocuments, 'Documents');
  },
};

export function capabilities(): Record<string, boolean> {
  return {
    whisper: whisper.available(),
    llama: llama.available(),
    audio: audioCapture.available(),
    modelStore: modelStore.available(),
    reminders: reminders.available(),
    widgets: launcherWidgets.available(),
    documents: documents.available(),
  };
}
