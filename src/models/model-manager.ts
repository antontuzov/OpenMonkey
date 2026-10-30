import * as fs from "node:fs";
import { MLXServer } from "./mlx-server";
import { BonsaiGGUF, type GenerateOptions } from "./bonsai-gguf";
import config, { ggufPath, mlxModelPath } from "../utils/config";
import logger from "../utils/logger";
import type { ModelProvider, ModelStatus } from "../utils/types";

export type { ModelProvider, ModelStatus };

export class ModelManager {
  private mlxServer: MLXServer;
  private bonsaiModel: BonsaiGGUF;
  private currentModel: ModelProvider | null = null;

  constructor() {
    this.mlxServer = new MLXServer({
      modelPath: mlxModelPath(),
      port: 8080,
      host: "127.0.0.1",
    });

    this.bonsaiModel = new BonsaiGGUF({
      modelPath: ggufPath(),
      contextSize: 4096,
    });
  }

  get active(): ModelProvider | null {
    return this.currentModel;
  }

  async initialize(): Promise<void> {
    if (this.currentModel) return;
    const preferred = config.get("model").provider;
    const mlxReady = await this.checkMLXAvailability();
    const bonsaiReady = fs.existsSync(ggufPath());

    if (preferred === "mlx" && mlxReady) await this.useMlx();
    else if (preferred === "bonsai" && bonsaiReady) await this.useBonsai();
    else if (mlxReady) await this.useMlx();
    else if (bonsaiReady) await this.useBonsai();
    else {
      throw new Error(
        `No local model found. Download one with: npm run download-models (expected ${ggufPath()})`
      );
    }
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

  async switchModel(model: ModelProvider): Promise<void> {
    if (model === this.currentModel) return;

    if (model === "mlx") {
      if (!(await this.checkMLXAvailability())) throw new Error("MLX is not available on this machine");
      await this.bonsaiModel.unload();
      await this.useMlx();
    } else {
      if (!fs.existsSync(ggufPath())) throw new Error(`Bonsai model missing at ${ggufPath()}`);
      await this.mlxServer.stop();
      await this.useBonsai();
    }

    config.set("model", { ...config.get("model"), provider: model });
    logger.info("model.switched", { provider: model });
  }

  private async useMlx(): Promise<void> {
    await this.mlxServer.start();
    this.currentModel = "mlx";
    logger.info("mlx.server.started", { port: this.mlxServer.port });
  }

  private async useBonsai(): Promise<void> {
    await this.bonsaiModel.load();
    this.currentModel = "bonsai";
    logger.info("bonsai.loaded", { path: ggufPath() });
  }

  /** MLX needs Apple Silicon, a working mlx_lm install, and a downloaded snapshot. */
  private async checkMLXAvailability(): Promise<boolean> {
    if (process.platform !== "darwin" || process.arch !== "arm64") return false;
    if (!fs.existsSync(mlxModelPath())) return false;
    return await MLXServer.hasMlxLm();
  }

  async status(): Promise<ModelStatus> {
    return {
      provider: this.currentModel,
      mlxAvailable: await this.checkMLXAvailability(),
      bonsaiAvailable: fs.existsSync(ggufPath()),
    };
  }

  async shutdown(): Promise<void> {
    await this.mlxServer.stop();
    await this.bonsaiModel.unload();
    this.currentModel = null;
  }
}

export default ModelManager;
