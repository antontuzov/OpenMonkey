import { EventEmitter } from "node:events";
import { ModelManager } from "../models/model-manager";
import { TaskManager } from "./task-manager";
import { LogoManager } from "../ui/logo-manager";
import { detectMood } from "../ui/mood-detector";
import config, { allowedRoots } from "../utils/config";
import storage from "../utils/storage";
import logger from "../utils/logger";
import { MOODS } from "../utils/types";
import type {
  AgentStatus,
  Attachment,
  AuditEntry,
  ChatErrorCode,
  ChatEvent,
  Conversation,
  ConversationSearchHit,
  McpServerStatus,
  MemoryFact,
  MemorySnapshot,
  Message,
  ModelStatus,
  Mood,
  Task,
  WorkspaceHit,
  WorkspaceIndexStatus,
} from "../utils/types";
import { describeBuiltInTools } from "./tool-registry";

const HISTORY_TURNS = 10;
const DEFAULT_TITLE = "New chat";
const TOOL_FENCE = "```task";
/** Hold back a short tail so a task fence split across chunks never flashes in the UI. */
const STREAM_TAIL = 8;

const messageId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const titleFrom = (text: string): string => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 48 ? `${line.slice(0, 47)}…` : line || DEFAULT_TITLE;
};

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const classifyError = (message: string): ChatErrorCode => {
  if (/context|too many tokens|sequence length|n_ctx/i.test(message)) return "context-overflow";
  if (/fetch|ECONNREFUSED|server|unreachable|HTTP \d/i.test(message)) return "offline";
  if (/not loaded|loading its model|no local model|not ready/i.test(message)) return "not-ready";
  return "unknown";
};

export class OpenMonkey extends EventEmitter {
  private modelManager: ModelManager;
  private taskManager: TaskManager;
  private logoManager: LogoManager;
  private conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
  private activeConversationId: string | null = null;
  private currentMood: Mood = "neutral";
  private statusInfo: AgentStatus = { state: "starting" };
  private controller: AbortController | null = null;
  private pendingReseed = false;

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

    const active = storage.latestConversation() ?? storage.createConversation();
    this.activeConversationId = active.id;
    this.conversationHistory = this.historyFor(active.id);

    try {
      await this.modelManager.initialize();
      await this.taskManager.initialize();
      this.modelManager.restoreConversation(this.conversationHistory, this.buildSystemPrompt());
      this.setStatus({ state: "ready", provider: this.modelManager.active ?? undefined });
      this.emit("ready");
      if (config.get("memory")?.workspaceSearch) {
        void this.taskManager.getMemoryManager().rebuild();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("agent.init.failed", { error: message });
      this.setStatus({ state: "error", message });
      throw error;
    }
  }

  getActiveConversationId(): string | null {
    return this.activeConversationId;
  }

  getConversations(): Conversation[] {
    return storage.listConversations();
  }

  searchConversations(query: string): ConversationSearchHit[] {
    return storage.searchConversations(query);
  }

  createConversation(): Conversation {
    this.stopGeneration();
    const conversation = storage.createConversation();
    this.activateConversation(conversation.id);
    return conversation;
  }

  /** Loads the stored turns and re-seeds the local session before the first question. */
  switchConversation(conversationId: string): Message[] {
    const conversation = storage.getConversation(conversationId);
    if (!conversation) throw new Error("That conversation no longer exists");
    this.stopGeneration();
    this.activateConversation(conversationId);
    return storage.getMessages(conversationId);
  }

  renameConversation(id: string, title: string): void {
    storage.renameConversation(id, title);
  }

  setConversationPinned(id: string, pinned: boolean): void {
    storage.setConversationPinned(id, pinned);
  }

  deleteConversation(id: string): Conversation | null {
    const wasActive = this.activeConversationId === id;
    if (wasActive) this.stopGeneration();
    const next = storage.deleteConversation(id);
    if (!wasActive) return next;
    const fallback = next ?? storage.createConversation();
    this.activateConversation(fallback.id);
    return fallback;
  }

  getMessages(conversationId?: string, limit = 80): Message[] {
    const id = conversationId ?? this.activeConversationId;
    return id ? storage.getMessages(id, limit) : [];
  }

