#!/usr/bin/env node
/**
 * Pinned model fetcher.
 *
 * Model weights are never committed. This script reads the same catalogue the
 * app ships (src/models/manifest.ts), downloads the files over HTTPS, verifies
 * size + SHA-256 and writes a sidecar so the app can prove what is installed.
 *
 * Usage:
 *   node scripts/fetch-models.mjs --check                 # validate the catalogue only
 *   node scripts/fetch-models.mjs --bundled               # fetch bundled files into the APK assets
 *   node scripts/fetch-models.mjs --dir ./models --only whisper-tiny
 *   node scripts/fetch-models.mjs --list
 *
 * Downloads resume from a `.part` file. Nothing is marked installed until the
 * digest matches; a mismatched file is deleted.
 */
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_TS = path.join(ROOT, 'src', 'models', 'manifest.ts');
const ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'models');

/**
 * Parses the TypeScript catalogue. The file is machine-generated in a fixed
 * shape; this keeps the app and this script on one source of truth without a
 * build step or a second copy of the hashes.
 */
export function parseManifestSource(source) {
  const entries = [];
  // Template constants such as HUGGING_FACE are resolved from the source so
  // the catalogue can keep using them without the script knowing their names.
  const constants = new Map();
  for (const match of source.matchAll(/const ([A-Z0-9_]+) = '([^']+)';/g)) {
    constants.set(match[1], match[2]);
  }
  const blocks = source.split(/\n    \{\n/).slice(1);
  for (const block of blocks) {
    const get = key => {
      // A block starts right after the split delimiter, so allow the match to
      // begin at the start of the block as well as on a later line.
      const match = new RegExp(`(?:^|\\n)\\s+${key}: ('([^']*)'|"([^"]*)"|([0-9_]+)|([a-z]+))`).exec(block);
      if (!match) {
        return undefined;
      }
      return match[2] ?? match[3] ?? match[4] ?? match[5];
    };
    const id = get('id');
    const fileName = get('fileName');
    const sha256 = get('sha256') ?? '';
    const size = get('sizeBytes');
    const offered = !/\n\s+availability: 'unavailable'/.test(block);
    if (!id || !fileName || (offered && (!sha256 || !size))) {
      continue;
    }
    const urlMatch = /\n\s+url: `([^`]+)`/.exec(block) ?? /\n\s+url: '([^']+)'/.exec(block);
    const rawUrl = urlMatch ? urlMatch[1] : null;
    const url = rawUrl
      ? rawUrl.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => constants.get(name) ?? `$\{${name}}`)
      : null;
    const bundled = /^\s+bundled: true|\n\s+bundled: true/.test(block);
    const kind = get('kind');
    entries.push({
      id,
      fileName,
      sha256,
      sizeBytes: Number(String(size ?? 0).replace(/_/g, '')),
      url,
      bundled,
      kind,
      offered,
    });
  }
  return entries;
}

async function loadEntries() {
  const source = await fs.readFile(MANIFEST_TS, 'utf8');
  const entries = parseManifestSource(source);
  if (entries.length === 0) {
    throw new Error('Could not parse any models from src/models/manifest.ts');
  }
  for (const entry of entries) {
    if (!entry.offered) {
      // Listed only; the app shows why it cannot be offered.
      continue;
    }
    if (!/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error(`${entry.id} has an invalid SHA-256`);
    }
    if (!Number.isFinite(entry.sizeBytes) || entry.sizeBytes <= 0) {
      throw new Error(`${entry.id} has an invalid size`);
    }
    if (!entry.url) {
      throw new Error(`${entry.id} has no download URL`);
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(entry.url);
    } catch {
      throw new Error(`${entry.id} has an unreadable URL: ${entry.url}`);
    }
    if (parsedUrl.protocol !== 'https:') {
      throw new Error(`${entry.id} must be downloaded over HTTPS`);
    }
    if (!/(^|\.)huggingface\.co$/.test(parsedUrl.hostname)) {
      throw new Error(`${entry.id} points at an unexpected host: ${parsedUrl.hostname}`);
    }
    if (!/^[A-Za-z0-9._-]+$/.test(entry.fileName)) {
      throw new Error(`${entry.id} has an unsafe file name`);
    }
  }
  return entries;
}

function parseArgs(argv) {
  const options = {check: false, bundled: false, list: false, dir: null, only: null};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') {
      options.check = true;
    } else if (arg === '--bundled') {
      options.bundled = true;
    } else if (arg === '--list') {
      options.list = true;
    } else if (arg === '--dir') {
      options.dir = argv[index + 1];
      index += 1;
    } else if (arg === '--only') {
      options.only = argv[index + 1];
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/fetch-models.mjs [--check] [--list] [--bundled] [--dir <path>] [--only <id>]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function download(entry, destination) {
  const partPath = `${destination}.part`;
  await fs.mkdir(path.dirname(destination), {recursive: true});
  let offset = 0;
  try {
    const stat = await fs.stat(partPath);
    offset = stat.size;
  } catch {
    offset = 0;
  }
  if (offset > entry.sizeBytes) {
    await fs.rm(partPath, {force: true});
    offset = 0;
  }
  if (offset === entry.sizeBytes) {
    console.log(`  resuming: partial file is already complete`);
  } else {
    console.log(`  ${offset === 0 ? 'starting' : `resuming at ${offset} bytes`}`);
    const response = await fetch(entry.url, {
      headers: offset > 0 ? {Range: `bytes=${offset}-`} : undefined,
      redirect: 'follow',
    });
    if (!response.ok && response.status !== 206) {
      throw new Error(`download failed: HTTP ${response.status}`);
    }
    if (offset > 0 && response.status === 200) {
      // The server ignored the range: restart from zero rather than corrupting.
      offset = 0;
      await fs.rm(partPath, {force: true});
    }
    const file = await fs.open(partPath, offset > 0 ? 'a' : 'w');
    let received = offset;
    let lastPrint = 0;
    try {
      for await (const chunk of response.body) {
        await file.write(chunk);
        received += chunk.length;
        if (received - lastPrint > 8 * 1024 * 1024) {
          lastPrint = received;
          const pct = ((received / entry.sizeBytes) * 100).toFixed(1);
          console.log(`  ${pct}% (${received} / ${entry.sizeBytes})`);
        }
      }
    } finally {
      await file.close();
    }
    const finalSize = (await fs.stat(partPath)).size;
    if (finalSize !== entry.sizeBytes) {
      throw new Error(`size mismatch: got ${finalSize}, expected ${entry.sizeBytes} (re-run to resume)`);
    }
  }
  const digest = await sha256File(partPath);
  if (digest.toLowerCase() !== entry.sha256) {
    await fs.rm(partPath, {force: true});
    throw new Error('SHA-256 mismatch — the file was rejected and deleted');
  }
  await fs.rename(partPath, destination);
  await fs.writeFile(
    `${destination}.json`,
    JSON.stringify({id: entry.id, sha256: digest, sizeBytes: entry.sizeBytes, verifiedAt: Date.now()}, null, 2),
  );
  console.log(`  verified ${digest.slice(0, 16)}… → ${path.relative(ROOT, destination)}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const entries = await loadEntries();

  if (options.list) {
    for (const entry of entries) {
      const mode = !entry.offered ? 'not offered' : entry.bundled ? 'bundled' : 'optional';
      console.log(
        `${entry.id.padEnd(20)} ${String(Math.round(entry.sizeBytes / (1024 * 1024))).padStart(6)} MB  ${mode.padEnd(11)} ${entry.fileName}`,
      );
    }
    return;
  }

  if (options.check) {
    console.log(
    `Catalogue OK: ${entries.length} entries, ${entries.filter(e => e.offered).length} downloadable, ${entries.filter(e => e.bundled).length} bundled.`,
  );
    return;
  }

  const dir = options.bundled ? ASSETS_DIR : path.resolve(options.dir ?? path.join(ROOT, 'models'));
  const selected = entries.filter(entry => {
    if (!entry.offered) {
      return false;
    }
    if (options.only) {
      return entry.id === options.only;
    }
    return options.bundled ? entry.bundled : true;
  });
  if (selected.length === 0) {
    console.log('Nothing selected.');
    return;
  }
  for (const entry of selected) {
    if (!entry.url) {
      console.log(`${entry.id}: no URL pinned, skipping`);
      continue;
    }
    console.log(`${entry.id} (${(entry.sizeBytes / (1024 * 1024)).toFixed(1)} MB)`);
    await download(entry, path.join(dir, entry.fileName));
  }
  console.log('Done.');
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch(error => {
    console.error(`error: ${error.message}`);
    process.exit(1);
  });
}
