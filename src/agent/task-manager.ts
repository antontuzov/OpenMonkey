import type { OpenMonkey } from "./OpenMonkey";
import { FileSystemTools } from "./tools/file-system";
import { WebBrowserTools } from "./tools/web-browser";
import { ShellTools } from "./tools/shell-commands";
import { CalendarEmailTools } from "./tools/calendar-email";
import { PublishTools } from "./tools/publish";
import { McpManager } from "./mcp-manager";
import { MemoryManager } from "./memory-manager";
import { buildPreview } from "./previews";
import { diffCounts, lineDiff } from "../utils/diff";
import { closeLastStep, openStep } from "../utils/task-steps";
import {
  getToolDefinition,
  toolKey,
  validateToolArguments,
  type ToolDefinition,
} from "./tool-registry";
import { emojiFor } from "../ui/task-emojis";
import { parseTaskBlocks as parseFences } from "./task-fence";
import type { ToolContext } from "./tools/context";
import config from "../utils/config";
import storage from "../utils/storage";
import logger from "../utils/logger";
import type {
  ApprovalPolicy,
  ApprovalRequest,
  AuditDecision,
  AuditEntry,
  FileWrite,
  McpServerStatus,
  Task,
  TaskRequest,
  TaskStepLabel,
  TaskType,
  ToolPreview,
} from "../utils/types";

const TOOL_TYPES = new Set<TaskType>([
  "file",
  "web",
  "shell",
  "calendar",
  "email",
  "mcp",
  "memory",
  "publish",
]);

interface ExecutableTool {
  execute(action: string, args: Record<string, unknown>, context?: ToolContext): Promise<string>;
}

interface ApprovalResolution {
  approved: boolean;
  remember: boolean;
  cancelled?: boolean;
}

export class TaskManager {
  private agent: OpenMonkey;
  private fileSystem = new FileSystemTools();
  private webBrowser = new WebBrowserTools();
  private shell = new ShellTools();
  private calendarEmail = new CalendarEmailTools();
  private publisher = new PublishTools();
  private mcp = new McpManager();
  private memory = new MemoryManager();
  private activeTasks = new Map<string, Task>();
  private pendingApprovals = new Map<string, { taskId: string; resolve: (resolution: ApprovalResolution) => void }>();
  private sessionDecisions = new Map<string, boolean>();
  private running = new Map<string, AbortController>();
  private audits = new Map<string, AuditEntry>();

  constructor(agent: OpenMonkey) {
    this.agent = agent;
  }

  async initialize(): Promise<void> {
    for (const task of storage.getTasks(20).filter((t) => t.status === "running" || t.status === "awaiting-approval")) {
      const interrupted: Task = {
        ...task,
        status: "failed",
        error: "Interrupted by app restart",
        completedAt: new Date(),
        steps: closeLastStep(task.steps),
      };
      storage.saveTask(interrupted);
      this.activeTasks.set(task.id, interrupted);
    }
    await this.mcp.initialize();
    logger.info("tasks.initialized", { restored: this.activeTasks.size });
  }

  getMcpManager(): McpManager {
    return this.mcp;
  }

  getMemoryManager(): MemoryManager {
    return this.memory;
  }

  getMcpStatus(): McpServerStatus[] {
    return this.mcp.status();
  }

  async restartMcpServer(id: string): Promise<McpServerStatus[]> {
    return await this.mcp.restart(id);
  }

  /** Pull the ```task blocks out of a model reply; the rest is what the user sees. */
  parseTaskBlocks(response: string): { visibleText: string; requests: TaskRequest[]; errors: string[] } {
    const parsed = parseFences(response);
    if (parsed.repaired) logger.warn("tasks.fence.repaired", { blocks: parsed.repaired });
    return parsed;
  }

  private toolFor(type: TaskType): ExecutableTool | null {
    switch (type) {
      case "file":
        return this.fileSystem;
      case "web":
        return this.webBrowser;
      case "shell":
        return this.shell;
      case "calendar":
      case "email":
        return this.calendarEmail;
      case "publish":
        return this.publisher;
      case "memory":
        return this.memory;
      default:
        return null;
    }
  }

  private approvalPolicy(type: TaskType): ApprovalPolicy {
    const policies = config.get("agent").approvalPolicies;
    return policies?.[type as keyof typeof policies] ?? "ask";
  }

  async executeTask(
    request: TaskRequest,
    conversationId: string | null = null,
    externalSignal?: AbortSignal,
    origin: "main" | "quick" = "main"
  ): Promise<Task> {
    const task: Task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      type: request.type,
      description: request.summary,
      status: "pending",
      createdAt: new Date(),
      emoji: emojiFor(request.type),
      steps: [{ label: "queued", startedAt: Date.now() }],
    };
    this.activeTasks.set(task.id, task);
    this.publish(task);
    // Updates replace the map entry, so callers must read the latest task.
    const latest = () => this.activeTasks.get(task.id) ?? task;