  async processUserMessage(
    conversationId: string,
    message: string,
    attachment?: Attachment
  ): Promise<Message | null> {
    if (this.statusInfo.state !== "ready") {
      throw new Error(this.statusInfo.message ?? "OpenMonkey is still loading its model");
    }
    if (this.controller) throw new Error("OpenMonkey is already answering. Stop that reply first.");

    const conversation = storage.getConversation(conversationId);
    if (!conversation) throw new Error("That conversation no longer exists");
    if (this.activeConversationId !== conversationId) this.activateConversation(conversationId);

    const display = message.trim() || (attachment ? `Attached ${attachment.name}` : "");
    if (!display) throw new Error("Empty message");

    this.detectMood(display);
    const prompt = attachment
      ? `The user attached a text file named "${attachment.name}" (${formatBytes(attachment.bytes)}). Use it as context.\n\n--- ${attachment.name} ---\n${attachment.text}\n--- end ${attachment.name} ---\n\n${message.trim()}`
      : message.trim();

    const userMessage: Message = {
      id: messageId(),
      role: "user",
      content: display,
      timestamp: new Date(),
      metadata: {
        mood: this.currentMood,
        attachment: attachment ? { name: attachment.name, bytes: attachment.bytes } : undefined,
      },
    };
    storage.saveMessage(conversationId, userMessage, prompt);
    this.pushHistory({ role: "user", content: prompt });

    const retrieval = await this.taskManager.getMemoryManager().contextFor(message);
    const modelPrompt = retrieval ? `${retrieval}\n\n${prompt}` : prompt;
    return await this.generateReply(conversationId, modelPrompt, display, retrieval);
  }

  /** Drop the previous answer and run the last user turn again. */
  async regenerate(conversationId: string): Promise<Message | null> {
    if (this.statusInfo.state !== "ready") {
      throw new Error(this.statusInfo.message ?? "OpenMonkey is still loading its model");
    }
    if (this.controller) throw new Error("OpenMonkey is already answering. Stop that reply first.");
    const conversation = storage.getConversation(conversationId);
    if (!conversation) throw new Error("That conversation no longer exists");
    const lastUser = storage.getLastUserMessage(conversationId);
    if (!lastUser) return null;
    const prompt = storage.getLastUserPrompt(conversationId) ?? lastUser.content;

    if (this.activeConversationId !== conversationId) this.activateConversation(conversationId);
    storage.removeLastAssistantMessage(conversationId);
    this.conversationHistory = this.historyFor(conversationId);

    // The GGUF session already holds the user turn when the history includes it; seed
    // only the turns before it so prompt() adds the question exactly once.
    if (this.modelManager.active === "bonsai") {
      this.modelManager.restoreConversation(
        this.conversationHistory.slice(0, -1),
        this.buildSystemPrompt()
      );
    }

    const retrieval = await this.taskManager.getMemoryManager().contextFor(prompt);
    const modelPrompt = retrieval ? `${retrieval}\n\n${prompt}` : prompt;
    return await this.generateReply(conversationId, modelPrompt, lastUser.content, retrieval);
  }

