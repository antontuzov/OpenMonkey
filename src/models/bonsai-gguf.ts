import type {
  Llama,
  LlamaModel,
  LlamaContext,
  LlamaChatSession,
  ChatSystemMessage,
  ChatHistoryItem,
} from "node-llama-cpp";
import * as fs from "node:fs";
import logger from "../utils/logger";
import { drainAddonWork, outstandingAddonWorkers, trackAddonWork } from "./addon-work";
import type { BenchmarkMeasurement } from "./benchmark";

export interface BonsaiConfig {
  modelPath: string;
  contextSize: number;
}

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
  onTextChunk?: (text: string) => void;
  /** How many tokens the model produced, reported once the turn is over. */
  onTokens?: (tokens: number) => void;
}

type LlamaCppModule = typeof import("node-llama-cpp");

/** A generation aborts, so quit only waits this long for one to settle. */
const ABORT_DRAIN_MS = 15_000;

/**
 * A load cannot be aborted — llama.cpp is already filling tensors on a libuv thread —
 * so quit waits this long for it. Exiting before it settles makes the addon complete
 * the worker into a freed JS context, which aborts the process.
 */
const LOAD_SETTLE_MS = 90_000;

/** How long teardown waits for each kind of outstanding addon worker. */
export interface DrainBudget {
  abortMs: number;
  loadMs: number;
}

/**
 * node-llama-cpp is ESM with top-level await, so `require()` throws and a literal
 * `await import()` is rewritten to `require()` when this file bundles to CJS.
 * Constructing the import through Function keeps it a genuine runtime import.
 */
function importLlamaCpp(): Promise<LlamaCppModule> {
  return new Function("return import('node-llama-cpp')")() as Promise<LlamaCppModule>;
}

export class BonsaiGGUF {
  private config: BonsaiConfig;
  private llama: Llama | null = null;
  private model: LlamaModel | null = null;
  private context: LlamaContext | null = null;
  private session: LlamaChatSession | null = null;
  private loading: Promise<void> | null = null;
  private activeSystemPrompt = "";
  private loadWorker: Promise<void> | null = null;
  private aborts = new Set<AbortController>();
  private quitting = false;
  private readonly drain: DrainBudget;

  constructor(config: BonsaiConfig, drain: Partial<DrainBudget> = {}) {
    this.config = config;
    this.drain = {
      abortMs: drain.abortMs ?? ABORT_DRAIN_MS,
      loadMs: drain.loadMs ?? LOAD_SETTLE_MS,
    };
  }

  get isLoaded(): boolean {
    return this.session != null;
  }

  async load(): Promise<void> {
    if (this.quitting) throw new Error("The app is closing, so the model will not load again");
    if (this.loading) return this.loading;

    this.loading = (async () => {
      if (!fs.existsSync(this.config.modelPath)) {
        throw new Error(`Bonsai model not found at ${this.config.modelPath}. Run: npm run download-models`);
      }

      const { getLlama, LlamaChatSession } = await importLlamaCpp();
      logger.info("gguf.load.start", { modelPath: this.config.modelPath });

      this.llama = await getLlama();
      this.model = await this.llama.loadModel({ modelPath: this.config.modelPath });

      // Bonsai-4B trains at 32k; the config asks for far less so RAM stays free.
      const contextSize = Math.max(1024, Math.min(this.config.contextSize, this.model.trainContextSize));
      this.context = await this.model.createContext({ contextSize });

      // chatWrapper defaults to "auto", which reads the template baked into the GGUF.
      this.session = new LlamaChatSession({ contextSequence: this.context.getSequence() });
      this.activeSystemPrompt = "";
      logger.info("gguf.load.done", { contextSize });
    })();

    const loading = this.loading;
    trackAddonWork(loading);
    this.loadWorker = loading;
    try {
      await loading;
    } catch (error) {
      this.loading = null;
      await this.unload();
      throw error;
    } finally {
      if (this.loadWorker === loading) this.loadWorker = null;
    }
    return loading;
  }

  /**
   * Runs a prompt under a controller `quit()` can abort, and keeps the promise tracked
   * so teardown waits for the worker to settle instead of exiting on top of it.
   */
  private async runPrompt(
    session: LlamaChatSession,
    prompt: string,
    options: {
      temperature: number;
      maxTokens: number;
      signal?: AbortSignal;
      stopOnAbortSignal?: boolean;
      onTextChunk?: (text: string) => void;
      onToken?: (tokens: readonly number[]) => void;
    }
  ): Promise<string> {
    const controller = new AbortController();
    this.aborts.add(controller);
    const external = options.signal;
    if (external) {
      if (external.aborted) controller.abort();
      else external.addEventListener("abort", () => controller.abort(), { once: true });
    }

    const { signal: _signal, ...rest } = options;
    const work = trackAddonWork(session.prompt(prompt, { ...rest, signal: controller.signal }));
    try {
      return await work;
    } finally {
      this.aborts.delete(controller);
    }
  }

  /**
   * The session owns the running conversation, so turns stay in the KV cache instead
   * of being re-parsed as text on every prompt.
   */
  private syncSystemPrompt(systemPrompt: string): void {
    if (!this.session || this.activeSystemPrompt === systemPrompt) return;
    const system: ChatSystemMessage = { type: "system", text: systemPrompt };
    this.session.setChatHistory([system]);
    this.activeSystemPrompt = systemPrompt;
  }

