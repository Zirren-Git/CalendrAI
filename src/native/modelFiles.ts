/**
 * Production adapters that back the model manager with the native module:
 * streaming download, native SHA-256, and app-private file operations.
 */
import {modelStore} from './index';
import type {
  DownloadResult,
  FileHasher,
  ModelFileStore,
} from '../models/downloader';
import type {DownloadProgress, ModelEntry} from '../models/types';
import {ModelError} from '../models/types';

export function createNativeFileStore(): ModelFileStore {
  const module = modelStore.module();
  return {
    exists: path => module.fileExists(path),
    size: path => module.fileSize(path),
    readText: path => module.readTextFile(path),
    writeText: (path, data) => module.writeTextFile(path, data),
    // Appends are performed by the native downloader; the JS store never
    // receives model bytes.
    appendChunk: async () => {
      throw new ModelError('Chunked writes are handled natively', 'unsupported');
    },
    remove: path => module.deleteFile(path),
    rename: (from, to) => module.renameFile(from, to),
    freeSpace: () => module.freeSpaceBytes(),
    mkdir: async () => undefined,
  };
}

export const nativeHasher: FileHasher = {
  sha256: path => modelStore.module().sha256File(path),
};

export async function nativeIsWifi(): Promise<boolean> {
  try {
    return await modelStore.module().isWifiConnected();
  } catch {
    return false;
  }
}

/**
 * Downloads a model with the native transport, then verifies and atomically
 * promotes it. Mirrors downloadModel() but keeps bytes out of the JS heap.
 */
export async function downloadModelNatively(
  entry: ModelEntry,
  dir: string,
  onProgress?: (progress: DownloadProgress) => void,
  signal?: {cancelled: boolean},
): Promise<DownloadResult> {
  const module = modelStore.module();
  if (entry.availability !== 'available') {
    throw new ModelError(entry.unavailableReason ?? 'Model is unavailable', 'unsupported');
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(entry.source.url);
  } catch {
    throw new ModelError('Refusing a malformed model URL', 'invalid_entry');
  }
  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.username !== '' ||
    parsedUrl.password !== '' ||
    parsedUrl.port !== '' ||
    parsedUrl.hostname !== 'huggingface.co'
  ) {
    throw new ModelError('Refusing a model URL outside the verified HTTPS host', 'invalid_entry');
  }
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(entry.fileName) ||
    entry.fileName.includes('..') ||
    !['.bin', '.gguf'].some(extension => entry.fileName.toLowerCase().endsWith(extension))
  ) {
    throw new ModelError('Refusing an unsafe model file name', 'invalid_entry');
  }
  if (!/^[a-f0-9]{64}$/i.test(entry.sha256) || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes <= 0) {
    throw new ModelError('Refusing a model without a valid size and SHA-256', 'invalid_entry');
  }
  const finalPath = `${dir}/${entry.fileName}`;
  const partPath = `${finalPath}.part`;
  await module.deleteFile(`${finalPath}.json`).catch(() => undefined);
  let offset = (await module.fileExists(partPath)) ? await module.fileSize(partPath) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    await module.deleteFile(partPath);
    throw new ModelError('The partial model file has an invalid size.', 'size_mismatch');
  }
  if (offset > entry.sizeBytes) {
    await module.deleteFile(partPath);
    offset = 0;
  }
  const free = await module.freeSpaceBytes();
  if (free < entry.sizeBytes - offset + 64 * 1024 * 1024) {
    throw new ModelError('Not enough free storage for this model', 'insufficient_storage');
  }
  const raw = await module.downloadFile(entry.source.url, partPath, offset, entry.sizeBytes, json => {
    try {
      const progress = JSON.parse(json) as Record<string, unknown>;
      onProgress?.({
        modelId: entry.id,
        receivedBytes: Number(progress.receivedBytes ?? 0),
        totalBytes: entry.sizeBytes,
        resumedFrom: offset,
      });
    } catch {
      // Progress frames are best-effort.
    }
  });
  let result: {bytesWritten?: number; resumedFrom?: number; status?: number};
  try {
    result = JSON.parse(raw) as typeof result;
  } catch {
    throw new ModelError('The download returned an unreadable response', 'network');
  }
  if (signal?.cancelled) {
    throw new ModelError('Download paused', 'cancelled');
  }
  const written = Number(result.bytesWritten ?? 0);
  if (!Number.isSafeInteger(written) || written !== entry.sizeBytes) {
    throw new ModelError(
      `Download stopped at ${written} of ${entry.sizeBytes} bytes. Resume to continue.`,
      'size_mismatch',
    );
  }
  const expectedResume = result.status === 206 ? offset : 0;
  if (
    !Number.isSafeInteger(result.status) ||
    ![200, 206].includes(result.status ?? 0) ||
    !Number.isSafeInteger(result.resumedFrom) ||
    Number(result.resumedFrom) !== expectedResume
  ) {
    await module.deleteFile(partPath);
    throw new ModelError('The server returned an invalid range response; the partial file was rejected.', 'network');
  }
  const digest = (await module.sha256File(partPath)).toLowerCase();
  if (digest !== entry.sha256.toLowerCase()) {
    await module.deleteFile(partPath);
    throw new ModelError('Checksum mismatch — the file was rejected and deleted.', 'hash_mismatch');
  }
  await module.renameFile(partPath, finalPath);
  try {
    await module.writeTextFile(
      `${finalPath}.json`,
      JSON.stringify({id: entry.id, sha256: digest, sizeBytes: entry.sizeBytes, verifiedAt: Date.now()}),
    );
  } catch (error) {
    await module.deleteFile(finalPath).catch(() => undefined);
    throw error;
  }
  return {path: finalPath, bytes: written, resumedFrom: offset, verifiedSha256: digest};
}