  private async generateReply(
    conversationId: string,
    prompt: string,
    titleCandidate: string,
    retrieval?: string
  ): Promise<Message | null> {
    if (retrieval) logger.info("memory.context.injected", { conversationId, chars: retrieval.length });
    const systemPrompt = this.buildSystemPrompt();
    const assistantId = messageId();
    const startedAt = Date.now();
    const controller = new AbortController();
    this.controller = controller;

    this.emitChat({
      type: "start",
      conversationId,
      message: { id: assistantId, role: "assistant", content: "", timestamp: new Date() },
    });

    let accumulated = "";
    let pending = "";
    let toolSeen = false;

    const emitToken = (token: string) => {
      if (!token) return;
      this.emitChat({ type: "token", conversationId, messageId: assistantId, token });
    };

    const onTextChunk = (chunk: string) => {
      accumulated += chunk;
      if (toolSeen) return;
      pending += chunk;
      const fence = pending.indexOf(TOOL_FENCE);
      if (fence >= 0) {
        toolSeen = true;
        emitToken(pending.slice(0, fence));
        pending = "";
        return;
      }
      if (pending.length > STREAM_TAIL) {
        const safe = pending.slice(0, pending.length - STREAM_TAIL);
        pending = pending.slice(-STREAM_TAIL);
        emitToken(safe);
      }
    };

    try {
      const response = await this.modelManager.generateResponse(prompt, {
        systemPrompt,
        history: this.modelManager.active === "mlx" ? this.promptHistory() : undefined,
        temperature: config.get("model").temperature,
        maxTokens: config.get("model").maxTokens,
        signal: controller.signal,
        onTextChunk,
      });
      accumulated = response;
      if (!toolSeen) {
        const tail = pending;
        pending = "";
        emitToken(tail);
      }

      const { visibleText, requests, errors } = this.taskManager.parseTaskBlocks(accumulated);
      let finalText = visibleText.trim();

      if (retrieval && (requests.length || errors.length || !finalText)) {
        // The small model often reaches for a file tool even when retrieval already
        // answered the question; show the retrieved passage instead of tool chatter.
        if (requests.length || errors.length) {
          logger.info("memory.tasks.ignored", { conversationId, requests: requests.length, errors: errors.length });
        }
        finalText = this.groundCitations(this.retrievalFallback(retrieval), retrieval);
        this.emitChat({
          type: "replace",
          conversationId,
          messageId: assistantId,
          content: finalText,
        });
      } else if (requests.length || errors.length) {
        const outcomes = [];
        for (const request of requests) {
          outcomes.push(await this.taskManager.executeTask(request, conversationId, controller.signal));
        }
        for (const error of errors) {
          outcomes.push(this.taskManager.recordInvalidRequest(error, conversationId));
        }
        finalText = await this.summarizeTaskOutcomes(outcomes, systemPrompt, visibleText, conversationId);
        if (retrieval) finalText = this.groundCitations(finalText, retrieval);
        this.emitChat({
          type: "replace",
          conversationId,
          messageId: assistantId,
          content: finalText,
        });
      } else if (retrieval) {
        finalText = this.groundCitations(finalText, retrieval);
      }

      const message: Message = {
        id: assistantId,
        role: "assistant",
        content: finalText || "(no text)",
        timestamp: new Date(),
        metadata: { durationMs: Date.now() - startedAt, mood: this.currentMood },
      };
      storage.saveMessage(conversationId, message);
      if (this.activeConversationId === conversationId) {
        this.pushHistory({ role: "assistant", content: finalText || "(no text)" });
      }

      let title: string | undefined;
      const conversation = storage.getConversation(conversationId);
      if (conversation && (conversation.title === DEFAULT_TITLE || !conversation.title)) {
        title = titleFrom(titleCandidate);
        storage.renameConversation(conversationId, title);
      }

      this.emitChat({ type: "done", conversationId, message, title });
      return message;
    } catch (error) {
      const aborted = controller.signal.aborted;
      const visible = this.taskManager.parseTaskBlocks(accumulated).visibleText.trim();
      const durationMs = Date.now() - startedAt;

      if (aborted) {
        const message: Message = {
          id: assistantId,
          role: "assistant",
          content: visible,
          timestamp: new Date(),
          metadata: { stopped: true, durationMs, mood: this.currentMood },
        };
        if (visible) {
          storage.saveMessage(conversationId, message);
          if (this.activeConversationId === conversationId) {
            this.pushHistory({ role: "assistant", content: visible });
          }
        }
        this.emitChat({ type: "stopped", conversationId, message });
        logger.info("chat.stopped", { conversationId, chars: visible.length });
        return visible ? message : null;
      }

      const text = error instanceof Error ? error.message : String(error);
      const code = classifyError(text);
      logger.error("chat.failed", { error: text, code });

      let partial: Message | undefined;
      if (visible) {
        partial = {
          id: assistantId,
          role: "assistant",
          content: visible,
          timestamp: new Date(),
          metadata: { stopped: true, durationMs, mood: this.currentMood },
        };
        storage.saveMessage(conversationId, partial);
        if (this.activeConversationId === conversationId) {
          this.pushHistory({ role: "assistant", content: visible });
        }
      }

      this.emitChat({
        type: "error",
        conversationId,
        messageId: assistantId,
        error: text,
        code,
        message: partial,
      });
      return partial ?? null;
    } finally {
      if (this.controller === controller) {
        this.controller = null;
        if (this.pendingReseed) {
          this.pendingReseed = false;
          this.reseedModel();
        }
      }
    }
  }

