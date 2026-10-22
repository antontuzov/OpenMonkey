import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import { allowedRoots } from "../../utils/config";
import type { TaskType } from "../../utils/types";
import type { ToolContext } from "./context";
import { resolveInWorkspace } from "./paths";

const TIMEOUT_MS = 60_000;
const MAX_OUTPUT = 60_000;
const MAX_RESULT = 8_000;

/** Commands no approval click should ever run. */
const DENIED: RegExp[] = [
  /\brm\s+(-[a-z]*[rf][a-z]*\s+)+(\/|~|\$HOME)(\s|$)/i,
  /\bsudo\b/i,
  /\bmkfs\b/i,
  /\bdd\b.*\bof=\/dev\//i,
  /\bdiskutil\s+erase/i,
  /\b(shutdown|reboot|halt)\b/i,
  /:\(\)\s*\{.*\};\s*:/i,
  /\bcurl\b.*\|\s*(ba)?sh\b/i,
  /\bchmod\s+(-R\s+)?[0-7]+\s+\/(\s|$)/i,
];

export class ShellTools {
  readonly type: TaskType = "shell";

  async execute(action: string, args: Record<string, unknown>, context?: ToolContext): Promise<string> {
    if (action !== "run_command") throw new Error(`Unknown shell action: ${action}`);
    return await this.run(
      String(args.command ?? ""),
      String(args.cwd ?? allowedRoots()[0]),
      context
    );
  }

  private async run(command: string, cwd: string, context?: ToolContext): Promise<string> {
    if (!command.trim()) throw new Error("Empty command");

    const denied = DENIED.find((pattern) => pattern.test(command));
    if (denied) throw new Error(`Blocked by safety rules: ${denied.source}`);

    const workdir = await resolveInWorkspace(cwd);
    const stat = await fs.stat(workdir);
    if (!stat.isDirectory()) throw new Error(`${workdir} is not a folder`);

    if (context?.signal.aborted) throw new Error("Command cancelled by you");

    const { stdout, stderr, code, cancelled } = await this.spawnBounded(command, workdir, context);
    const output = [stdout, stderr].filter(Boolean).join("\n--- stderr ---\n").trim();
    const clipped = output.length > MAX_RESULT ? `${output.slice(0, MAX_RESULT)}\n… truncated` : output;

    if (cancelled) throw new Error(`Command cancelled by you${clipped ? `\n${clipped}` : ""}`);
    if (code !== 0) return `Exit code ${code}\n${clipped || "(no output)"}`;
    return clipped || "(command succeeded with no output)";
  }

  private spawnBounded(
    command: string,
    cwd: string,
    context?: ToolContext
  ): Promise<{ stdout: string; stderr: string; code: number; cancelled: boolean }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [], { cwd, shell: true, env: process.env });
      let stdout = "";
      let stderr = "";
      let cancelled = false;
      let timedOut = false;

      const forward = (stream: "out" | "err", chunk: Buffer) => {
        const text = chunk.toString();
        const current = stdout.length + stderr.length;
        if (current < MAX_OUTPUT) {
          const remaining = MAX_OUTPUT - current;
          const slice = text.slice(0, remaining);
          if (stream === "out") stdout += slice;
          else stderr += slice;
          context?.onOutput?.(slice);
          if (text.length > remaining) context?.onOutput?.("\n… output truncated");
        }
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      }, TIMEOUT_MS);

      const onAbort = () => {
        cancelled = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      };
      context?.signal.addEventListener("abort", onAbort, { once: true });

      child.stdout.on("data", (chunk: Buffer) => forward("out", chunk));
      child.stderr.on("data", (chunk: Buffer) => forward("err", chunk));
      child.on("error", (error) => {
        clearTimeout(timer);
        context?.signal.removeEventListener("abort", onAbort);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        context?.signal.removeEventListener("abort", onAbort);
        if (timedOut) {
          reject(new Error(`Command timed out after ${Math.round(TIMEOUT_MS / 1000)}s`));
          return;
        }
        resolve({ stdout, stderr, code: code ?? -1, cancelled });
      });
    });
  }
}
