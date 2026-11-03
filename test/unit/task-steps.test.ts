import { test } from "node:test";
import assert from "node:assert/strict";
import { closeLastStep, formatDuration, openStep, stepDuration, taskDuration } from "../../src/utils/task-steps";
import type { TaskStep } from "../../src/utils/types";

test("a stage that is still open counts up to now", () => {
  const step: TaskStep = { label: "running", startedAt: 1_000 };
  assert.equal(stepDuration(step, 1_500), 500);
});

test("a stage that is over keeps the time it took", () => {
  const step: TaskStep = { label: "running", startedAt: 1_000, endedAt: 1_250 };
  assert.equal(stepDuration(step, 9_999), 250);
});

test("closing a stage marks the end and leaves the earlier ones alone", () => {
  const steps = openStep(openStep(undefined, "queued", 100), "approval", 200);
  const closed = closeLastStep(steps, 300)!;
  assert.equal(closed.length, 2);
  assert.equal(closed[0].endedAt, undefined, "the first stage is still open");
  assert.deepEqual(closed[1], { label: "approval", startedAt: 200, endedAt: 300 });
});

test("closing a stage that is already closed changes nothing", () => {
  const steps = closeLastStep(openStep(undefined, "queued", 100), 200)!;
  assert.deepEqual(closeLastStep(steps, 900), steps);
});

test("the whole task is measured from the first stage to the last", () => {
  const steps = closeLastStep(
    openStep(openStep(openStep(undefined, "queued", 100), "approval", 150), "running", 400),
    900
  );
  assert.equal(taskDuration(steps, 1_000), 800);
});

test("a task with no stages has no duration", () => {
  assert.equal(taskDuration(undefined), 0);
  assert.equal(taskDuration([]), 0);
});

test("a duration reads in the unit that fits it", () => {
  assert.equal(formatDuration(120), "120ms");
  assert.equal(formatDuration(1_500), "1.5s");
  assert.equal(formatDuration(12_000), "12.0s");
  assert.equal(formatDuration(65_000), "1m 05s");
  assert.equal(formatDuration(-1), "—");
});
