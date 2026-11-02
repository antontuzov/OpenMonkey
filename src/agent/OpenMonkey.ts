import { EventEmitter } from "node:events";
import { ModelManager } from "../models/model-manager";
import { TaskManager } from "./task-manager";
import { LogoManager } from "../ui/logo-manager";
import { detectMood } from "../ui/mood-detector";
import config, { allowedRoots } from "../utils/config";
import storage from "../utils/storage";
import logger from "../utils/logger";
import { buildAttachmentPrompt, MAX_ATTACHMENTS_PER_MESSAGE } from "../utils/attachments";
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
  ModelBenchmark,
  ModelPreference,
  ModelStatus,
  Mood,
  QuickAskResult,
  QuickAskThread,
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

  constructor(modelManager?: ModelManager) {
    super();
    this.modelManager = modelManager ?? new ModelManager();
    this.taskManager = new TaskManager(this);
    this.logoManager = new LogoManager((mood) => this.emit("mood-change", mood));
  }

  async initialize(): Promise<void> {
    this.setStatus({ state: "loading-model" });
    storage.init();
    const savedMood = config.get("ui").currentMood;
    if ((MOODS as string[]).includes(savedMood)) this.setCurrentMood(savedMood as Mood);

    // A locked database has no conversation to open, and creating one would throw.
    if (!storage.locked) {
      const active = storage.latestConversation() ?? storage.createConversation();
      this.activeConversationId = active.id;
      this.conversationHistory = this.historyFor(active.id);
    }

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

  /**
   * Locking or erasing the history is only real if the decrypted turns go with it:
   * they live in this array and in the model's chat context, not just on disk.
   */
  forgetConversation(): void {
    this.stopGeneration();
    this.conversationHistory = [];
    this.activeConversationId = null;
    this.modelManager.restoreConversation([], this.buildSystemPrompt());
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

  /**
   * Clears the turns of a chat but keeps the chat itself. The model forgets the
   * conversation too: an empty context is the only honest starting point.
   */
  clearConversation(id: string): number {
    const conversation = storage.getConversation(id);
    if (!conversation) throw new Error("That conversation no longer exists");
    this.stopGeneration();
    const removed = storage.clearConversationMessages(id);
    if (this.activeConversationId === id) {
      this.conversationHistory = [];
      this.reseedModel();
    }
    return removed;
  }

  /**
   * Summarizes the chat so far with the local model. The summary is returned as a
   * normal answer, so it is saved in the history and can be quoted like any other.
   */
  async summarizeConversation(conversationId: string): Promise<Message | null> {
    if (this.statusInfo.state !== "ready") {
      throw new Error(this.statusInfo.message ?? "OpenMonkey is still loading its model");
    }
    if (this.controller) throw new Error("OpenMonkey is already answering. Stop that reply first.");
    const conversation = storage.getConversation(conversationId);
    if (!conversation) throw new Error("That conversation no longer exists");

    const turns = storage
      .getMessages(conversationId, 60)
      .filter((message) => message.role === "user" || message.role === "assistant")
      .filter((message) => message.content.trim());
    if (!turns.length) throw new Error("There is nothing to summarize yet");

    const transcript = turns
      .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content.trim()}`)
      .join("\n\n")
      .slice(0, 12_000);

    if (this.activeConversationId !== conversationId) this.activateConversation(conversationId);

    const controller = new AbortController();
    this.controller = controller;
    let summary = "";
    try {
      summary = await this.modelManager.generateResponse(
        `Summarize this conversation in a few short bullet points: what was asked, what was decided, and what is still open. Keep every fact the user gave you.\n\n--- conversation ---\n${transcript}\n--- end of conversation ---`,
        {
          systemPrompt: this.buildSystemPrompt(),
          history: undefined,
          temperature: config.get("model").temperature,
          maxTokens: 512,
          signal: controller.signal,
        }
      );
    } finally {
      this.controller = null;
    }

    const text = summary.trim();
    if (!text) throw new Error("The model returned an empty summary");
    const message: Message = {
      id: messageId(),
      role: "assistant",
      content: text,
      timestamp: new Date(),
      metadata: { mood: this.currentMood, taskType: "summary" },
    };
    storage.saveMessage(conversationId, message);
    this.pushHistory({ role: "assistant", content: text });
    return message;
  }

  getMessages(conversationId?: string, limit = 80): Message[] {
    const id = conversationId ?? this.activeConversationId;
    return id ? storage.getMessages(id, limit) : [];
  }

  /**
   * A quick ask is a thread of its own: its own conversation, kept out of the chat
   * list until the user opens it there. A follow-up continues the same thread, so the
   * model keeps the context of the question before it.
   */
  async askQuick(message: string, threadId?: string): Promise<QuickAskResult> {
    const text = message.trim();
    if (!text) throw new Error("Empty message");
    if (this.statusInfo.state !== "ready") {
      throw new Error(this.statusInfo.message ?? "OpenMonkey is still loading its model");
    }
    if (this.controller) throw new Error("OpenMonkey is already answering. Stop that reply first.");

    let thread = threadId ? storage.getQuickAsk(threadId) : null;
    if (threadId && !thread) throw new Error("That quick ask no longer exists");
    if (!thread) {
      const conversation = storage.createConversation(titleFrom(text), "quick");
      thread = storage.createQuickAsk(conversation.id, text);
    }
    // The popover needs the conversation before the first token arrives, otherwise it
    // cannot tell this reply apart from the chat window's.
    this.emit("quick-ask-started", { threadId: thread.id, conversationId: thread.conversationId });

    const reply = await this.processUserMessage(thread.conversationId, text, undefined, "quick");
    if (reply) storage.updateQuickAsk(thread.id, reply.content.slice(0, 400));
    return { threadId: thread.id, conversationId: thread.conversationId, message: reply };
  }

  listQuickAsks(): QuickAskThread[] {
    return storage.listQuickAsks();
  }

  setQuickAskPinned(id: string, pinned: boolean): void {
    storage.setQuickAskPinned(id, pinned);
  }

  /** Removing a quick ask takes its transcript with it; it is not a chat yet. */
  deleteQuickAsk(id: string): void {
    const thread = storage.getQuickAsk(id);
    if (!thread) return;
    const wasActive = this.activeConversationId === thread.conversationId;
    const fallback = storage.deleteConversation(thread.conversationId);
    if (wasActive) this.activateConversation(fallback?.id ?? storage.createConversation().id);
  }

  /**
   * Opening a quick ask in the chat turns its conversation into a normal one, so it
   * joins the chat list and the main window can carry on from there.
   */
  openQuickAskInChat(id: string): string | null {
    const thread = storage.getQuickAsk(id);
    if (!thread) return null;
    storage.promoteConversation(thread.conversationId);
    this.activateConversation(thread.conversationId);
    return thread.conversationId;
  }

  async processUserMessage(
    conversationId: string,
    message: string,
    attachments: Attachment[] = [],
    origin: "main" | "quick" = "main"
  ): Promise<Message | null> {
    if (this.statusInfo.state !== "ready") {
      throw new Error(this.statusInfo.message ?? "OpenMonkey is still loading its model");
    }
    if (this.controller) throw new Error("OpenMonkey is already answering. Stop that reply first.");

    const conversation = storage.getConversation(conversationId);
    if (!conversation) throw new Error("That conversation no longer exists");
    if (this.activeConversationId !== conversationId) this.activateConversation(conversationId);

    const files = attachments.slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
    const display = message.trim() || (files.length ? `Attached ${files.map((file) => file.name).join(", ")}` : "");
    if (!display) throw new Error("Empty message");

    this.detectMood(display);
    const prompt = buildAttachmentPrompt(message.trim(), files);

    const userMessage: Message = {
      id: messageId(),
      role: "user",
      content: display,
      timestamp: new Date(),
      metadata: {
        mood: this.currentMood,
        attachments: files.length
          ? files.map((file) => ({ name: file.name, bytes: file.bytes, kind: file.kind ?? "text" }))
          : undefined,
      },
    };
    storage.saveMessage(conversationId, userMessage, prompt);
    this.pushHistory({ role: "user", content: prompt });

    const retrieval = await this.taskManager.getMemoryManager().contextFor(message);
    const modelPrompt = retrieval ? `${retrieval}\n\n${prompt}` : prompt;
    return await this.generateReply(conversationId, modelPrompt, display, retrieval, origin);
  }

  /** Run the last question again, keeping the answer it replaces as a variant. */
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
    const shown = storage.getLastAssistantMessage(conversationId);
    const variantOf = shown ? shown.metadata?.variantOf ?? shown.id : undefined;

    if (this.activeConversationId !== conversationId) this.activateConversation(conversationId);
    // The answer being replaced stays on disk for the switcher, but the model must not
    // see it twice, so the rebuilt context stops at the question.
    const stored = this.historyFor(conversationId);
    this.conversationHistory =
      stored[stored.length - 1]?.role === "assistant" ? stored.slice(0, -1) : stored;

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
    return await this.generateReply(conversationId, modelPrompt, lastUser.content, retrieval, "main", variantOf);
  }

  /**
   * Rewrite a question that was already sent. The answer and every turn after it are
   * dropped, and the new wording is sent in their place.
   */
  async editAndResend(conversationId: string, messageId: string, message: string): Promise<Message | null> {
    if (this.statusInfo.state !== "ready") {
      throw new Error(this.statusInfo.message ?? "OpenMonkey is still loading its model");
    }
    if (this.controller) throw new Error("OpenMonkey is already answering. Stop that reply first.");
    const conversation = storage.getConversation(conversationId);
    if (!conversation) throw new Error("That conversation no longer exists");
    const target = storage.getMessage(messageId);
    if (!target || target.role !== "user") throw new Error("Only a question you sent can be edited");
    const text = message.trim();
    if (!text) throw new Error("Empty message");

    storage.deleteFromMessage(conversationId, messageId);
    if (this.activeConversationId === conversationId) {
      this.conversationHistory = this.historyFor(conversationId);
      this.reseedModel();
    } else {
      this.activateConversation(conversationId);
    }
    return await this.processUserMessage(conversationId, text);
  }

  /** Everything up to one message, copied into a conversation of its own. */
  branchConversation(conversationId: string, messageId: string, title: string): Conversation | null {
    if (!storage.getConversation(conversationId)) throw new Error("That conversation no longer exists");
    return storage.branchConversationFrom(conversationId, messageId, title);
  }

  listVariants(messageId: string): Message[] {
    return storage.listVariants(messageId);
  }

  /** Show another answer of a group, and let the model continue the chat from it. */
  selectVariant(conversationId: string, messageId: string): void {
    if (this.controller) throw new Error("OpenMonkey is already answering. Stop that reply first.");
    storage.setActiveVariant(messageId);
    if (this.activeConversationId !== conversationId) return;
    this.conversationHistory = this.historyFor(conversationId);
    this.reseedModel();
  }

  private async generateReply(
    conversationId: string,
    prompt: string,
    titleCandidate: string,
    retrieval?: string,
    origin: "main" | "quick" = "main",
    variantOf?: string
  ): Promise<Message | null> {
    if (retrieval) logger.info("memory.context.injected", { conversationId, chars: retrieval.length });
    const systemPrompt = this.buildSystemPrompt();
    const assistantId = messageId();
    const startedAt = Date.now();
    let generatedTokens = 0;
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
        onTokens: (count) => {
          generatedTokens = count;
        },
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
          outcomes.push(await this.taskManager.executeTask(request, conversationId, controller.signal, origin));
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
        metadata: {
          durationMs: Date.now() - startedAt,
          tokens: generatedTokens || undefined,
          mood: this.currentMood,
          variantOf,
        },
      };
      storage.saveMessage(conversationId, message);
      if (this.activeConversationId === conversationId) {
        this.pushHistory({ role: "assistant", content: finalText || "(no text)" });
      }
      if (variantOf) {
        // The group only exists once this row is stored, so the switcher's position in it
        // is read back rather than guessed.
        const stored = storage.listVariants(message.id).find((item) => item.id === message.id);
        if (stored?.metadata) message.metadata = stored.metadata;
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
          metadata: {
            stopped: true,
            durationMs,
            tokens: generatedTokens || undefined,
            mood: this.currentMood,
            variantOf,
          },
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
          metadata: {
            stopped: true,
            durationMs,
            tokens: generatedTokens || undefined,
            mood: this.currentMood,
            variantOf,
          },
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

  async switchProvider(provider: ModelPreference): Promise<void> {
    this.setStatus({ state: "loading-model" });
    try {
      await this.modelManager.switchModel(provider);
      this.modelManager.restoreConversation(this.conversationHistory, this.buildSystemPrompt());
      this.setStatus({ state: "ready", provider: this.modelManager.active ?? undefined });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({ state: "error", message });
      throw error;
    }
  }

  /**
   * Measures the local model so the user can see how fast this Mac is. It takes
   * the same slot as a chat turn: both drive the one loaded session, and Stop
   * aborts whichever is running.
   */
  async benchmarkModel(): Promise<ModelBenchmark> {
    if (this.controller) throw new Error("OpenMonkey is already answering. Stop that reply first.");
    const controller = new AbortController();
    this.controller = controller;
    try {
      return await this.modelManager.benchmark(controller.signal);
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  /** Free the weights after the file is deleted, so nothing claims a loaded model. */
  async releaseModel(): Promise<void> {
    this.stopGeneration();
    await this.modelManager.shutdown();
    this.setStatus({
      state: "error",
      message: "The model was deleted from this Mac. Download it again to keep chatting.",
    });
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
    await this.modelManager.quit();
    storage.close();
    logger.close();
  }
}

export default OpenMonkey;
