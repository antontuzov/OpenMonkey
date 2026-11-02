import type { ModelBenchmark, ModelProvider } from "../utils/types";

/** A prompt that makes the model write a known amount of text and nothing else. */
export const BENCHMARK_PROMPT =
  "Write exactly one short paragraph about how a local language model answers. Do not use a list.";

export const BENCHMARK_MAX_TOKENS = 96;

/** The raw timings a backend reports for one run. */
export interface BenchmarkMeasurement {
  provider: ModelProvider;
  tokens: number;
  /** Wall-clock ms from the request to the first generated token. */
  timeToFirstTokenMs: number | null;
  /** Wall-clock ms spent generating the tokens. */
  generationMs: number;
  modelBytes: number;
}

/**
 * Generation speed, measured from the first token to the last one. The prompt
 * itself is not counted: prefill and answer speed are different numbers.
 */
export function tokensPerSecond(measurement: BenchmarkMeasurement): number {
  if (measurement.generationMs <= 0 || measurement.tokens <= 0) return 0;
  return (measurement.tokens * 1000) / measurement.generationMs;
}

export function toBenchmark(measurement: BenchmarkMeasurement): ModelBenchmark {
  return {
    provider: measurement.provider,
    tokens: measurement.tokens,
    tokensPerSecond: tokensPerSecond(measurement),
    timeToFirstTokenMs: measurement.timeToFirstTokenMs,
    generationMs: measurement.generationMs,
    prompt: BENCHMARK_PROMPT,
    modelBytes: measurement.modelBytes,
    ranAt: Date.now(),
  };
}

export function formatMilliseconds(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}
