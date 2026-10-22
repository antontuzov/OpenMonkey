/** Passed by TaskManager into a tool so long-running work can be cancelled and streamed. */
export interface ToolContext {
  signal: AbortSignal;
  onOutput?: (chunk: string) => void;
}
