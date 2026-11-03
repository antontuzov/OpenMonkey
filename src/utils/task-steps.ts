import type { TaskStep, TaskStepLabel } from "./types";

/** The steps of a task, with the last one closed off. */
export function closeLastStep(steps: TaskStep[] | undefined, at = Date.now()): TaskStep[] | undefined {
  if (!steps?.length) return steps;
  const last = steps[steps.length - 1];
  if (last.endedAt !== undefined) return steps;
  return [...steps.slice(0, -1), { ...last, endedAt: at }];
}

/** The steps of a task, with one more stage started. */
export function openStep(steps: TaskStep[] | undefined, label: TaskStepLabel, at = Date.now()): TaskStep[] {
  return [...(steps ?? []), { label, startedAt: at }];
}

/** How long a step took. A step still running counts up to now. */
export function stepDuration(step: TaskStep, now = Date.now()): number {
  return Math.max(0, (step.endedAt ?? now) - step.startedAt);
}

/** How long the whole task took, from the first step to the last. */
export function taskDuration(steps: TaskStep[] | undefined, now = Date.now()): number {
  if (!steps?.length) return 0;
  const first = steps[0].startedAt;
  const last = steps[steps.length - 1];
  return Math.max(0, (last.endedAt ?? now) - first);
}

/** A duration as it reads on screen: "0.4s", "12s", "1m 05s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
