import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BENCHMARK_MAX_TOKENS,
  BENCHMARK_PROMPT,
  formatBytes,
  formatMilliseconds,
  toBenchmark,
  tokensPerSecond,
  type BenchmarkMeasurement,
} from "../../src/models/benchmark";

const measurement = (overrides: Partial<BenchmarkMeasurement> = {}): BenchmarkMeasurement => ({
  provider: "bonsai",
  tokens: 96,
  timeToFirstTokenMs: 420,
  generationMs: 4_800,
  modelBytes: 572_270_624,
  ...overrides,
});

test("tokens per second is measured from the first token to the last one", () => {
  assert.equal(tokensPerSecond(measurement({ tokens: 96, generationMs: 4_800 })), 20);
  assert.equal(tokensPerSecond(measurement({ tokens: 12, generationMs: 1_000 })), 12);
});

test("the prefill wait never counts towards generation speed", () => {
  // 40 s to read the prompt, 1 s to write 10 tokens.
  const slowPrefill = measurement({ tokens: 10, generationMs: 1_000, timeToFirstTokenMs: 40_000 });
  assert.equal(tokensPerSecond(slowPrefill), 10);
});

test("a run with no time or no tokens reports zero instead of Infinity", () => {
  assert.equal(tokensPerSecond(measurement({ generationMs: 0 })), 0);
  assert.equal(tokensPerSecond(measurement({ generationMs: -5 })), 0);
  assert.equal(tokensPerSecond(measurement({ tokens: 0 })), 0);
});

test("a benchmark record carries the prompt it ran, so two runs are comparable", () => {
  const before = Date.now();
  const result = toBenchmark(measurement());
  assert.equal(result.prompt, BENCHMARK_PROMPT);
  assert.equal(result.provider, "bonsai");
  assert.equal(result.tokens, 96);
  assert.equal(result.tokensPerSecond, 20);
  assert.equal(result.timeToFirstTokenMs, 420);
  assert.equal(result.modelBytes, 572_270_624);
  assert.ok(result.ranAt >= before && result.ranAt <= Date.now() + 1_000);
});

test("the benchmark prompt asks for one paragraph and a bounded number of tokens", () => {
  assert.match(BENCHMARK_PROMPT, /one short paragraph/i);
  assert.doesNotMatch(BENCHMARK_PROMPT, /code|json/i);
  assert.equal(BENCHMARK_MAX_TOKENS, 96);
});

test("durations read as milliseconds under a second and seconds above it", () => {
  assert.equal(formatMilliseconds(null), "—");
  assert.equal(formatMilliseconds(0), "0 ms");
  assert.equal(formatMilliseconds(999), "999 ms");
  assert.equal(formatMilliseconds(1_000), "1.00 s");
  assert.equal(formatMilliseconds(4_837), "4.84 s");
});

test("model sizes are shown in MB up to a gigabyte, then GB", () => {
  assert.equal(formatBytes(0), "0 MB");
  assert.equal(formatBytes(1_500_000), "2 MB");
  assert.equal(formatBytes(572_270_624), "572 MB");
  assert.equal(formatBytes(1_000_000_000), "1.00 GB");
  assert.equal(formatBytes(2_500_000_000), "2.50 GB");
});
