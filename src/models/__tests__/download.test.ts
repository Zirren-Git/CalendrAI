import {createHash} from 'node:crypto';
import {
  assertSafeEntry,
  assertSafeFileName,
  downloadModel,
  type DownloadSource,
  type DownloadStream,
  type FileHasher,
  type ModelFileStore,
} from '../downloader';
import {ModelManager} from '../manager';
import {ModelError, type ModelEntry} from '../types';
import {MODEL_MANIFEST} from '../manifest';

class MemoryStore implements ModelFileStore {
  files = new Map<string, Uint8Array>();
  freeBytes = 4 * 1024 * 1024 * 1024;

  async exists(path: string) {
    return this.files.has(path);
  }
  async size(path: string) {
    return this.files.get(path)?.byteLength ?? 0;
  }
  async readText(path: string) {
    const bytes = this.files.get(path);
    if (!bytes) {
      throw new Error(`missing ${path}`);
    }
    return Buffer.from(bytes).toString('utf8');
  }
  async writeText(path: string, data: string) {
    this.files.set(path, new Uint8Array(Buffer.from(data, 'utf8')));
  }
  async appendChunk(path: string, chunk: Uint8Array) {
    const existing = this.files.get(path);
    if (!existing) {
      this.files.set(path, new Uint8Array(chunk));
      return;
    }
    const merged = new Uint8Array(existing.byteLength + chunk.byteLength);
    merged.set(existing, 0);
    merged.set(chunk, existing.byteLength);
    this.files.set(path, merged);
  }
  async remove(path: string) {
    this.files.delete(path);
  }
  async rename(from: string, to: string) {
    const bytes = this.files.get(from);
    if (!bytes) {
      throw new Error(`missing ${from}`);
    }
    this.files.set(to, bytes);
    this.files.delete(from);
  }
  async freeSpace() {
    return this.freeBytes;
  }
  async mkdir() {
    return;
  }
}

class ByteStream {
  constructor(private readonly payload: Uint8Array, private readonly chunkSize: number, private readonly startAt = 0) {}
  private cursor: number;
  private position = 0;

  async read(): Promise<Uint8Array | null> {
    this.cursor = this.startAt + this.position;
    if (this.cursor >= this.payload.byteLength) {
      return null;
    }
    const end = Math.min(this.payload.byteLength, this.cursor + this.chunkSize);
    const chunk = this.payload.slice(this.cursor, end);
    this.position = end - this.startAt;
    return chunk;
  }
  async close() {}
}

class MemorySource implements DownloadSource {
  requests: {offset: number}[] = [];
  constructor(
    private readonly payload: Uint8Array,
    private readonly options: {
      acceptRanges?: boolean;
      forceStatus200?: boolean;
      chunkSize?: number;
      /** Advertise a smaller size than the catalogue (server disagrees). */
      truncateTo?: number;
      /** Advertise the full size but end the stream early (dropped connection). */
      endAfter?: number;
    } = {},
  ) {}

  async open({offset}: {url: string; offset: number}): Promise<DownloadStream> {
    this.requests.push({offset});
    const acceptRanges = this.options.acceptRanges ?? true;
    const force200 = this.options.forceStatus200 ?? false;
    const useRange = acceptRanges && !force200 && offset > 0;
    const effectiveOffset = useRange ? offset : 0;
    const advertised =
      this.options.truncateTo !== undefined
        ? this.payload.slice(0, this.options.truncateTo)
        : this.payload;
    const deliverable =
      this.options.endAfter !== undefined
        ? this.payload.slice(0, this.options.endAfter)
        : advertised;
    const stream = new ByteStream(deliverable, this.options.chunkSize ?? 64, effectiveOffset);
    return {
      totalBytes: advertised.byteLength - effectiveOffset,
      acceptRanges,
      status: useRange ? 206 : 200,
      read: stream.read.bind(stream),
      close: async () => undefined,
    };
  }
}

const hasher: FileHasher = {
  sha256: async path => {
    const store = (hasher as unknown as {store?: MemoryStore}).store;
    const bytes = store?.files.get(path);
    if (!bytes) {
      throw new Error(`no file ${path}`);
    }
    return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  },
};

function attachHasher(store: MemoryStore): void {
  (hasher as unknown as {store?: MemoryStore}).store = store;
}

function payloadOf(size: number, seed = 7): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    bytes[i] = (i * seed + 13) % 251;
  }
  return bytes;
}

