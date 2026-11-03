import type { FileWrite } from "../../utils/types";

/** Passed by TaskManager into a tool so long-running work can be cancelled and streamed. */
export interface ToolContext {
  signal: AbortSignal;
  onOutput?: (chunk: string) => void;
  /** Called after a tool writes a file, so the caller can show what changed. */
  onWrite?: (write: FileWrite) => void;
}
