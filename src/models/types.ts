/** Types for on-device model assets and their storage lifecycle. */

export type ModelKind = 'asr' | 'llm';
export type ModelRuntime = 'whisper.cpp' | 'llama.cpp';

export interface ModelLicense {
  name: string;
  url: string;
  redistributable: boolean;
  attribution: string;
}

export interface ModelSource {
  url: string;
  repository: string;
  /** Tracked branch or tag; integrity is enforced by the pinned SHA-256. */
  revision: string;
  verifiedAt: string;
}

export interface ModelEntry {
  id: string;
  name: string;
  description: string;
  kind: ModelKind;
  runtime: ModelRuntime;
  /** File name only — never a path. Validated before use. */
  fileName: string;
  sizeBytes: number;
  sha256: string;
  bundled: boolean;
  languages: 'multilingual' | 'en' | 'en+';
  quantization?: string;
  license: ModelLicense;
  source: ModelSource;
  ramHintMb: number;
  compatibility: string;
  availability: 'available' | 'unavailable';
  unavailableReason?: string;
}

export interface ModelManifest {
  schemaVersion: number;
  verifiedAt: string;
  allowedHosts: string[];
  models: ModelEntry[];
}

export type ModelStatus =
  | 'not_installed'
  | 'downloading'
  | 'verifying'
  | 'installed'
  | 'unverified'
  | 'verification_failed'
  | 'unavailable'
  | 'insufficient_storage'
  | 'incompatible'
  | 'error';

export interface ModelState {
  id: string;
  status: ModelStatus;
  bytesOnDisk: number;
  expectedBytes: number;
  path: string | null;
  installedSha256: string | null;
  message: string | null;
}

export interface DownloadProgress {
  modelId: string;
  receivedBytes: number;
  totalBytes: number;
  resumedFrom: number;
}

/** Thrown errors are typed so the UI can show a specific, truthful message. */
export class ModelError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_entry'
      | 'wifi_required'
      | 'insufficient_storage'
      | 'network'
      | 'hash_mismatch'
      | 'size_mismatch'
      | 'cancelled'
      | 'io'
      | 'unsupported'
      | 'not_installed',
  ) {
    super(message);
  }
}
