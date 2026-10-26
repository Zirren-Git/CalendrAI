/**
 * Resumable, checksum-verified model download.
 *
 * The transport and hashing are injected so the orchestration (resume, size
 * checks, atomic rename, verification) is fully testable. On Android the
 * transport is a Kotlin module using OkHttp/HttpURLConnection range requests and
 * the hasher is a native streaming SHA-256; neither ever reads a whole model
 * into memory.
 */
import {
  ModelError,
  type DownloadProgress,
  type ModelEntry,
} from './types';

export interface ModelFileStore {
  exists(path: string): Promise<boolean>;
  size(path: string): Promise<number>;
  readText(path: string): Promise<string>;
  writeText(path: string, data: string): Promise<void>;
  appendChunk(path: string, chunk: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  freeSpace(): Promise<number>;
  mkdir(path: string): Promise<void>;
}

export interface DownloadStream {
  totalBytes: number;
  acceptRanges: boolean;
  status: number;
  read(): Promise<Uint8Array | null>;
  close(): Promise<void>;
}

export interface DownloadSource {
  /** Opens a GET (optionally ranged at `offset`) and returns a byte stream. */
  open(request: {url: string; offset: number}): Promise<DownloadStream>;
}

export interface FileHasher {
  sha256(path: string): Promise<string>;
}

export interface DownloadDeps {
  store: ModelFileStore;
  source: DownloadSource;
  hasher: FileHasher;
  allowedHosts: readonly string[];
  wifiOnly: boolean;
  isWifi: () => Promise<boolean>;
  cancelled?: () => boolean;
  now?: () => number;
  onProgress?: (progress: DownloadProgress) => void;
  /** Extra headroom required beyond the file size. */
  storageMarginBytes?: number;
}

const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function assertSafeFileName(fileName: string): void {
  if (
    !FILE_NAME_PATTERN.test(fileName) ||
    fileName.includes('/') ||
    fileName.includes('\\') ||
    fileName.includes('..')
  ) {
    throw new ModelError(`Unsafe model file name: ${fileName}`, 'invalid_entry');
  }
}

export function assertSafeEntry(entry: ModelEntry, allowedHosts: readonly string[]): void {
  if (entry.availability !== 'available') {
    throw new ModelError(entry.unavailableReason ?? 'Model is not available', 'unsupported');
  }
  assertSafeFileName(entry.fileName);
  if (!SHA256_PATTERN.test(entry.sha256)) {
    throw new ModelError('Model manifest entry has no valid SHA-256', 'invalid_entry');
  }
  if (!Number.isFinite(entry.sizeBytes) || entry.sizeBytes <= 0) {
    throw new ModelError('Model manifest entry has an invalid size', 'invalid_entry');
  }
  let parsed: URL;
  try {
    parsed = new URL(entry.source.url);
  } catch {
    throw new ModelError('Model URL is malformed', 'invalid_entry');
  }
  if (parsed.protocol !== 'https:') {
    throw new ModelError('Model downloads must use HTTPS', 'invalid_entry');
  }
  if (!allowedHosts.includes(parsed.hostname)) {
    throw new ModelError(`Refusing to download from untrusted host ${parsed.hostname}`, 'invalid_entry');
  }
}

export interface DownloadResult {
  path: string;
  bytes: number;
  resumedFrom: number;
  verifiedSha256: string;
}

/**
 * Downloads one model into `dir` and returns only after the SHA-256 matches.
 * The final file is never created by a partial write: bytes go to `<file>.part`
 * and are renamed only after verification.
 */
export async function downloadModel(
  entry: ModelEntry,
  dir: string,
  deps: DownloadDeps,
): Promise<DownloadResult> {
  assertSafeEntry(entry, deps.allowedHosts);
  if (deps.wifiOnly && !(await deps.isWifi())) {
    throw new ModelError('Waiting for Wi-Fi — downloads are limited to Wi-Fi in settings', 'wifi_required');
  }
  await deps.store.mkdir(dir);

  const finalPath = `${dir}/${entry.fileName}`;
  const partPath = `${finalPath}.part`;
  const sidecarPath = `${finalPath}.json`;
  const margin = deps.storageMarginBytes ?? 64 * 1024 * 1024;

  let resumedFrom = 0;
  if (await deps.store.exists(partPath)) {
    resumedFrom = await deps.store.size(partPath);
    if (resumedFrom > entry.sizeBytes) {
      // Corrupt or stale partial: start over rather than appending nonsense.
      await deps.store.remove(partPath);
      resumedFrom = 0;
    }
  }

  const free = await deps.store.freeSpace();
  if (free < entry.sizeBytes - resumedFrom + margin) {
    throw new ModelError(
      `Not enough free space: need ${Math.ceil(
        (entry.sizeBytes - resumedFrom + margin) / (1024 * 1024),
      )} MB more.`,
      'insufficient_storage',
    );
  }

  const stream = await deps.source.open({url: entry.source.url, offset: resumedFrom});
  let written = resumedFrom;
  try {
    if (resumedFrom > 0 && (stream.status === 200 || !stream.acceptRanges)) {
      // The server ignored the Range header; restart from zero.
      await deps.store.remove(partPath);
      written = 0;
      resumedFrom = 0;
    }
    if (stream.totalBytes > 0 && stream.totalBytes + resumedFrom !== entry.sizeBytes) {
      throw new ModelError(
        `The server offered ${stream.totalBytes + resumedFrom} bytes but the catalogue expects ${entry.sizeBytes}.`,
        'size_mismatch',
      );
    }
    if (resumedFrom === 0 && stream.totalBytes > 0 && stream.totalBytes !== entry.sizeBytes) {
      throw new ModelError('Downloaded size does not match the catalogue', 'size_mismatch');
    }
    for (;;) {
      if (deps.cancelled?.()) {
        throw new ModelError('Download paused', 'cancelled');
      }
      const chunk = await stream.read();
      if (chunk === null) {
        break;
      }
      await deps.store.appendChunk(partPath, chunk);
      written += chunk.byteLength;
      if (written > entry.sizeBytes) {
        await deps.store.remove(partPath);
        throw new ModelError('The download is larger than expected', 'size_mismatch');
      }
      deps.onProgress?.({
        modelId: entry.id,
        receivedBytes: written,
        totalBytes: entry.sizeBytes,
        resumedFrom,
      });
    }
  } finally {
    await stream.close();
  }

  if (written !== entry.sizeBytes) {
    // Keep the partial file so the user can resume later.
    throw new ModelError(
      `Download stopped at ${written} of ${entry.sizeBytes} bytes. Resume to continue.`,
      'size_mismatch',
    );
  }

  const digest = await deps.hasher.sha256(partPath);
  if (digest.toLowerCase() !== entry.sha256.toLowerCase()) {
    await deps.store.remove(partPath);
    throw new ModelError(
      'Checksum mismatch — the file was rejected and deleted. This usually means the download was tampered with or changed upstream.',
      'hash_mismatch',
    );
  }

  await deps.store.rename(partPath, finalPath);
  await deps.store.writeText(
    sidecarPath,
    JSON.stringify(
      {
        id: entry.id,
        sha256: digest.toLowerCase(),
        sizeBytes: entry.sizeBytes,
        verifiedAt: (deps.now ?? Date.now)(),
      },
      null,
      2,
    ),
  );
  return {path: finalPath, bytes: written, resumedFrom, verifiedSha256: digest.toLowerCase()};
}