function entryFor(payload: Uint8Array, overrides: Partial<ModelEntry> = {}): ModelEntry {
  const base = MODEL_MANIFEST.models[0]!;
  return {
    ...base,
    id: 'test-model',
    fileName: 'ggml-test.bin',
    sizeBytes: payload.byteLength,
    sha256: createHash('sha256').update(Buffer.from(payload)).digest('hex'),
    availability: 'available',
    bundled: false,
    ...overrides,
  };
}

function depsFor(store: MemoryStore, source: DownloadSource, extra: Partial<Parameters<typeof downloadModel>[2]> = {}) {
  return {
    store,
    source,
    hasher,
    allowedHosts: MODEL_MANIFEST.allowedHosts,
    wifiOnly: false,
    isWifi: async () => true,
    ...extra,
  };
}

describe('entry validation', () => {
  it('rejects unsafe file names', () => {
    expect(() => assertSafeFileName('../etc/passwd')).toThrow(ModelError);
    expect(() => assertSafeFileName('a/b.bin')).toThrow(ModelError);
    expect(() => assertSafeFileName('ok-name_1.gguf')).not.toThrow();
  });

  it('rejects non-https, untrusted hosts and missing hashes', () => {
    const payload = payloadOf(32);
    const store = new MemoryStore();
    attachHasher(store);
    const entry = entryFor(payload);
    expect(() => assertSafeEntry(entry, MODEL_MANIFEST.allowedHosts)).not.toThrow();
    expect(() =>
      assertSafeEntry({...entry, source: {...entry.source, url: 'http://huggingface.co/x'}}, MODEL_MANIFEST.allowedHosts),
    ).toThrow(/HTTPS/);
    expect(() =>
      assertSafeEntry({...entry, source: {...entry.source, url: 'https://evil.example/x'}}, MODEL_MANIFEST.allowedHosts),
    ).toThrow(/untrusted host/);
    expect(() => assertSafeEntry({...entry, sha256: 'nope'}, MODEL_MANIFEST.allowedHosts)).toThrow(/SHA-256/);
  });
});