  async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    if (!this.session) await this.load();
    const session = this.session;
    if (!session) throw new Error("Model not loaded");

    const systemPrompt = options.systemPrompt ?? "";
    this.syncSystemPrompt(systemPrompt);

    let generated = 0;
    try {
      return await this.runPrompt(session, prompt, {
        temperature: options.temperature ?? 0.7,
        maxTokens: options.maxTokens ?? 2048,
        signal: options.signal,
        onTextChunk: options.onTextChunk,
        onToken: (batch) => {
          generated += batch.length;
        },
      });
    } finally {
      // A stopped turn still produced tokens, and the chat shows a count for it too.
      options.onTokens?.(generated);
    }
  }

  /** Seed the KV cache when the user opens an older conversation. */
  restoreHistory(history: Array<{ role: "user" | "assistant"; content: string }>, systemPrompt: string): void {
    if (!this.session) return;
    const items: ChatHistoryItem[] = [];
    if (systemPrompt) items.push({ type: "system", text: systemPrompt } satisfies ChatSystemMessage);
    for (const turn of history) {
      if (turn.role === "user") items.push({ type: "user", text: turn.content });
      else items.push({ type: "model", response: [turn.content] });
    }
    this.session.setChatHistory(items);
    this.activeSystemPrompt = systemPrompt;
  }

  /** What the loaded weights and the KV cache actually cost right now. */
  memoryUsage(): { ram: number; vram: number } | null {
    if (!this.model) return null;
    return this.model.memoryUsage;
  }

  /**
   * Runs one fixed prompt and reports how fast the tokens came out. The chat
   * history is saved and put back, so a benchmark leaves no trace in a
   * conversation.
   */
  async benchmark(prompt: string, maxTokens: number, signal?: AbortSignal): Promise<BenchmarkMeasurement> {
    if (!this.session) await this.load();
    const session = this.session;
    if (!session) throw new Error("Model not loaded");

    const history = session.getChatHistory();
    let tokens = 0;
    let firstTokenAt: number | null = null;
    let lastTokenAt = Date.now();
    const startedAt = Date.now();

    try {
      await this.runPrompt(session, prompt, {
        temperature: 0,
        maxTokens,
        signal,
        stopOnAbortSignal: true,
        onToken: (batch) => {
          const now = Date.now();
          if (firstTokenAt === null) firstTokenAt = now;
          lastTokenAt = now;
          tokens += batch.length;
        },
      });
    } finally {
      session.setChatHistory(history);
      this.activeSystemPrompt = "";
    }

    const generationMs = lastTokenAt - (firstTokenAt ?? startedAt);
    return {
      provider: "bonsai",
      tokens,
      timeToFirstTokenMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
      generationMs,
      modelBytes: this.model?.size ?? 0,
    };
  }

  /** Drop the running conversation but keep the loaded weights. */
  clearHistory(systemPrompt = ""): void {
    if (!this.session) return;
    this.session.setChatHistory(systemPrompt ? [{ type: "system", text: systemPrompt } satisfies ChatSystemMessage] : []);
    this.activeSystemPrompt = systemPrompt;
  }

  /** Resolves to `false` on a timer that cannot keep the process alive. */
  private giveUpAfter(ms: number): Promise<false> {
    return new Promise<false>((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      timer.unref?.();
    });
  }

  /**
   * Wait for the load worker, which is the one addon call teardown cannot cancel:
   * llama.cpp is already filling tensors on a libuv thread. Exiting while it runs makes
   * the addon complete the worker into a freed JS context and the process aborts, so
   * quit waits this out instead of disposing underneath it.
   */
  private async waitForLoad(): Promise<void> {
    const load = this.loadWorker;
    if (!load) return;
    const startedAt = Date.now();
    const settled = await Promise.race([
      load.then(
        () => true,
        () => true
      ),
      this.giveUpAfter(this.drain.loadMs),
    ]);
    if (!settled) logger.warn("gguf.unload.load.timedOut", { waitedMs: Date.now() - startedAt });
    else logger.info("gguf.unload.load.settled", { waitedMs: Date.now() - startedAt });
  }

  /**
   * Abort and await everything the addon is running, then free the weights. A worker
   * that outlives the Node environment aborts the process, so this is what quit calls.
   */
  async unload(): Promise<void> {
    for (const controller of this.aborts) controller.abort();
    this.aborts.clear();

    const drained = await drainAddonWork(this.drain.abortMs);
    if (!drained) {
      logger.warn("gguf.unload.drain.timedOut", { pending: outstandingAddonWorkers() });
    }

    await this.waitForLoad();

    for (const resource of [this.session, this.context, this.model]) {
      try {
        resource?.dispose();
      } catch {
        /* already disposed */
      }
    }
    this.session = null;
    this.context = null;
    this.model = null;
    this.activeSystemPrompt = "";
    this.loading = null;

    try {
      await this.llama?.dispose();
    } catch {
      /* runtime already stopped */
    }
    this.llama = null;
  }

  /** unload() plus the promise that no later call reloads the weights. */
  async quit(): Promise<void> {
    this.quitting = true;
    await this.unload();
  }
}