  /**
   * The model mislabels citations, so drop its inline tags and pick the retrieved
   * passage that actually contains a distinctive term from its answer.
   */
  private groundCitations(text: string, retrieval: string): string {
    const blocks = [...retrieval.matchAll(/\[file:([^\]]+)\]\n([\s\S]*?)(?=\n\n\[file:|$)/g)].map(
      (match) => ({ label: match[1], excerpt: match[2].toLowerCase() })
    );
    if (!blocks.length) return text;

    const cleaned = text
      .replace(/\[file:[^\]]+\]/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const anchors = [
      ...cleaned.matchAll(/[\w./-]*\d[\w./-]*|"[^"]{4,}"|`[^`]{4,}`/g),
    ]
      .map((match) => match[0].replace(/^["`]|["`]$/g, ""))
      .filter((anchor) => anchor.length >= 4);

    const supporting = blocks.filter((block) =>
      anchors.some((anchor) => block.excerpt.includes(anchor.toLowerCase()))
    );
    const chosen = supporting.length ? supporting : blocks.slice(0, 1);
    const labels = [...new Set(chosen.map((block) => `[file:${block.label}]`))];
    return `${cleaned}\n\nSources: ${labels.join(", ")}`;
  }

  /** Answer from the top retrieved passage when the model spends its turn on a tool call. */
  private retrievalFallback(retrieval: string): string {
    const top = retrieval.match(/\[file:([^\]]+)\]\n([\s\S]*?)(?=\n\n\[file:|$)/);
    if (!top) return "No matching passage was found in your workspace.";
    return `I found this in your workspace:\n\n${top[2].trim()}`;
  }

  /** One short follow-up turn so tool output actually reaches the user as an answer. */
  private async summarizeTaskOutcomes(
    tasks: Array<Pick<Task, "type" | "description" | "status" | "result" | "error">>,
    systemPrompt: string,
    priorText: string,
    conversationId: string
  ): Promise<string> {
    // Search results are already grounded excerpts with citations; a 4B rewrite
    // tends to contradict them, so a pure memory turn answers from the results.
    if (tasks.length && tasks.every((task) => task.type === "memory")) {
      const failed = tasks.find((task) => task.status !== "completed");
      if (failed) return failed.error || "Workspace search did not complete.";
      const answer = tasks
        .map((task) => (task.result ?? "").replace(/\n\nCite as \[file:<path>:<line>\]\.$/, "").trim())
        .filter(Boolean)
        .join("\n\n");
      if (answer) return answer;
    }

    const report = tasks
      .map(
        (task, index) =>
          `${index + 1}. ${task.description} → ${task.status}: ${(task.result ?? task.error ?? "").slice(0, 1200)}`
      )
      .join("\n");
    const question = (storage.getLastUserMessage(conversationId)?.content ?? "").slice(0, 400);

    if (this.modelManager.active === "mlx" && this.activeConversationId === conversationId) {
      this.conversationHistory.push({ role: "assistant", content: priorText });
    }

    try {
      return await this.modelManager.generateResponse(
        `The user asked: ${question || "(see conversation)"}

Tool results (final, not pending):
${report}

Answer the user's question in 1-3 sentences using these results. If a result contains a
[file:...] or [fact:...] label, cite it exactly. Do not repeat the raw report and do not
say the action is still running.`,
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

  private historyFor(conversationId: string): Array<{ role: "user" | "assistant"; content: string }> {
    return storage
      .getMessages(conversationId, HISTORY_TURNS)
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));
  }

  private activateConversation(conversationId: string): void {
    this.activeConversationId = conversationId;
    this.conversationHistory = this.historyFor(conversationId);
    if (this.modelManager.active) {
      this.modelManager.restoreConversation(this.conversationHistory, this.buildSystemPrompt());
    }
  }

  private promptHistory(): Array<{ role: "user" | "assistant"; content: string }> {
    return this.conversationHistory.slice(0, -1).slice(-HISTORY_TURNS);
  }

  private pushHistory(turn: { role: "user" | "assistant"; content: string }): void {
    this.conversationHistory.push(turn);
    if (this.conversationHistory.length > HISTORY_TURNS * 2) {
      this.conversationHistory = this.conversationHistory.slice(-HISTORY_TURNS * 2);
    }
  }

  private emitChat(event: ChatEvent): void {
    this.emit("chat", event);
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
    const memoryConfig = config.get("memory");
    const memoryTools = Boolean(memoryConfig?.enabled && memoryConfig.workspaceSearch);
    const memorySection = this.taskManager.getMemoryManager().promptSection(this.activeConversationId);
    return `You are ${agentConfig.name}, a friendly AI agent that runs locally on the user's machine.

Your characteristics:
- You are privacy-focused and all data stays on the user's device
- You can perform various tasks like file management, web browsing, shell commands, and automation
- You have a dynamic, ${agentConfig.personality} personality
- You are free and open-source
- You provide clear, concise responses, using Markdown when it helps readability
- When performing tasks, you explain what you're doing step by step

Today is ${new Date().toDateString()}.

Tool protocol: when you need to actually do something, finish your reply with one fenced
block per action, exactly like this:
\`\`\`task
{"type":"file","action":"read_file","arguments":{"path":"~/Documents/notes.md"},"summary":"Read the notes"}
\`\`\`
Use one block per action and never invent results - the real output comes back to you.
Arguments are validated before anything runs. If a call fails validation, correct the
arguments on your next turn instead of claiming the task succeeded.

Available actions:
${describeBuiltInTools(memoryTools)}${this.taskManager.getMcpManager().protocolText()}

Workspace folders: ${allowedRoots().join(", ")}.
${memorySection}
${memorySection ? `Use pinned facts and conversation digests only when they are relevant, and cite them
with the labels shown. Never claim a memory you were not given.` : ""}
${memoryTools ? `A "Workspace context" block may be supplied in the user's request. Answer from it directly
and cite each passage as [file:<path>:<line>]; do not run tools on that turn. If no block is
supplied and the question is about local files, search with the task block
{"type":"memory","action":"search_workspace","arguments":{"query":"..."}}. Never invent a citation.` : ""}

Mutating actions (writes, shell commands, calendar changes, mail drafts, MCP calls without a
read-only hint) ask the user for approval first, so say what you are about to do. Never use
draft_mail to claim a mail was sent. Delete uses the macOS Trash, never a permanent erase.

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

  getAuditLog(limit = 100): AuditEntry[] {
    return storage.getAuditLog(limit);
  }

  clearAuditLog(): void {
    storage.clearAuditLog();
  }

  getMcpStatus(): McpServerStatus[] {
    return this.taskManager.getMcpStatus();
  }

  async refreshMcp(): Promise<McpServerStatus[]> {
    await this.taskManager.getMcpManager().refresh();
    this.reseedModel();
    return this.taskManager.getMcpStatus();
  }

  async restartMcpServer(id: string): Promise<McpServerStatus[]> {
    const status = await this.taskManager.restartMcpServer(id);
    this.reseedModel();
    return status;
  }

  getMemorySnapshot(): MemorySnapshot {
    return this.taskManager.getMemoryManager().snapshot(this.activeConversationId);
  }

  addMemoryFact(content: string): MemorySnapshot {
    const fact: MemoryFact = this.taskManager.getMemoryManager().addFact(content);
    logger.info("memory.fact.saved", { id: fact.id });
    this.reseedModel();
    return this.getMemorySnapshot();
  }

  deleteMemoryFact(id: string): MemorySnapshot {
    this.taskManager.getMemoryManager().deleteFact(id);
    this.reseedModel();
    return this.getMemorySnapshot();
  }

  clearMemoryFacts(): MemorySnapshot {
    this.taskManager.getMemoryManager().clearFacts();
    this.reseedModel();
    return this.getMemorySnapshot();
  }

  async rebuildWorkspaceIndex(): Promise<WorkspaceIndexStatus> {
    return await this.taskManager.getMemoryManager().rebuild();
  }

  clearWorkspaceIndex(): WorkspaceIndexStatus {
    return this.taskManager.getMemoryManager().clearIndex();
  }

  async searchWorkspaceMemory(query: string): Promise<WorkspaceHit[]> {
    return await this.taskManager.getMemoryManager().search(query, 6);
  }

  /** Settings changed memory or workspace roots: drop derived data when off, rebuild when asked. */
  refreshMemory(rebuildIndex = false): void {
    const memory = config.get("memory");
    const manager = this.taskManager.getMemoryManager();
    if (!memory?.enabled || !memory.workspaceSearch) manager.clearIndex();
    this.reseedModel();
    if (memory?.enabled && memory.workspaceSearch && (rebuildIndex || manager.status().state === "idle")) {
      void manager.rebuild();
    }
  }

  /** New tool catalogs change the system prompt; only reseed while idle. */
  private reseedModel(): void {
    if (!this.modelManager.active) return;
    if (this.controller) {
      this.pendingReseed = true;
      return;
    }
    this.modelManager.restoreConversation(this.conversationHistory, this.buildSystemPrompt());
  }

  resolveApproval(requestId: string, approved: boolean, remember = false): void {
    this.taskManager.resolveApproval(requestId, approved, remember);
  }

  cancelTask(taskId: string): void {
    this.taskManager.cancelTask(taskId);
  }

  stopGeneration(): void {
    this.controller?.abort();
    this.controller = null;
    this.taskManager.abortActive();
  }

  getStatus(): AgentStatus {
    return this.statusInfo;
  }

  async modelStatus(): Promise<ModelStatus> {
    return await this.modelManager.status();
  }

  private setStatus(status: AgentStatus): void {
    this.statusInfo = status;
    this.emit("status", status);
  }

  async switchProvider(provider: "mlx" | "bonsai"): Promise<void> {
    this.setStatus({ state: "loading-model" });
    try {
      await this.modelManager.switchModel(provider);
      this.modelManager.restoreConversation(this.conversationHistory, this.buildSystemPrompt());
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
      this.modelManager.restoreConversation(this.conversationHistory, this.buildSystemPrompt());
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
