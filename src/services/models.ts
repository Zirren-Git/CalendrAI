/**
 * App wiring for the model manager.
 *
 * There is exactly one manager instance per Wi-Fi preference: the manager owns
 * no mutable state beyond in-flight downloads (truth lives on disk), so
 * rebuilding it when the preference changes is safe.
 */
import {ModelManager} from '../models/manager';
import type {ModelState} from '../models/types';
import {MODEL_MANIFEST} from '../models/manifest';
import {modelStore} from '../native/index';
import {
  createNativeFileStore,
  downloadModelNatively,
  nativeHasher,
  nativeIsWifi,
} from '../native/modelFiles';

let cached: {wifiOnly: boolean; manager: ModelManager} | null = null;

export function modelsSupported(): boolean {
  return modelStore.available();
}

export async function createModelManager(wifiOnly: boolean): Promise<ModelManager> {
  if (cached && cached.wifiOnly === wifiOnly) {
    return cached.manager;
  }
  const module = modelStore.module();
  // The native module owns the real app-private path; never guess a relative one.
  const dir = await module.modelsDir();
  const manager = new ModelManager({
    dir,
    store: createNativeFileStore(),
    hasher: nativeHasher,
    wifiOnly,
    isWifi: nativeIsWifi,
    installBundled: async entry => {
      // The asset path mirrors scripts/fetch-models.mjs --bundled output.
      return module.installBundledAsset(`models/${entry.fileName}`, `${dir}/${entry.fileName}`);
    },
    download: (entry, onProgress) => downloadModelNatively(entry, dir, onProgress),
    totalRamMb: await module.deviceRamMb().catch(() => 0),
  });
  cached = {wifiOnly, manager};
  return manager;
}

export async function deviceModelFacts(): Promise<{
  freeSpaceBytes: number;
  ramMb: number;
  abi: string;
} | null> {
  if (!modelStore.available()) {
    return null;
  }
  const module = modelStore.module();
  const [freeSpaceBytes, ramMb, abi] = await Promise.all([
    module.freeSpaceBytes().catch(() => 0),
    module.deviceRamMb().catch(() => 0),
    module.deviceAbi().catch(() => 'unknown'),
  ]);
  return {freeSpaceBytes, ramMb, abi};
}

export function bundledModelIds(): string[] {
  return MODEL_MANIFEST.models.filter(entry => entry.bundled).map(entry => entry.id);
}

export type {ModelState};
