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
}

type LlamaCppModule = typeof import("node-llama-cpp");

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

  constructor(config: BonsaiConfig) {
    this.config = config;
  }

  get isLoaded(): boolean {
    return this.session != null;
  }

  async load(): Promise<void> {
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

    try {
      await this.loading;
    } catch (error) {
      this.loading = null;
      await this.unload();
      throw error;
    }

    return this.loading;
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

    return await session.prompt(prompt, {
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 2048,
      signal: options.signal,
      onTextChunk: options.onTextChunk,
    });
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

  /** Drop the running conversation but keep the loaded weights. */
  clearHistory(systemPrompt = ""): void {
    if (!this.session) return;
    this.session.setChatHistory(systemPrompt ? [{ type: "system", text: systemPrompt } satisfies ChatSystemMessage] : []);
    this.activeSystemPrompt = systemPrompt;
  }

  async unload(): Promise<void> {
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

    try {
      await this.llama?.dispose();
    } catch {
      /* runtime already stopped */
    }
    this.llama = null;
    this.loading = null;
  }
}
