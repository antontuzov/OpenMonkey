import * as fs from "node:fs";
import { MLXServer } from "./mlx-server";
import { BonsaiGGUF, type GenerateOptions } from "./bonsai-gguf";
import { BENCHMARK_MAX_TOKENS, BENCHMARK_PROMPT, toBenchmark } from "./benchmark";
import { estimateModelMemory } from "./model-inspector";
import config, { ggufPath, mlxModelPath } from "../utils/config";
import logger from "../utils/logger";
import type {
  ModelBenchmark,
  ModelMemoryEstimate,
  ModelPreference,
  ModelProvider,
  ModelStatus,
} from "../utils/types";

export type { ModelProvider, ModelStatus };

const CONTEXT_SIZE = 4096;

/** A short prompt that warms the weights up so the first real answer is fast. */
const WARMUP_PROMPT = "Say hello.";

export class ModelManager {
  private mlxServer: MLXServer;
  private bonsaiModel: BonsaiGGUF;
  private currentModel: ModelProvider | null = null;
  private warmedUp = false;
  private memory: ModelMemoryEstimate | null = null;
  private lastBenchmark: ModelBenchmark | null = null;

  constructor() {
    this.mlxServer = new MLXServer({
      modelPath: mlxModelPath(),
      port: 8080,
      host: "127.0.0.1",
    });

    this.bonsaiModel = new BonsaiGGUF({
      modelPath: ggufPath(),
      contextSize: CONTEXT_SIZE,
    });
  }

  get active(): ModelProvider | null {
    return this.currentModel;
  }

  async initialize(): Promise<void> {
    if (this.currentModel) return;
    const preference = this.preference;
    const mlxReady = await this.checkMLXAvailability();
    const bonsaiReady = fs.existsSync(ggufPath());

    if (preference === "mlx" && mlxReady) await this.useMlx();
    else if (preference === "bonsai" && bonsaiReady) await this.useBonsai();
    else if (mlxReady) await this.useMlx();
    else if (bonsaiReady) await this.useBonsai();
    else {
      throw new Error(
        `No local model found. Download one with: npm run download-models (expected ${ggufPath()})`
      );
    }

    // Warm up before declaring the model ready: the first real answer should not
    // pay for the cold kernels, and the UI needs to know whether it did.
    await this.warmUp();
  }

  /** What the user asked for in Settings → Model. */
  get preference(): ModelPreference {
    return config.get("model").provider;
  }

  async generateResponse(prompt: string, options?: GenerateOptions & {
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  }): Promise<string> {
    if (this.currentModel === "mlx" && (await this.mlxServer.isRunning())) {
      return await this.mlxServer.generate(prompt, options);
    }
    if (this.currentModel === "bonsai") {
      return await this.bonsaiModel.generate(prompt, options);
    }
    throw new Error(`No model loaded (active provider: ${this.currentModel ?? "none"})`);
  }

  /** Called when the user starts a new chat so the GGUF KV cache does not carry over. */
  resetConversation(systemPrompt: string): void {
    this.bonsaiModel.clearHistory(systemPrompt);
  }

  /** Re-seed the local session when an existing conversation is opened. */
  restoreConversation(
    history: Array<{ role: "user" | "assistant"; content: string }>,
    systemPrompt: string
  ): void {
    this.bonsaiModel.restoreHistory(history, systemPrompt);
  }

  async switchModel(preference: ModelPreference): Promise<void> {
    const target = await this.resolveBackend(preference);
    if (target === this.currentModel) {
      config.set("model", { ...config.get("model"), provider: preference });
      return;
    }

    if (target === "mlx") {
      await this.bonsaiModel.unload();
      await this.useMlx();
    } else {
      await this.mlxServer.stop();
      await this.useBonsai();
    }

    config.set("model", { ...config.get("model"), provider: preference });
    await this.warmUp();
    logger.info("model.switched", { provider: target, preference });
  }

