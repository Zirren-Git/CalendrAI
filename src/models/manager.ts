/**
 * Model manager: the single source of truth for what is installed on disk.
 *
 * A model counts as installed only when the file exists, its size matches the
 * catalogue and its verification sidecar records the pinned SHA-256. Anything
 * else is reported honestly as not installed / unverified / failed.
 */
import {
  downloadModel,
  type DownloadDeps,
  type DownloadResult,
  type FileHasher,
  type ModelFileStore,
} from './downloader';
import {MODEL_MANIFEST} from './manifest';
import {ModelError, type ModelEntry, type ModelState, type DownloadProgress} from './types';

export interface ModelManagerDeps {
  /** App-private directory for model weights, e.g. filesDir/models. */
  dir: string;
  store: ModelFileStore;
  hasher: FileHasher;
  source?: DownloadDeps['source'];
  wifiOnly: boolean;
  isWifi: () => Promise<boolean>;
  /** Copies a bundled asset out of the APK; null when the build did not include it. */
  installBundled?: (entry: ModelEntry) => Promise<boolean>;
  /** Native streaming download (production); tests use `source` instead. */
  download?: (
    entry: ModelEntry,
    onProgress?: (progress: DownloadProgress) => void,
  ) => Promise<DownloadResult>;
  totalRamMb?: number;
  now?: () => number;
}

interface Sidecar {
  id: string;
  sha256: string;
  sizeBytes: number;
  verifiedAt: number;
}

export function compatibilityWarning(entry: ModelEntry, totalRamMb?: number): string | null {
  if (!totalRamMb) {
    return null;
  }
  // Leave headroom for the OS, the app and the rest of the process.
  const usable = totalRamMb * 0.55;
  if (entry.ramHintMb > usable) {
    return `This model needs about ${entry.ramHintMb} MB of RAM; this device reports ${totalRamMb} MB total. Loading it may fail.`;
  }
  return null;
}

export class ModelManager {
  private readonly entries: readonly ModelEntry[];
  private readonly deps: ModelManagerDeps;
  private readonly inflight = new Map<string, ModelState>();
  private readonly listeners = new Set<(state: ModelState) => void>();

  constructor(deps: ModelManagerDeps, entries: readonly ModelEntry[] = MODEL_MANIFEST.models) {
    this.deps = deps;
    this.entries = entries;
  }

