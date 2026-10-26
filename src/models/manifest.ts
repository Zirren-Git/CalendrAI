/**
 * Pinned model catalogue.
 *
 * Every hash below is the SHA-256 and exact size recorded for the source file
 * on 2026-10-24. The current source URLs use mutable Hugging Face `main`
 * revisions; the digest still rejects changed content, but does not make source
 * retrieval immutable. The exact revision URLs should be pinned before a
 * release. See docs/model-assets.md.
 *
 * See docs/model-assets.md for the full register (licence, attribution,
 * redistribution status and what has actually been built/tested).
 */
import type {ModelManifest} from './types';

const HUGGING_FACE = 'https://huggingface.co';
const VERIFIED_AT = '2026-10-24';

export const MODEL_MANIFEST: ModelManifest = {
  schemaVersion: 1,
  verifiedAt: VERIFIED_AT,
  allowedHosts: ['huggingface.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.huggingface.co'],
  models: [
    {
      id: 'whisper-tiny',
      name: 'Whisper Tiny',
      description: 'Speech-to-text for voice commands. Bundled so push-to-talk works offline on first launch.',
      kind: 'asr',
      runtime: 'whisper.cpp',
      fileName: 'ggml-tiny.bin',
      sizeBytes: 77_691_713,
      sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
      bundled: true,
      languages: 'multilingual',
      license: {
        name: 'MIT (whisper.cpp) / MIT (OpenAI Whisper weights)',
        url: 'https://github.com/ggerganov/whisper.cpp/blob/master/LICENSE',
        redistributable: true,
        attribution: 'whisper.cpp © Georgi Gerganov and contributors; Whisper weights © OpenAI.',
      },
      source: {
        url: `${HUGGING_FACE}/ggerganov/whisper.cpp/resolve/80da2d8bfee42b0e836fc3a9890373e5defc00a6/ggml-tiny.bin`,
        repository: 'ggerganov/whisper.cpp',
        revision: '80da2d8bfee42b0e836fc3a9890373e5defc00a6',
        verifiedAt: VERIFIED_AT,
      },
      ramHintMb: 400,
      compatibility: 'Runs on any arm64 Android device; ~78 MB on disk.',
      availability: 'available',
    },
    {
      id: 'whisper-base',
      name: 'Whisper Base',
      description: 'More accurate multilingual transcription. Optional download.',
      kind: 'asr',
      runtime: 'whisper.cpp',
      fileName: 'ggml-base.bin',
      sizeBytes: 147_951_465,
      sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
      bundled: false,
      languages: 'multilingual',
      license: {
        name: 'MIT (whisper.cpp) / MIT (OpenAI Whisper weights)',
        url: 'https://github.com/ggerganov/whisper.cpp/blob/master/LICENSE',
        redistributable: true,
        attribution: 'whisper.cpp © Georgi Gerganov and contributors; Whisper weights © OpenAI.',
      },
      source: {
        url: `${HUGGING_FACE}/ggerganov/whisper.cpp/resolve/80da2d8bfee42b0e836fc3a9890373e5defc00a6/ggml-base.bin`,
        repository: 'ggerganov/whisper.cpp',
        revision: '80da2d8bfee42b0e836fc3a9890373e5defc00a6',
        verifiedAt: VERIFIED_AT,
      },
      ramHintMb: 600,
      compatibility: 'arm64 recommended; ~148 MB on disk.',
      availability: 'available',
    },
    {
      id: 'whisper-small',
      name: 'Whisper Small',
      description: 'Highest accuracy transcription offered here. Slower on low-end phones.',
      kind: 'asr',
      runtime: 'whisper.cpp',
      fileName: 'ggml-small.bin',
      sizeBytes: 487_601_967,
      sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
      bundled: false,
      languages: 'multilingual',
      license: {
        name: 'MIT (whisper.cpp) / MIT (OpenAI Whisper weights)',
        url: 'https://github.com/ggerganov/whisper.cpp/blob/master/LICENSE',
        redistributable: true,
        attribution: 'whisper.cpp © Georgi Gerganov and contributors; Whisper weights © OpenAI.',
      },
      source: {
        url: `${HUGGING_FACE}/ggerganov/whisper.cpp/resolve/80da2d8bfee42b0e836fc3a9890373e5defc00a6/ggml-small.bin`,
        repository: 'ggerganov/whisper.cpp',
        revision: '80da2d8bfee42b0e836fc3a9890373e5defc00a6',
        verifiedAt: VERIFIED_AT,
      },
      ramHintMb: 1200,
      compatibility: 'Needs ~1.2 GB free RAM while transcribing; not recommended under 4 GB total RAM.',
      availability: 'available',
    },
    {
      id: 'tinyllama-1.1b-q4',
      name: 'TinyLlama 1.1B Chat (Q4_K_M)',
      description: 'Small local language model for freer command phrasing. Runs fully offline once installed.',
      kind: 'llm',
      runtime: 'llama.cpp',
      fileName: 'tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
      sizeBytes: 668_788_096,
      sha256: '9fecc3b3cd76bba89d504f29b616eedf7da85b96540e490ca5824d3f7d2776a0',
      bundled: false,
      languages: 'en',
      quantization: 'Q4_K_M',
      license: {
        name: 'Apache-2.0',
        url: 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF',
        redistributable: true,
        attribution: 'TinyLlama © TinyLlama project; GGUF conversion by TheBloke.',
      },
      source: {
        url: `${HUGGING_FACE}/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/c1d7cb837a660d93ba28f936efb148591bfba3e9/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf`,
        repository: 'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF',
        revision: 'c1d7cb837a660d93ba28f936efb148591bfba3e9',
        verifiedAt: VERIFIED_AT,
      },
      ramHintMb: 1500,
      compatibility: 'Comfortable on 6 GB+ RAM devices; expect ~5-10 tokens/s on mid-range arm64.',
      availability: 'available',
    },
    {
      id: 'phi-3-mini-q4',
      name: 'Phi-3 Mini 4K Instruct (Q4)',
      description: 'Larger local model with better reasoning about complex sentences. Optional, large download.',
      kind: 'llm',
      runtime: 'llama.cpp',
      fileName: 'Phi-3-mini-4k-instruct-q4.gguf',
      sizeBytes: 2_393_231_072,
      sha256: '8a83c7fb9049a9b2e92266fa7ad04933bb53aa1e85136b7b30f1b8000ff2edef',
      bundled: false,
      languages: 'en',
      quantization: 'Q4',
      license: {
        name: 'MIT',
        url: 'https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf',
        redistributable: true,
        attribution: 'Phi-3 © Microsoft Corporation.',
      },
      source: {
        url: `${HUGGING_FACE}/microsoft/Phi-3-mini-4k-instruct-gguf/resolve/c80d904a71b99a3eaeb8d3dbf164166384c09dc3/Phi-3-mini-4k-instruct-q4.gguf`,
        repository: 'microsoft/Phi-3-mini-4k-instruct-gguf',
        revision: 'c80d904a71b99a3eaeb8d3dbf164166384c09dc3',
        verifiedAt: VERIFIED_AT,
      },
      ramHintMb: 4600,
      compatibility:
        'Requires roughly 4.6 GB of free RAM while loaded. On devices with 6 GB or less this will usually fail to load; the app refuses to start it below the reported free-memory threshold.',
      availability: 'available',
    },
    {
      id: 'gemma-2b-q4',
      name: 'Gemma 2B IT (Q4)',
      description: 'Not offered: distribution is gated and cannot be downloaded anonymously.',
      kind: 'llm',
      runtime: 'llama.cpp',
      fileName: 'gemma-2b-it.gguf',
      sizeBytes: 0,
      sha256: '',
      bundled: false,
      languages: 'en',
      quantization: 'Q4',
      license: {
        name: 'Gemma Terms of Use (gated)',
        url: 'https://ai.google.dev/gemma/terms',
        redistributable: false,
        attribution: 'Gemma © Google LLC.',
      },
      source: {
        url: `${HUGGING_FACE}/google/gemma-2b-it-GGUF`,
        repository: 'google/gemma-2b-it-GGUF',
        revision: 'main',
        verifiedAt: VERIFIED_AT,
      },
      ramHintMb: 2500,
      compatibility: 'Not available in-app.',
      availability: 'unavailable',
      unavailableReason:
        'The Gemma repository is gated behind the Gemma Terms of Use and requires an authenticated Hugging Face account, so the app cannot download it without a user token. No hash could be verified, so it is listed but not offered.',
    },
  ],
};

export function findModel(id: string) {
  return MODEL_MANIFEST.models.find(model => model.id === id) ?? null;
}

export function bundledModels() {
  return MODEL_MANIFEST.models.filter(model => model.bundled && model.availability === 'available');
}

export function downloadableModels() {
  return MODEL_MANIFEST.models.filter(model => !model.bundled && model.availability === 'available');
}
