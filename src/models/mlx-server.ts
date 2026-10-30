import { spawn, type ChildProcess } from "node:child_process";
import * as net from "node:net";
import logger from "../utils/logger";
import type { GenerateOptions } from "./bonsai-gguf";

export interface MLXServerConfig {
  modelPath: string;
  port: number;
  host: string;
  /** Max ms to wait for the Python server to answer /v1/models. */
  startupTimeoutMs?: number;
}

const DEFAULT_SYSTEM_PROMPT = "You are OpenMonkey, a helpful AI agent.";

export class MLXServer {
  private config: MLXServerConfig;
  private process: ChildProcess | null = null;
  private started = false;

  constructor(config: MLXServerConfig) {
    this.config = config;
  }

  private get baseUrl(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }

  get port(): number {
    return this.config.port;
  }

  /** Whether the Python side of the MLX stack is importable in this environment. */
  static async hasMlxLm(): Promise<boolean> {
    return await new Promise((resolve) => {
      const child = spawn("python3", ["-c", "import mlx_lm"], { stdio: ["ignore", "ignore", "ignore"] });
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
    });
  }

  async start(): Promise<void> {
    if (await this.isRunning()) return;

    const port = await this.freePort(this.config.port);
    if (port !== this.config.port) {
      logger.warn("mlx.port.in_use", { requested: this.config.port, using: port });
      this.config.port = port;
    }

    this.process = spawn(
      "python3",
      ["-m", "mlx_lm.server", "--model", this.config.modelPath, "--port", String(port), "--host", this.config.host],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    this.process.stdout?.on("data", (chunk: Buffer) => logger.debug("mlx.server.stdout", { text: chunk.toString().trim() }));
    this.process.stderr?.on("data", (chunk: Buffer) => logger.debug("mlx.server.stderr", { text: chunk.toString().trim() }));
    this.process.on("exit", (code) => {
      logger.info("mlx.server.exit", { code });
      this.started = false;
      this.process = null;
    });
    this.process.on("error", (error: NodeJS.ErrnoException) => {
      this.started = false;
      if (error.code === "ENOENT") {
        logger.error("mlx.python.missing", { error: error.message });
      }
    });

    await this.waitForReady(this.config.startupTimeoutMs ?? 90_000);
    this.started = true;
  }

  /** mlx_lm.server does not bind until the model is loaded, so poll rather than sleep. */
  private async waitForReady(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.process?.exitCode != null) {
        throw new Error(
          `MLX server exited early (code ${this.process.exitCode}). Install it with: python3 -m pip install mlx-lm`
        );
      }
      if (await this.isRunning()) return;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await this.stop();
    throw new Error(`MLX server did not become ready within ${Math.round(timeoutMs / 1000)}s`);
  }

  async generate(prompt: string, options: GenerateOptions & {
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  } = {}): Promise<string> {
    const messages = [
      { role: "system", content: options.systemPrompt || DEFAULT_SYSTEM_PROMPT },
      ...(options.history ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
      { role: "user", content: prompt },
    ];

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mlx-model",
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2048,
        stream: true,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`MLX server returned HTTP ${response.status}: ${await response.text()}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream") || !response.body) {
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("MLX server returned no completion");
      options.onTextChunk?.(content);
      return content;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let finished = false;

    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            content += delta;
            options.onTextChunk?.(delta);
          }
          if (parsed.choices?.[0]?.finish_reason) finished = true;
        } catch {
          // A partial SSE frame can arrive between reads; the next chunk completes it.
        }
      }
    }

    if (!content) throw new Error("MLX server returned no completion");
    return content;
  }

  async isRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, { signal: AbortSignal.timeout(1500) });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** True only while this instance owns a live child process. */
  get owned(): boolean {
    return this.started && this.process != null && this.process.exitCode == null;
  }

  async stop(): Promise<void> {
    const child = this.process;
    this.process = null;
    this.started = false;
    if (!child || child.exitCode != null) return;

    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 3000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private freePort(port: number): Promise<number> {
    return new Promise((resolve) => {
      const probe = net.createServer();
      probe.once("error", () => resolve(port + 1));
      probe.once("listening", () => probe.close(() => resolve(port)));
      probe.listen(port, this.config.host);
    });
  }
}
