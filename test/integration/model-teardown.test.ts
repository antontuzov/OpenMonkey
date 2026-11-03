import { test } from "node:test";
import assert from "node:assert/strict";
import { BonsaiGGUF } from "../../src/models/bonsai-gguf";
import { outstandingAddonWorkers, trackAddonWork } from "../../src/models/addon-work";

/**
 * The teardown contract, tested without weights: llama.cpp runs a load on a libuv
 * thread that nothing can cancel, and freeing the Node environment under it aborts the
 * process with SIGABRT. quit has to wait for that worker even when the drain of
 * abortable work gives up first.
 */
type TeardownInternals = {
  loadWorker: Promise<void> | null;
};

const CONFIG = { modelPath: "/nonexistent/Bonsai-4B.gguf", contextSize: 1024 };

const internalsOf = (gguf: BonsaiGGUF): TeardownInternals => gguf as unknown as TeardownInternals;

/** A worker that finishes on its own schedule, as a real load does. */
function pendingWorker(ms: number, fail = false): Promise<void> {
  const worker = new Promise<void>((resolve, reject) =>
    setTimeout(() => (fail ? reject(new Error("llama could not map the file")) : resolve()), ms)
  );
  worker.catch(() => undefined);
  return worker;
}

test("quit waits for a model load it cannot cancel", async () => {
  const gguf = new BonsaiGGUF(CONFIG, { abortMs: 20, loadMs: 5_000 });
  const internals = internalsOf(gguf);
  const worker = pendingWorker(160);
  internals.loadWorker = worker;
  trackAddonWork(worker);

  const startedAt = Date.now();
  await gguf.unload();
  const waitedMs = Date.now() - startedAt;

  assert.ok(waitedMs >= 150, `teardown freed the weights after ${waitedMs} ms, mid-load`);
  assert.equal(outstandingAddonWorkers(), 0);
});

test("a load that fails is still drained instead of taking quit down", async () => {
  const gguf = new BonsaiGGUF(CONFIG, { abortMs: 20, loadMs: 5_000 });
  internalsOf(gguf).loadWorker = pendingWorker(80, true);

  let quitResolved = false;
  await gguf.quit().then(() => (quitResolved = true));
  assert.ok(quitResolved, "quit must swallow a failed load, not reject the whole shutdown");
});

test("the load wait is bounded so a hung worker cannot wedge shutdown", async () => {
  const gguf = new BonsaiGGUF(CONFIG, { abortMs: 20, loadMs: 120 });
  const internals = internalsOf(gguf);
  let resolveWorker: () => void = () => undefined;
  internals.loadWorker = new Promise<void>((resolve) => (resolveWorker = resolve));

  const startedAt = Date.now();
  await gguf.quit();
  const gaveUpAfterMs = Date.now() - startedAt;

  assert.ok(gaveUpAfterMs < 500, `quit hung for ${gaveUpAfterMs} ms on a load that never settled`);
  resolveWorker();
});

test("quitting closes the door on a later load", async () => {
  const gguf = new BonsaiGGUF(CONFIG, { abortMs: 20, loadMs: 1_000 });
  await gguf.quit();

  await assert.rejects(() => gguf.load(), /app is closing/);
});
