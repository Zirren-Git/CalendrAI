/**
 * On-device speech-to-text.
 *
 * Whisper is loaded lazily, kept for the life of the app, and released on
 * demand. Audio never leaves the device: the native capture module writes a
 * 16 kHz mono WAV into app-private storage and the native Whisper module reads
 * that file directly.
 */
import {PermissionsAndroid} from 'react-native';
import type {ModelManager} from '../models/manager';
import {audioCapture, whisper, type TranscriptionResult} from '../native/index';
import {ModelError} from '../models/types';

interface Loaded {
  contextId: number;
  modelPath: string;
}

let loaded: Loaded | null = null;
let loading: Promise<Loaded> | null = null;

export class SpeechUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeechUnavailableError';
  }
}

/**
 * Transcription is short and latency-sensitive; two threads keeps the UI
 * responsive on mid-range phones without starving the encoder.
 */
const TRANSCRIBE_THREADS = 2;

function threadsForDevice(): number {
  return TRANSCRIBE_THREADS;
}

export async function ensureWhisper(manager: ModelManager): Promise<Loaded> {
  if (loaded) {
    return loaded;
  }
  if (!whisper.available() || !audioCapture.available()) {
    throw new SpeechUnavailableError('On-device speech is not available in this build.');
  }
  if (loading) {
    return loading;
  }
  loading = (async () => {
    const state = await manager.state('whisper-tiny');
    if (state.status !== 'installed' || !state.path) {
      throw new SpeechUnavailableError(
        state.message ?? 'The bundled speech model is missing. Reinstall the app or verify it in AI Models.',
      );
    }
    const info = await whisper.loadModel(state.path, threadsForDevice());
    loaded = {contextId: info.contextId, modelPath: state.path};
    return loaded;
  })();
  try {
    return await loading;
  } catch (error) {
    loading = null;
    if (error instanceof ModelError) {
      throw new SpeechUnavailableError(error.message);
    }
    throw error;
  }
}

export async function releaseWhisper(): Promise<void> {
  if (!loaded) {
    return;
  }
  const {contextId} = loaded;
  loaded = null;
  loading = null;
  await whisper.unload(contextId).catch(() => undefined);
}

export interface Recording {
  path: string;
  durationMs: number;
}

/**
 * Permission is requested here, at the moment the user taps the microphone —
 * never at startup. A denial is a normal outcome that the UI explains.
 */
export async function ensureMicrophonePermission(): Promise<boolean> {
  if (await audioCapture.hasPermission()) {
    return true;
  }
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: 'Microphone for voice commands',
    message: 'Dayloom records only while you hold the talk button, transcribes on this device, then deletes the audio.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/** Nothing may retain a recording; callers delete it once transcribed. */
export async function startRecording(): Promise<void> {
  if (!(await ensureMicrophonePermission())) {
    throw new SpeechUnavailableError('Microphone permission is needed for voice commands.');
  }
  await audioCapture.start();
}

export async function stopRecording(): Promise<Recording> {
  const result = await audioCapture.stop();
  return {path: result.path, durationMs: result.durationMs};
}

export async function cancelRecording(): Promise<void> {
  await audioCapture.cancel().catch(() => undefined);
}

export async function transcribe(
  manager: ModelManager,
  audioPath: string,
  language = 'auto',
): Promise<TranscriptionResult> {
  const context = await ensureWhisper(manager);
  return whisper.transcribe(context.contextId, audioPath, language, threadsForDevice());
}

export function microphoneAvailable(): boolean {
  return audioCapture.available();
}

/** True once the native modules and the bundled model are both usable. */
export async function speechReady(manager: ModelManager | null): Promise<boolean> {
  if (!manager || !whisper.available() || !audioCapture.available()) {
    return false;
  }
  const state = await manager.state('whisper-tiny');
  return state.status === 'installed';
}