describe('downloadModel', () => {
  it('downloads, verifies and writes a sidecar', async () => {
    const payload = payloadOf(256);
    const store = new MemoryStore();
    attachHasher(store);
    const progress: number[] = [];
    const result = await downloadModel(entryFor(payload), '/models', depsFor(store, new MemorySource(payload), {
      onProgress: p => progress.push(p.receivedBytes),
    }));
    expect(result.verifiedSha256).toBe(entryFor(payload).sha256);
    expect(store.files.get('/models/ggml-test.bin')?.byteLength).toBe(256);
    expect(store.files.has('/models/ggml-test.bin.part')).toBe(false);
    const sidecar = JSON.parse(await store.readText('/models/ggml-test.bin.json'));
    expect(sidecar.sha256).toBe(entryFor(payload).sha256);
    expect(progress.at(-1)).toBe(256);
  });

  it('resumes from an existing partial file', async () => {
    const payload = payloadOf(512);
    const store = new MemoryStore();
    attachHasher(store);
    store.files.set('/models/ggml-test.bin.part', payload.slice(0, 200));
    const source = new MemorySource(payload);
    const result = await downloadModel(entryFor(payload), '/models', depsFor(store, source));
    expect(result.resumedFrom).toBe(200);
    expect(source.requests[0]!.offset).toBe(200);
    expect(Buffer.from(store.files.get('/models/ggml-test.bin')!)).toEqual(Buffer.from(payload));
  });

  it('restarts when the server ignores the range header', async () => {
    const payload = payloadOf(300);
    const store = new MemoryStore();
    attachHasher(store);
    store.files.set('/models/ggml-test.bin.part', payload.slice(0, 100));
    const result = await downloadModel(
      entryFor(payload),
      '/models',
      depsFor(store, new MemorySource(payload, {forceStatus200: true})),
    );
    expect(result.resumedFrom).toBe(0);
    expect(Buffer.from(store.files.get('/models/ggml-test.bin')!)).toEqual(Buffer.from(payload));
  });

  it('deletes a file whose checksum does not match', async () => {
    const payload = payloadOf(128);
    const store = new MemoryStore();
    attachHasher(store);
    const entry = entryFor(payload, {sha256: 'a'.repeat(64)});
    await expect(
      downloadModel(entry, '/models', depsFor(store, new MemorySource(payload))),
    ).rejects.toMatchObject({code: 'hash_mismatch'});
    expect(store.files.has('/models/ggml-test.bin.part')).toBe(false);
    expect(store.files.has('/models/ggml-test.bin')).toBe(false);
  });

  it('rejects a server that advertises the wrong size before writing anything', async () => {
    const payload = payloadOf(400);
    const store = new MemoryStore();
    attachHasher(store);
    await expect(
      downloadModel(
        entryFor(payload),
        '/models',
        depsFor(store, new MemorySource(payload, {truncateTo: 150})),
      ),
    ).rejects.toMatchObject({code: 'size_mismatch'});
    expect(store.files.has('/models/ggml-test.bin.part')).toBe(false);
    expect(store.files.has('/models/ggml-test.bin')).toBe(false);
  });

  it('keeps the partial file when the connection drops mid-transfer', async () => {
    const payload = payloadOf(400);
    const store = new MemoryStore();
    attachHasher(store);
    await expect(
      downloadModel(
        entryFor(payload),
        '/models',
        depsFor(store, new MemorySource(payload, {endAfter: 150})),
      ),
    ).rejects.toMatchObject({code: 'size_mismatch'});
    expect(store.files.get('/models/ggml-test.bin.part')?.byteLength).toBe(150);
    expect(store.files.has('/models/ggml-test.bin')).toBe(false);
  });

  it('refuses to download on mobile data when Wi-Fi only is set', async () => {
    const payload = payloadOf(64);
    const store = new MemoryStore();
    attachHasher(store);
    await expect(
      downloadModel(entryFor(payload), '/models', depsFor(store, new MemorySource(payload), {
        wifiOnly: true,
        isWifi: async () => false,
      })),
    ).rejects.toMatchObject({code: 'wifi_required'});
  });

  it('checks free space before starting', async () => {
    const payload = payloadOf(2048);
    const store = new MemoryStore();
    attachHasher(store);
    store.freeBytes = 1024;
    await expect(
      downloadModel(entryFor(payload), '/models', depsFor(store, new MemorySource(payload))),
    ).rejects.toMatchObject({code: 'insufficient_storage'});
  });

  it('supports cancellation and keeps bytes for a later resume', async () => {
    const payload = payloadOf(1024);
    const store = new MemoryStore();
    attachHasher(store);
    let checks = 0;
    await expect(
      downloadModel(entryFor(payload), '/models', depsFor(store, new MemorySource(payload, {chunkSize: 64}), {
        cancelled: () => {
          checks += 1;
          return checks > 3;
        },
      })),
    ).rejects.toMatchObject({code: 'cancelled'});
    const partial = store.files.get('/models/ggml-test.bin.part');
    expect(partial).toBeDefined();
    expect(partial!.byteLength).toBeGreaterThan(0);
    expect(partial!.byteLength).toBeLessThan(payload.byteLength);
  });
});