    if (!TOOL_TYPES.has(request.type)) {
      this.finish(task, "completed", "No tool required - OpenMonkey answered this directly");
      return latest();
    }

    if (request.type === "shell") {
      task.command = String(request.arguments.command ?? "");
      task.cwd = String(request.arguments.cwd ?? "");
    }

    const validated = await this.validateAndNormalize(request);
    if ("error" in validated) {
      const message = `Tool validation failed: ${validated.error}`;
      this.finish(task, "failed", message);
      this.recordAudit(task, conversationId, request, {}, "invalid", "failed", message);
      return latest();
    }

    const definition = validated.definition;
    const args = validated.arguments;
    request.mutating = definition ? definition.mutating : !this.mcp.isReadOnly(request.action);

    // The request is sound, so the wait for the app is over; the next step is
    // either the decision or the work itself.
    this.closeStep(task.id);

    if (request.type === "shell") {
      task.command = String(args.command ?? "");
      task.cwd = String(args.cwd ?? "");
    }

    let decision: AuditDecision = request.mutating ? "approved" : "read-only";
    if (request.mutating) {
      const authorization = await this.authorize(task, request, args, origin);
      if (!authorization.approved) {
        const cancelled = Boolean(authorization.cancelled);
        const message = cancelled
          ? "Cancelled by you"
          : authorization.decision === "blocked"
            ? "Blocked by your approval policy in Settings → Approvals"
            : "You declined this action";
        this.finish(task, cancelled ? "cancelled" : "denied", message);
        this.recordAudit(
          task,
          conversationId,
          request,
          args,
          authorization.decision,
          cancelled ? "cancelled" : "denied",
          message
        );
        return latest();
      }
      decision = authorization.decision;
    } else {
      // Read-only calls never prompt, but Block still means block.
      const toolPolicy = request.type === "mcp" ? this.mcp.policyFor(request.action) : null;
      const globalBlock =
        !config.get("agent").autoExecuteTasks && this.approvalPolicy(request.type) === "block";
      if (toolPolicy === "block" || globalBlock) {
        const message = "Blocked by your approval policy in Settings → Approvals";
        this.finish(task, "denied", message);
        this.recordAudit(task, conversationId, request, args, "blocked", "denied", message);
        return latest();
      }
    }

    this.recordAudit(task, conversationId, request, args, decision, "pending");

    const controller = new AbortController();
    this.running.set(task.id, controller);
    const forwardAbort = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener("abort", forwardAbort, { once: true });
    this.finish(task, "running");
    this.openStep(task.id, "running");

    if (controller.signal.aborted) {
      this.finish(task, "cancelled", "Cancelled by you");
      this.updateAudit(task.id, "cancelled", "Cancelled by you");
      externalSignal?.removeEventListener("abort", forwardAbort);
      this.running.delete(task.id);
      return latest();
    }

    const tool = this.toolFor(request.type);
    const timeoutMs = definition?.timeoutMs ?? 65_000;
    let timedOut = false;

    let live = "";
    let lastPublish = 0;
    let publishTimer: NodeJS.Timeout | null = null;

    const flushOutput = () => {
      publishTimer = null;
      lastPublish = Date.now();
      this.patch(task.id, { output: live.slice(-20_000) }, false);
    };
    const onOutput = (chunk: string) => {
      live = `${live}${chunk}`.slice(-20_000);
      if (Date.now() - lastPublish > 120) flushOutput();
      else if (!publishTimer) publishTimer = setTimeout(flushOutput, 120);
    };

    const onWrite = (write: FileWrite) => {
      const lines = lineDiff(write.before, write.after);
      if (!lines) return;
      const { added, removed } = diffCounts(lines);
      this.patch(task.id, { diff: { path: write.path, added, removed, lines } });
    };

    const context: ToolContext = { signal: controller.signal, onOutput, onWrite };

