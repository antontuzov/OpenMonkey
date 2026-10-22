import { EventEmitter } from "node:events";
import { ModelManager } from "../models/model-manager";
import { TaskManager } from "./task-manager";
import { LogoManager } from "../ui/logo-manager";
import { detectMood } from "../ui/mood-detector";
import config from "../utils/config";
import storage from "../utils/storage";
import logger from "../utils/logger";
import { allowedRoots } from "../utils/config";
import { MOODS } from "../utils/types";
import type { AgentStatus, Message, ModelStatus, Mood } from "../utils/types";

const HISTORY_TURNS = 10;

export class OpenMonkey extends EventEmitter {
  private modelManager: ModelManager;
  private taskManager: TaskManager;
  private logoManager: LogoManager;
  private conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
  private currentMood: Mood = "neutral";
  private statusInfo: AgentStatus = { state: "starting" };
  private controller: AbortController | null = null;

  constructor() {
    super();
    this.modelManager = new ModelManager();
    this.taskManager = new TaskManager(this);
    this.logoManager = new LogoManager((mood) => this.emit("mood-change", mood));
  }

  async initialize(): Promise<void> {
    this.setStatus({ state: "loading-model" });
    storage.init();
    const savedMood = config.get("ui").currentMood;
    if ((MOODS as string[]).includes(savedMood)) this.setCurrentMood(savedMood as Mood);
    this.conversationHistory = storage
      .getRecentMessages(HISTORY_TURNS)
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));

    try {
      await this.modelManager.initialize();
      await this.taskManager.initialize();
      this.setStatus({ state: "ready", provider: this.modelManager.active ?? undefined });
      this.emit("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("agent.init.failed", { error: message });
      this.setStatus({ state: "error", message });
      throw error;
    }
  }

  async processUserMessage(message: string): Promise<string> {
    if (this.statusInfo.state !== "ready") {
      throw new Error(this.statusInfo.message ?? "OpenMonkey is still loading its model");
    }

    this.detectMood(message);
    const systemPrompt = this.buildSystemPrompt();
    this.remember({ role: "user", content: message });

    this.controller = new AbortController();
    const response = await this.modelManager.generateResponse(message, {
      systemPrompt,
      history: this.modelManager.active === "mlx" ? this.promptHistory() : undefined,
      temperature: config.get("model").temperature,
      maxTokens: config.get("model").maxTokens,
      signal: this.controller.signal,
    });

    const { visibleText, requests } = this.taskManager.parseTaskBlocks(response);
    let finalText = visibleText;

    if (requests.length) {
      const outcomes = [];
      for (const request of requests) {
        outcomes.push(await this.taskManager.executeTask(request));
      }
      finalText = await this.summarizeTaskOutcomes(outcomes, systemPrompt, visibleText);
    }

    this.controller = null;
    const answer = finalText || "(no text)";
    this.remember({ role: "assistant", content: answer });
    this.emit("response", answer);
    return answer;
  }

  /** One short follow-up turn so tool output actually reaches the user as an answer. */
  private async summarizeTaskOutcomes(
    tasks: Array<{ description: string; status: string; result?: string; error?: string }>,
    systemPrompt: string,
    priorText: string
  ): Promise<string> {
    const report = tasks
      .map((task, index) => `${index + 1}. ${task.description} → ${task.status}: ${(task.result ?? task.error ?? "").slice(0, 1200)}`)
      .join("\n");

    if (this.modelManager.active === "mlx") {
      this.conversationHistory.push({ role: "assistant", content: priorText });
    }

    try {
      return await this.modelManager.generateResponse(
        `Tool results:\n${report}\nTell me what happened in 1-3 sentences. Do not repeat this JSON-like text.`,
        {
          systemPrompt,
          history: this.modelManager.active === "mlx" ? this.promptHistory() : undefined,
          temperature: config.get("model").temperature,
          maxTokens: 512,
          signal: this.controller?.signal,
        }
      );
    } catch (error) {
      logger.warn("agent.summary.failed", { error });
      return [priorText, report].filter(Boolean).join("\n\n");
    }
  }

  private promptHistory(): Array<{ role: "user" | "assistant"; content: string }> {
    return this.conversationHistory.slice(0, -1).slice(-HISTORY_TURNS);
  }

  private remember(turn: { role: "user" | "assistant"; content: string }): void {
    this.conversationHistory.push(turn);
    if (this.conversationHistory.length > HISTORY_TURNS * 2) {
      this.conversationHistory = this.conversationHistory.slice(-HISTORY_TURNS * 2);
    }
    storage.saveMessage({
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: turn.role,
      content: turn.content,
      timestamp: new Date(),
      metadata: { mood: this.currentMood },
    });
  }

  private detectMood(message: string): void {
    const mood = detectMood(message);
    if (mood === this.currentMood) return;
    this.setCurrentMood(mood);
  }

  private rememberMood(): void {
    config.merge({ ui: { ...config.get("ui"), currentMood: this.currentMood } });
  }

  private buildSystemPrompt(): string {
    const agentConfig = config.get("agent");
    return `You are ${agentConfig.name}, a friendly AI agent that runs locally on the user's machine.

Your characteristics:
- You are privacy-focused and all data stays on the user's device
- You can perform various tasks like file management, web browsing, shell commands, and automation
- You have a dynamic personality that changes based on the user's mood (currently: ${this.currentMood})
- You are free and open-source
- You provide clear, concise responses
- When performing tasks, you explain what you're doing step by step

Today is ${new Date().toDateString()}.

Tool protocol: when you need to actually do something, finish your reply with one fenced
block per action, exactly like this:
\`\`\`task
{"type":"file","action":"read_file","arguments":{"path":"~/Documents/notes.md"},"summary":"Read the notes"}
\`\`\`
Use one block per action and never invent results - the real output comes back to you.

Allowed actions:
- type "file": list_dir, read_file, write_file, append_file, move_file, copy_file, create_folder, find_files
  (only inside: ${allowedRoots().join(", ")})
- type "web": fetch_page {url}, search {query}, open_in_browser {url}
- type "shell": run_command {command, cwd}
- type "calendar": list_events {days}, create_event {summary, start, end}
- type "email": list_mail {count}, draft_mail {to, subject, body}

Mutating actions (writes, shell commands, calendar changes, mail drafts) ask the user for
approval first, so say what you are about to do. Never use draft_mail to claim a mail was sent.

Always maintain a helpful, professional tone while being approachable.`;
  }

  setCurrentMood(mood: Mood): void {
    this.currentMood = mood;
    this.logoManager.setMood(mood);
    this.rememberMood();
  }

  cycleMood(): Mood {
    const mood = this.logoManager.cycleMood();
    this.currentMood = mood;
    this.rememberMood();
    return mood;
  }

  getCurrentMood(): Mood {
    return this.currentMood;
  }

  getLogoManager(): LogoManager {
    return this.logoManager;
  }

  getTaskManager(): TaskManager {
    return this.taskManager;
  }

  resolveApproval(requestId: string, approved: boolean): void {
    this.taskManager.resolveApproval(requestId, approved);
  }

  stopGeneration(): void {
    this.controller?.abort();
    this.controller = null;
  }

  getStatus(): AgentStatus {
    return this.statusInfo;
  }

  async modelStatus(): Promise<ModelStatus> {
    return await this.modelManager.status();
  }

  /** Oldest-first, so the renderer can append straight away. */
  getMessages(limit = 80): Message[] {
    return storage.getRecentMessages(limit);
  }

  private setStatus(status: AgentStatus): void {
    this.statusInfo = status;
    this.emit("status", status);
  }

  newConversation(): void {
    this.conversationHistory = [];
    this.modelManager.resetConversation(this.buildSystemPrompt());
  }

  async switchProvider(provider: "mlx" | "bonsai"): Promise<void> {
    this.setStatus({ state: "loading-model" });
    try {
      await this.modelManager.switchModel(provider);
      this.setStatus({ state: "ready", provider });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({ state: "error", message });
      throw error;
    }
  }

  /** Load weights that appeared after startup, e.g. once an in-app download finishes. */
  async reloadModel(): Promise<void> {
    if (this.modelManager.active) {
      this.setStatus({ state: "ready", provider: this.modelManager.active });
      return;
    }
    this.setStatus({ state: "loading-model" });
    try {
      await this.modelManager.initialize();
      this.setStatus({ state: "ready", provider: this.modelManager.active ?? undefined });
      this.emit("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({ state: "error", message });
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.stopGeneration();
    await this.taskManager.shutdown();
    await this.modelManager.shutdown();
    storage.close();
    logger.close();
  }
}

export default OpenMonkey;
