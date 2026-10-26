/**
 * Adapter that lets the agent consult an installed GGUF model through
 * llama.cpp. It is optional: when no LLM is installed, planWithLlm() is simply
 * never called and the deterministic parser handles every command.
 */
import type {LocalLlm, LlmGenerateRequest, LlmGeneration} from '../agent/llm';
import {llama} from '../native/index';
import type {ModelManager} from '../models/manager';

/** Context window kept small enough for 2B models on a phone. */
const CONTEXT_SIZE = 2048;
const BATCH_SIZE = 256;
const THREADS = 2;

export class LlamaLocalLlm implements LocalLlm {
  private contextId: number | null = null;
  private loading: Promise<number> | null = null;

  constructor(
    private readonly manager: ModelManager,
    readonly modelId: string,
  ) {}

  async isReady(): Promise<boolean> {
    if (!llama.available()) {
      return false;
    }
    const state = await this.manager.state(this.modelId);
    return state.status === 'installed';
  }

  async generate(request: LlmGenerateRequest): Promise<LlmGeneration> {
    const contextId = await this.load();
    const result = await llama.generate(
      contextId,
      request.prompt,
      request.maxTokens ?? 256,
      request.temperature ?? 0,
    );
    return {text: result.text, durationMs: result.durationMs, tokensPerSecond: result.tokensPerSecond};
  }

  async cancel(): Promise<void> {
    if (this.contextId !== null) {
      await llama.cancel(this.contextId).catch(() => undefined);
    }
  }

  async unload(): Promise<void> {
    if (this.contextId !== null) {
      const id = this.contextId;
      this.contextId = null;
      this.loading = null;
      await llama.unload(id).catch(() => undefined);
    }
  }

  private async load(): Promise<number> {
    if (this.contextId !== null) {
      return this.contextId;
    }
    if (this.loading) {
      return this.loading;
    }
    this.loading = (async () => {
      const state = await this.manager.state(this.modelId);
      if (state.status !== 'installed' || !state.path) {
        throw new Error('The selected language model is not installed.');
      }
      const info = await llama.load({
        modelPath: state.path,
        contextSize: CONTEXT_SIZE,
        batchSize: BATCH_SIZE,
        threads: THREADS,
      });
      this.contextId = info.contextId;
      return info.contextId;
    })();
    try {
      return await this.loading;
    } catch (error) {
      this.loading = null;
      throw error;
    }
  }
}
