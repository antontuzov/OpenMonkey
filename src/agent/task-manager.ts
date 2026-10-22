import type { OpenMonkey } from "./OpenMonkey";
import { FileSystemTools } from "./tools/file-system";
import { WebBrowserTools } from "./tools/web-browser";
import { ShellTools } from "./tools/shell-commands";
import { CalendarEmailTools } from "./tools/calendar-email";
import { emojiFor, detectTaskType } from "../ui/task-emojis";
import config from "../utils/config";
import storage from "../utils/storage";
import logger from "../utils/logger";
import type { ApprovalRequest, Task, TaskRequest, TaskType } from "../utils/types";

type Tool = { type: TaskType; mutatingActions: ReadonlySet<string>; execute(action: string, args: Record<string, unknown>): Promise<string> };

const TASK_BLOCK = /```task\s*([\s\S]*?)```/g;

export class TaskManager {
  private agent: OpenMonkey;
  private fileSystem = new FileSystemTools();
  private webBrowser = new WebBrowserTools();
  private shell = new ShellTools();
  private calendarEmail = new CalendarEmailTools();
  private activeTasks = new Map<string, Task>();
  private pendingApprovals = new Map<string, (approved: boolean) => void>();

  constructor(agent: OpenMonkey) {
    this.agent = agent;
  }

  async initialize(): Promise<void> {
    for (const task of storage.getTasks(20).filter((t) => t.status === "running" || t.status === "awaiting-approval")) {
      this.activeTasks.set(task.id, { ...task, status: "failed", error: "Interrupted by app restart" });
    }
    logger.info("tasks.initialized", { restored: this.activeTasks.size });
  }

  /** Pull the ```task blocks out of a model reply; the rest is what the user sees. */
  parseTaskBlocks(response: string): { visibleText: string; requests: TaskRequest[] } {
    const requests: TaskRequest[] = [];
    const visibleText = response.replace(TASK_BLOCK, (_match, body: string) => {
      const request = this.parseOne(String(body).trim());
      if (request) requests.push(request);
      return "";
    });
    return { visibleText: visibleText.trim(), requests };
  }

  private parseOne(body: string): TaskRequest | null {
    try {
      const parsed = JSON.parse(body) as Partial<TaskRequest>;
      if (!parsed || typeof parsed.action !== "string") return null;
      const type = (parsed.type ?? detectTaskType(parsed.summary ?? "")) as TaskType;
      return {
        type,
        action: parsed.action,
        arguments: (parsed.arguments ?? {}) as Record<string, unknown>,
        summary: parsed.summary ?? `${type}.${parsed.action}`,
        mutating: this.isMutating(type, parsed.action),
      };
    } catch {
      return null;
    }
  }

  private isMutating(type: TaskType, action: string): boolean {
    if (type === "shell") return true;
    const tool = this.toolFor(type);
    return tool ? tool.mutatingActions.has(action) : true;
  }

  private toolFor(type: TaskType): Tool | null {
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
      default:
        return null;
    }
  }

  async executeTask(request: TaskRequest): Promise<Task> {
    const task: Task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      type: request.type,
      description: request.summary,
      status: "pending",
      createdAt: new Date(),
      emoji: emojiFor(request.type),
    };
    this.activeTasks.set(task.id, task);
    this.publish(task);

    const tool = this.toolFor(request.type);
    if (!tool) {
      this.finish(task, "completed", "No tool required - OpenMonkey answered this directly");
      return task;
    }

    if (request.mutating && !config.get("agent").autoExecuteTasks) {
      const approved = await this.requestApproval(task.id, request);
      if (!approved) {
        this.finish(task, "denied", "You declined this action");
        return task;
      }
    }

    this.finish(task, "running");
    try {
      const result = await tool.execute(request.action, request.arguments);
      this.finish(task, "completed", result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error("task.failed", { type: request.type, action: request.action, error: message });
      this.finish(task, "failed", message);
    }
    return task;
  }

  /** The UI owns the decision: resolve when the user clicks Allow or Deny. */
  private requestApproval(taskId: string, request: TaskRequest): Promise<boolean> {
    this.patch(taskId, { status: "awaiting-approval" });
    return new Promise<boolean>((resolve) => {
      const requestId = `approval_${taskId}`;
      this.pendingApprovals.set(requestId, resolve);
      this.agent.emit("approval-request", { requestId, taskId, request } satisfies ApprovalRequest);
    });
  }

  resolveApproval(requestId: string, approved: boolean): void {
    const resolve = this.pendingApprovals.get(requestId);
    if (!resolve) return;
    this.pendingApprovals.delete(requestId);
    resolve(approved);
  }

  private finish(task: Task, status: Task["status"], resultOrError?: string): void {
    const completed = status === "completed" || status === "failed" || status === "denied";
    this.patch(task.id, {
      status,
      result: status === "completed" ? resultOrError : task.result,
      error: status !== "completed" ? resultOrError : task.error,
      completedAt: completed ? new Date() : task.completedAt,
    });
  }

  private patch(id: string, changes: Partial<Task>): void {
    const current = this.activeTasks.get(id);
    if (!current) return;
    const updated = { ...current, ...changes };
    this.activeTasks.set(id, updated);
    storage.saveTask(updated);
    this.publish(updated);
  }

  private publish(task: Task): void {
    this.agent.emit("task-update", task);
  }

  getActiveTasks(): Array<Task> {
    return [...this.activeTasks.values()];
  }

  async shutdown(): Promise<void> {
    for (const [, resolve] of this.pendingApprovals) resolve(false);
    this.pendingApprovals.clear();
    this.activeTasks.clear();
  }
}

export default TaskManager;