    try {
      let result: string;
      const onTimeout = () => {
        timedOut = true;
        controller.abort();
      };
      if (request.type === "mcp") {
        result = (
          await this.withTimeout(this.mcp.call(request.action, args, controller.signal), timeoutMs, onTimeout)
        ).text;
      } else if (tool) {
        result = await this.withTimeout(tool.execute(request.action, args, context), timeoutMs, onTimeout);
      } else {
        result = "No tool required";
      }

      if (publishTimer) clearTimeout(publishTimer);
      this.finish(task, "completed", result);
      this.updateAudit(task.id, "completed", result);
    } catch (error) {
      if (publishTimer) clearTimeout(publishTimer);
      const cancelled = controller.signal.aborted && !timedOut;
      const message = error instanceof Error ? error.message : "Unknown error";
      if (cancelled) {
        const partial = live.trim() || "Cancelled by you";
        this.finish(task, "cancelled", partial);
        this.updateAudit(task.id, "cancelled", partial);
      } else {
        logger.error("task.failed", { type: request.type, action: request.action, error: message });
        this.finish(task, "failed", message);
        this.updateAudit(task.id, "failed", message);
      }
    } finally {
      externalSignal?.removeEventListener("abort", forwardAbort);
      this.running.delete(task.id);
      if (publishTimer) clearTimeout(publishTimer);
    }