  /** Turns the preference into a backend that exists on this machine. */
  private async resolveBackend(preference: ModelPreference): Promise<ModelProvider> {
    if (preference === "mlx") {
      if (!(await this.checkMLXAvailability())) throw new Error("MLX is not available on this machine");
      return "mlx";
    }
    if (preference === "bonsai") {
      if (!fs.existsSync(ggufPath())) throw new Error(`Bonsai model missing at ${ggufPath()}`);
      return "bonsai";
    }
    if (await this.checkMLXAvailability()) return "mlx";
    if (fs.existsSync(ggufPath())) return "bonsai";
    throw new Error("No local model is installed on this Mac yet");
  }

  private async useMlx(): Promise<void> {
    await this.mlxServer.start();
    this.currentModel = "mlx";
    this.warmedUp = false;
    logger.info("mlx.server.started", { port: this.mlxServer.port });
  }

  private async useBonsai(): Promise<void> {
    await this.bonsaiModel.load();
    this.currentModel = "bonsai";
    this.warmedUp = false;
    await this.memoryEstimate();
    logger.info("bonsai.loaded", { path: ggufPath() });
  }

  /**
   * What the weights and one 4096-token context will cost. Only the GGUF header is
   * read, so the UI can show this before the model is ever loaded.
   */
  async memoryEstimate(): Promise<ModelMemoryEstimate | null> {
    if (this.memory === null && fs.existsSync(ggufPath())) {
      this.memory = await estimateModelMemory(ggufPath(), CONTEXT_SIZE);
    }
    return this.memory;
  }

  /** MLX needs Apple Silicon, a working mlx_lm install, and a downloaded snapshot. */
  private async checkMLXAvailability(): Promise<boolean> {
    if (process.platform !== "darwin" || process.arch !== "arm64") return false;
    if (!fs.existsSync(mlxModelPath())) return false;
    return await MLXServer.hasMlxLm();
  }

  /**
   * Runs the weights once so the first answer does not pay for the cold start.
   * A failure here is not fatal: the model still answers, just a little slower.
   */
  async warmUp(): Promise<void> {
    if (this.warmedUp || !this.currentModel) return;
    try {
      await this.generateResponse(WARMUP_PROMPT, { maxTokens: 16, temperature: 0 });
      this.warmedUp = true;
      logger.info("model.warmup.done", { provider: this.currentModel });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("model.warmup.failed", { error: message });
    }
  }

  /** Measures the local model and reports how fast it answers. */
  async benchmark(signal?: AbortSignal): Promise<ModelBenchmark> {
    if (!this.currentModel) throw new Error("No model is loaded, so there is nothing to measure");
    const measurement =
      this.currentModel === "mlx"
        ? await this.mlxServer.benchmark(BENCHMARK_PROMPT, BENCHMARK_MAX_TOKENS, signal)
        : await this.bonsaiModel.benchmark(BENCHMARK_PROMPT, BENCHMARK_MAX_TOKENS, signal);
    const result = toBenchmark(measurement);
    this.lastBenchmark = result;
    // A benchmark generates real tokens, so the cold-start penalty is paid here.
    this.warmedUp = true;
    logger.info("model.benchmark", {
      provider: result.provider,
      tokens: result.tokens,
      tokensPerSecond: Math.round(result.tokensPerSecond * 10) / 10,
    });
    return result;
  }

  async status(): Promise<ModelStatus> {
    return {
      provider: this.currentModel,
      preference: this.preference,
      mlxAvailable: await this.checkMLXAvailability(),
      bonsaiAvailable: fs.existsSync(ggufPath()),
      warmedUp: this.warmedUp,
      memory: await this.memoryEstimate(),
      lastBenchmark: this.lastBenchmark,
    };
  }

  /** Frees the weights but keeps the manager usable, e.g. after the model is deleted. */
  async shutdown(): Promise<void> {
    await this.mlxServer.stop();
    await this.bonsaiModel.unload();
    this.currentModel = null;
    this.warmedUp = false;
    this.memory = null;
    this.lastBenchmark = null;
  }

  /** App teardown: nothing may start another load behind us. */
  async quit(): Promise<void> {
    await this.mlxServer.stop();
    await this.bonsaiModel.quit();
    this.currentModel = null;
    this.warmedUp = false;
    this.memory = null;
    this.lastBenchmark = null;
  }
}

export default ModelManager;