describe('ModelManager', () => {
  async function managerWith(store: MemoryStore, payload: Uint8Array) {
    attachHasher(store);
    const entry = entryFor(payload, {id: MODEL_MANIFEST.models[0]!.id, fileName: 'ggml-tiny.bin'});
    const manager = new ModelManager(
      {
        dir: '/models',
        store,
        hasher,
        source: new MemorySource(payload),
        wifiOnly: false,
        isWifi: async () => true,
        totalRamMb: 4096,
      },
      [entry],
    );
    return {manager, entry};
  }

  it('reports installed only after a verified download', async () => {
    const payload = payloadOf(500);
    const store = new MemoryStore();
    const {manager, entry} = await managerWith(store, payload);
    expect((await manager.state(entry.id)).status).toBe('not_installed');
    await manager.download(entry.id);
    const state = await manager.state(entry.id);
    expect(state.status).toBe('installed');
    expect(state.installedSha256).toBe(entry.sha256);
    expect(state.path).toBe('/models/ggml-tiny.bin');
  });

  it('rejects a sidecar with a mismatched id or declared size', async () => {
    const payload = payloadOf(300);
    const store = new MemoryStore();
    const {manager, entry} = await managerWith(store, payload);
    await manager.download(entry.id);
    await store.writeText(
      '/models/ggml-tiny.bin.json',
      JSON.stringify({id: 'different-model', sha256: entry.sha256, sizeBytes: entry.sizeBytes, verifiedAt: 1}),
    );
    expect((await manager.state(entry.id)).status).toBe('unverified');
    await store.writeText(
      '/models/ggml-tiny.bin.json',
      JSON.stringify({id: entry.id, sha256: entry.sha256, sizeBytes: 1, verifiedAt: 1}),
    );
    expect((await manager.state(entry.id)).status).toBe('unverified');
  });

  it('reports unverified when the sidecar is missing or size differs', async () => {
    const payload = payloadOf(300);
    const store = new MemoryStore();
    const {manager, entry} = await managerWith(store, payload);
    await manager.download(entry.id);
    await store.remove('/models/ggml-tiny.bin.json');
    expect((await manager.state(entry.id)).status).toBe('unverified');
    await store.writeText('/models/ggml-tiny.bin.json', JSON.stringify({id: entry.id, sha256: entry.sha256, sizeBytes: 1, verifiedAt: 1}));
    store.files.set('/models/ggml-tiny.bin', payload.slice(0, 10));
    expect((await manager.state(entry.id)).status).toBe('unverified');
  });

  it('re-verifies an existing file and can repair a missing sidecar', async () => {
    const payload = payloadOf(300);
    const store = new MemoryStore();
    const {manager, entry} = await managerWith(store, payload);
    await manager.download(entry.id);
    await store.remove('/models/ggml-tiny.bin.json');
    const verified = await manager.verify(entry.id);
    expect(verified.status).toBe('installed');
  });

  it('deletes the model, sidecar and partial file', async () => {
    const payload = payloadOf(300);
    const store = new MemoryStore();
    const {manager, entry} = await managerWith(store, payload);
    await manager.download(entry.id);
    store.files.set('/models/ggml-tiny.bin.part', payload.slice(0, 5));
    const state = await manager.remove(entry.id);
    expect(state.status).toBe('not_installed');
    expect(store.files.size).toBe(0);
  });

  it('warns when the device cannot reasonably hold the model in memory', async () => {
    const {compatibilityWarning} = await import('../manager');
    const phi = MODEL_MANIFEST.models.find(model => model.id === 'phi-3-mini-q4')!;
    expect(compatibilityWarning(phi, 4096)).toMatch(/may fail/);
    expect(compatibilityWarning(phi, 16384)).toBeNull();
  });

  it('re-hashes the bundled model before writing its installed sidecar', async () => {
    const payload = payloadOf(300);
    const store = new MemoryStore();
    const entry = entryFor(payload, {id: 'whisper-tiny', fileName: 'ggml-tiny.bin', bundled: true});
    store.files.set('/models/ggml-tiny.bin.json', JSON.stringify({
      id: entry.id,
      sha256: entry.sha256,
      sizeBytes: entry.sizeBytes,
      verifiedAt: 1,
    }));
    const manager = new ModelManager(
      {
        dir: '/models',
        store,
        hasher,
        wifiOnly: false,
        isWifi: async () => true,
        installBundled: async model => {
          store.files.set(`/models/${model.fileName}`, payload.slice(0, 10));
          return true;
        },
      },
      [entry],
    );
    await manager.ensureBundled();
    expect(store.files.has('/models/ggml-tiny.bin.json')).toBe(false);
    expect(store.files.has('/models/ggml-tiny.bin')).toBe(false);
    expect((await manager.state(entry.id)).status).toBe('not_installed');
  });

  it('rejects a download when Wi-Fi-only is enabled and Wi-Fi is absent', async () => {
    const payload = payloadOf(300);
    const store = new MemoryStore();
    const {manager, entry} = await managerWith(store, payload);
    const restricted = new ModelManager(
      {
        dir: '/models',
        store,
        hasher,
        source: new MemorySource(payload),
        wifiOnly: true,
        isWifi: async () => false,
      },
      [entry],
    );
    await expect(restricted.download(entry.id)).rejects.toMatchObject({code: 'wifi_required'});
  });

  it('never offers a gated model', async () => {
    const store = new MemoryStore();
    attachHasher(store);
    const gemma = MODEL_MANIFEST.models.find(model => model.id === 'gemma-2b-q4')!;
    const manager = new ModelManager(
      {dir: '/models', store, hasher, wifiOnly: false, isWifi: async () => true},
      [gemma],
    );
    const state = await manager.state(gemma.id);
    expect(state.status).toBe('unavailable');
    expect(state.message).toMatch(/gated/i);
  });
});