    return latest();
  }

  private async validateAndNormalize(
    request: TaskRequest
  ): Promise<{ definition?: ToolDefinition; arguments: Record<string, unknown> } | { error: string }> {
    if (request.type === "mcp") {
      const error = this.mcp.validate(request.action, request.arguments);
      if (error) return { error };
      return { arguments: request.arguments };
    }

    const definition = getToolDefinition(request.type, request.action);
    if (!definition) {
      return { error: `unknown tool action "${toolKey(request.type, request.action)}"` };
    }
    const validation = validateToolArguments(definition, request.arguments);
    if ("error" in validation) return { error: validation.error };
    return { definition, arguments: validation.arguments };
  }

  private async authorize(
    task: Task,
    request: TaskRequest,
    args: Record<string, unknown>,
    origin: "main" | "quick"
  ): Promise<{ approved: boolean; decision: AuditDecision; cancelled?: boolean }> {
    // A rule set for one server or one tool is a choice about that item, so it
    // holds even when the master switch would wave everything through.
    if (request.type === "mcp" && this.mcp.policyFor(request.action) === "block") {
      return { approved: false, decision: "blocked" };
    }
    if (config.get("agent").autoExecuteTasks) return { approved: true, decision: "auto" };

    const policy = this.approvalPolicy(request.type);
    if (policy === "block") return { approved: false, decision: "blocked" };

    if (request.type === "mcp" && this.mcp.policyFor(request.action) === "allow") {
      return { approved: true, decision: "policy" };
    }
    if (policy === "allow") return { approved: true, decision: "policy" };

    const key = toolKey(request.type, request.action);
    const remembered = this.sessionDecisions.get(key);
    if (remembered !== undefined) return { approved: remembered, decision: "session" };

    const preview = await buildPreview(request, args, {
      fetchPage: async (url) => {
        const page = await this.webBrowser.readPage(url);
        return { title: page.title, text: page.text };
      },
    });
    const resolution = await this.requestApproval(task.id, request, preview, policy, origin);
    if (resolution.remember) this.sessionDecisions.set(key, resolution.approved);
    return {
      approved: resolution.approved,
      decision: resolution.cancelled ? "cancelled" : resolution.approved ? "approved" : "denied",
      cancelled: resolution.cancelled,
    };
  }

  /** The UI owns the decision: resolve when the user clicks Allow or Deny. */
  private requestApproval(
    taskId: string,
    request: TaskRequest,
    preview: ToolPreview,
    policy: ApprovalPolicy,
    origin: "main" | "quick"
  ): Promise<ApprovalResolution> {
    this.openStep(taskId, "approval");
    this.patch(taskId, { status: "awaiting-approval" });
    return new Promise<ApprovalResolution>((resolve) => {
      const requestId = `approval_${taskId}`;
      this.pendingApprovals.set(requestId, { taskId, resolve });
      const payload: ApprovalRequest = { requestId, taskId, request, preview, policy, origin };
      this.agent.emit("approval-request", payload);
    });
  }

  resolveApproval(requestId: string, approved: boolean, remember = false): void {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return;
    logger.info("approval.resolved", { requestId, approved, remember });
    this.pendingApprovals.delete(requestId);
    this.closeStep(pending.taskId);
    // The answer may have come from the notification rather than from a window, so
    // every surface that is showing the dialog has to be told the wait is over.
    this.agent.emit("approval-resolved", { requestId });
    pending.resolve({ approved, remember });
  }

  cancelTask(taskId: string): void {
    const requestId = `approval_${taskId}`;
    const pending = this.pendingApprovals.get(requestId);
    if (pending) {
      logger.info("approval.cancelled", { taskId });
      this.pendingApprovals.delete(requestId);
      this.closeStep(taskId);
      this.agent.emit("approval-resolved", { requestId });
      pending.resolve({ approved: false, remember: false, cancelled: true });
    }
    this.running.get(taskId)?.abort();
  }

  /** Run a task again from what it asked the first time. */
  async retryTask(taskId: string): Promise<Task | null> {
    const audit = storage.getAudit(taskId);
    if (!audit) return null;
    const request: TaskRequest = {
      type: audit.type,
      action: audit.action,
      arguments: audit.arguments,
      summary: audit.summary,
      mutating: true,
    };
    return await this.executeTask(request, audit.conversationId);
  }

  /** Stop pressed: close approvals and abort running work so nothing outlives the reply. */
  abortActive(): void {
    for (const pending of this.pendingApprovals.values()) {
      this.closeStep(pending.taskId);
      pending.resolve({ approved: false, remember: false });
    }
    this.pendingApprovals.clear();
    for (const controller of this.running.values()) controller.abort();
  }

  recordInvalidRequest(error: string, conversationId: string | null): Task {
    const task: Task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      type: "automation",
      description: "Invalid tool request",
      status: "failed",
      createdAt: new Date(),
      completedAt: new Date(),
      error,
      emoji: "⚠️",
    };
    this.activeTasks.set(task.id, task);
    this.publish(task);
    storage.saveTask(task);
    storage.saveAudit({
      id: `audit_${task.id}`,
      taskId: task.id,
      conversationId,
      type: "automation",
      action: "invalid",
      summary: "Invalid tool request",
      arguments: {},
      decision: "invalid",
      status: "failed",
      error,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
    });
    logger.warn("task.invalid", { error });
    return task;
  }

  private recordAudit(
    task: Task,
    conversationId: string | null,
    request: TaskRequest,
    args: Record<string, unknown>,
    decision: AuditDecision,
    status: Task["status"],
    detail?: string
  ): AuditEntry {
    const terminal = status === "failed" || status === "denied" || status === "cancelled" || status === "completed";
    const entry: AuditEntry = {
      id: `audit_${task.id}`,
      taskId: task.id,
      conversationId,
      type: request.type,
      action: request.action,
      summary: request.summary,
      arguments: args,
      decision,
      status,
      error: terminal && status !== "completed" ? detail : undefined,
      result: terminal && status === "completed" ? detail : undefined,
      createdAt: new Date(),
      completedAt: terminal ? new Date() : undefined,
    };
    this.audits.set(task.id, entry);
    storage.saveAudit(entry);
    return entry;
  }

  private updateAudit(taskId: string, status: Task["status"], detail?: string): void {
    const entry = this.audits.get(taskId);
    if (!entry) return;
    entry.status = status;
    entry.completedAt = new Date();
    if (status === "completed") entry.result = detail;
    else if (status === "cancelled") entry.result = detail;
    else entry.error = detail;
    storage.saveAudit(entry);
    this.audits.delete(entry.taskId);
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        onTimeout?.();
        reject(new Error(`Tool timed out after ${Math.round(ms / 1000)}s`));
      }, ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  /** Start the next stage of the timeline, so the monitor can time each one. */
  private openStep(taskId: string, label: TaskStepLabel): void {
    const current = this.activeTasks.get(taskId);
    this.patch(taskId, { steps: openStep(current?.steps, label) });
  }

  /** Close the stage that is still open, if there is one. */
  private closeStep(taskId: string): void {
    const current = this.activeTasks.get(taskId);
    const steps = closeLastStep(current?.steps);
    if (!steps || steps === current?.steps) return;
    this.patch(taskId, { steps });
  }

  private finish(task: Task, status: Task["status"], resultOrError?: string): void {
    const completed = status === "completed" || status === "failed" || status === "denied" || status === "cancelled";
    if (completed) this.closeStep(task.id);
    this.patch(
      task.id,
      {
        status,
        result: status === "completed" || status === "cancelled" ? resultOrError : task.result,
        error: status !== "completed" && status !== "cancelled" ? resultOrError : task.error,
        completedAt: completed ? new Date() : task.completedAt,
      },
      completed
    );
  }

  private patch(id: string, changes: Partial<Task>, persist = true): void {
    const current = this.activeTasks.get(id);
    if (!current) return;
    const updated = { ...current, ...changes };
    this.activeTasks.set(id, updated);
    if (persist) storage.saveTask(updated);
    this.publish(updated);
  }

  private publish(task: Task): void {
    this.agent.emit("task-update", task);
  }

  getActiveTasks(): Array<Task> {
    return [...this.activeTasks.values()];
  }

  async shutdown(): Promise<void> {
    for (const pending of this.pendingApprovals.values()) pending.resolve({ approved: false, remember: false });
    this.pendingApprovals.clear();
    for (const controller of this.running.values()) controller.abort();
    this.running.clear();
    this.activeTasks.clear();
    await this.mcp.shutdown();
  }
}

export default TaskManager;