  subscribe(listener: (state: ModelState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  entry(id: string): ModelEntry {
    const found = this.entries.find(model => model.id === id);
    if (!found) {
      throw new ModelError(`Unknown model ${id}`, 'invalid_entry');
    }
    return found;
  }

  pathFor(entry: ModelEntry): string {
    return `${this.deps.dir}/${entry.fileName}`;
  }

  async state(id: string): Promise<ModelState> {
    const entry = this.entry(id);
    const inflight = this.inflight.get(id);
    if (inflight) {
      return inflight;
    }
    if (entry.availability !== 'available') {
      return this.buildState(entry, 'unavailable', 0, null, entry.unavailableReason ?? null);
    }
    const path = this.pathFor(entry);
    const exists = await this.deps.store.exists(path);
    const warning = compatibilityWarning(entry, this.deps.totalRamMb);
    if (!exists) {
      const bundledMissing = entry.bundled && this.deps.installBundled === undefined;
      return this.buildState(
        entry,
        'not_installed',
        0,
        warning,
        bundledMissing ? 'This build does not bundle the model asset.' : warning,
      );
    }
    const size = await this.deps.store.size(path);
    if (size !== entry.sizeBytes) {
      return this.buildState(
        entry,
        'unverified',
        size,
        warning,
        'File size does not match the catalogue — verify or delete it.',
      );
    }
    const sidecar = await this.readSidecar(`${path}.json`);
    if (
      !sidecar ||
      sidecar.id !== entry.id ||
      sidecar.sizeBytes !== entry.sizeBytes ||
      sidecar.sha256 !== entry.sha256
    ) {
      return this.buildState(
        entry,
        'unverified',
        size,
        warning,
        'This file has not been checksum-verified by Dayloom.',
      );
    }
    return this.buildState(entry, 'installed', size, warning, warning);
  }

  async states(): Promise<ModelState[]> {
    return Promise.all(this.entries.map(entry => this.state(entry.id)));
  }

  private buildState(
    entry: ModelEntry,
    status: ModelState['status'],
    bytesOnDisk: number,
    message: string | null,
    overrideMessage: string | null = message,
  ): ModelState {
    return {
      id: entry.id,
      status,
      bytesOnDisk,
      expectedBytes: entry.sizeBytes,
      path: status === 'installed' ? this.pathFor(entry) : null,
      installedSha256: status === 'installed' ? entry.sha256 : null,
      message: overrideMessage ?? message,
    };
  }

  private async readSidecar(path: string): Promise<Sidecar | null> {
    if (!(await this.deps.store.exists(path))) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(await this.deps.store.readText(path));
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      const record = parsed as Record<string, unknown>;
      if (
        typeof record.id !== 'string' ||
        typeof record.sha256 !== 'string' ||
        typeof record.sizeBytes !== 'number'
      ) {
        return null;
      }
      return {
        id: record.id,
        sha256: record.sha256,
        sizeBytes: record.sizeBytes,
        verifiedAt: typeof record.verifiedAt === 'number' ? record.verifiedAt : 0,
      };
    } catch {
      return null;
    }
  }

  /** Copies a bundled asset into app storage (first launch for Whisper Tiny). */
  async ensureBundled(onProgress?: (progress: DownloadProgress) => void): Promise<ModelState[]> {
    for (const entry of this.entries) {
      if (!entry.bundled || entry.availability !== 'available') {
        continue;
      }
      if (!this.deps.installBundled) {
        continue;
      }
      const current = await this.state(entry.id);
      if (current.status === 'installed') {
        continue;
      }
      // A stale or forged sidecar is never sufficient to skip asset copy and
      // full verification. Clear the destination before installing fresh.
      await this.deps.store.remove(this.pathFor(entry)).catch(() => undefined);
      await this.deps.store.remove(`${this.pathFor(entry)}.json`).catch(() => undefined);
      onProgress?.({modelId: entry.id, receivedBytes: 0, totalBytes: entry.sizeBytes, resumedFrom: 0});
      try {
        const ok = await this.deps.installBundled(entry);
        if (!ok) {
          continue;
        }
        const modelPath = this.pathFor(entry);
        const actualSize = await this.deps.store.size(modelPath);
        const actualDigest = await this.deps.hasher.sha256(modelPath);
        if (actualSize !== entry.sizeBytes || actualDigest.toLowerCase() !== entry.sha256.toLowerCase()) {
          await this.deps.store.remove(modelPath).catch(() => undefined);
          await this.deps.store.remove(`${modelPath}.json`).catch(() => undefined);
          continue;
        }
        await this.deps.store.writeText(
          `${modelPath}.json`,
          JSON.stringify(
            {
              id: entry.id,
              sha256: entry.sha256,
              sizeBytes: entry.sizeBytes,
              verifiedAt: (this.deps.now ?? Date.now)(),
            },
            null,
            2,
          ),
        );
      } catch {
        // A missing or unreadable bundled asset must not block app start, and
        // an asset that failed verification must not remain as a candidate.
        await this.deps.store.remove(this.pathFor(entry)).catch(() => undefined);
        await this.deps.store.remove(`${this.pathFor(entry)}.json`).catch(() => undefined);
      }
    }
    return this.states();
  }

  async download(
    id: string,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<DownloadResult> {
    const entry = this.entry(id);
    if (this.deps.wifiOnly && !(await this.deps.isWifi())) {
      throw new ModelError('Waiting for Wi-Fi — downloads are limited to Wi-Fi in settings', 'wifi_required');
    }
    if (!this.deps.source && !this.deps.download) {
      throw new ModelError('Downloads are not available in this build', 'unsupported');
    }
    this.inflight.set(id, {
      id,
      status: 'downloading',
      bytesOnDisk: 0,
      expectedBytes: entry.sizeBytes,
      path: null,
      installedSha256: null,
      message: 'Downloading…',
    });
    this.emit(id);
    const report = (progress: DownloadProgress) => {
      this.inflight.set(id, {
        id,
        status: 'downloading',
        bytesOnDisk: progress.receivedBytes,
        expectedBytes: progress.totalBytes,
        path: null,
        installedSha256: null,
        message: 'Downloading…',
      });
      onProgress?.(progress);
      this.emit(id);
    };
    try {
      const result = this.deps.download
        ? await this.deps.download(entry, report)
        : await downloadModel(entry, this.deps.dir, {
            store: this.deps.store,
            source: this.deps.source!,
            hasher: this.deps.hasher,
            allowedHosts: MODEL_MANIFEST.allowedHosts,
            wifiOnly: this.deps.wifiOnly,
            isWifi: this.deps.isWifi,
            cancelled: () => false,
            now: this.deps.now,
            onProgress: report,
          });
      this.inflight.delete(id);
      this.emit(id);
      return result;
    } catch (error) {
      this.inflight.delete(id);
      this.emit(id);
      throw error;
    }
  }

  /** Re-hashes an existing file and rewrites its sidecar when it matches. */
  async verify(id: string): Promise<ModelState> {
    const entry = this.entry(id);
    const path = this.pathFor(entry);
    if (!(await this.deps.store.exists(path))) {
      throw new ModelError('Model is not installed', 'not_installed');
    }
    const digest = await this.deps.hasher.sha256(path);
    if (digest.toLowerCase() !== entry.sha256) {
      await this.deps.store.remove(`${path}.json`);
      return this.buildState(
        entry,
        'verification_failed',
        0,
        'Checksum does not match the catalogue. Delete the file and download again.',
      );
    }
    await this.deps.store.writeText(
      `${path}.json`,
      JSON.stringify({
        id: entry.id,
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes,
        verifiedAt: (this.deps.now ?? Date.now)(),
      }),
    );
    return this.state(id);
  }

  async remove(id: string): Promise<ModelState> {
    const entry = this.entry(id);
    const path = this.pathFor(entry);
    await this.deps.store.remove(path).catch(() => undefined);
    await this.deps.store.remove(`${path}.json`).catch(() => undefined);
    await this.deps.store.remove(`${path}.part`).catch(() => undefined);
    return this.state(id);
  }

  private emit(id: string): void {
    const snapshot = this.inflight.get(id);
    if (snapshot) {
      for (const listener of this.listeners) {
        listener(snapshot);
      }
    }
  }
}
