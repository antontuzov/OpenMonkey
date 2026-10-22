import { spawn } from "node:child_process";
import * as path from "node:path";
import { allowedRoots } from "../../utils/config";
import type { TaskType } from "../../utils/types";

const TIMEOUT_MS = 60_000;
const MAX_OUTPUT = 8_000;

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
  /** Every shell action is mutating: the model could write a script and run it. */
  readonly mutatingActions: ReadonlySet<string> = new Set(["run_command"]);

  async execute(action: string, args: Record<string, unknown>): Promise<string> {
    if (action !== "run_command") throw new Error(`Unknown shell action: ${action}`);
    return await this.run(String(args.command ?? ""), String(args.cwd ?? allowedRoots()[0]));
  }

  private async run(command: string, cwd: string): Promise<string> {
    if (!command.trim()) throw new Error("Empty command");

    const denied = DENIED.find((pattern) => pattern.test(command));
    if (denied) throw new Error(`Blocked by safety rules: ${denied.source}`);

    const workdir = path.resolve(cwd);
    if (!allowedRoots().some((root) => workdir === root || workdir.startsWith(root + path.sep))) {
      throw new Error(`Working directory ${workdir} is outside the allowed folders`);
    }

    const { stdout, stderr, code } = await this.spawnBounded(command, workdir);
    const output = [stdout, stderr].filter(Boolean).join("\n--- stderr ---\n").trim();
    const clipped = output.length > MAX_OUTPUT ? `${output.slice(0, MAX_OUTPUT)}\n… truncated` : output;

    if (code !== 0) return `Exit code ${code}\n${clipped || "(no output)"}`;
    return clipped || "(command succeeded with no output)";
  }

  private spawnBounded(command: string, cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [], { cwd, shell: true, env: process.env });
      let stdout = "";
      let stderr = "";

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`Command timed out after ${Math.round(TIMEOUT_MS / 1000)}s`));
      }, TIMEOUT_MS);

      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code: code ?? -1 });
      });
    });
  }
}
