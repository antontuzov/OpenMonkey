/**
 * Everything the llama.cpp addon runs on a libuv thread is registered here, because
 * teardown has to wait for all of it: a worker still outstanding when Node frees its
 * environment gets completed into a dead JS context, and the addon's answer to that is
 * `abort()` — the user sees a crash report instead of a quit.
 *
 * The GGUF loader and the header inspector are both callers, so the set is shared
 * rather than owned by whichever one was fixed last.
 */
const inFlight = new Set<Promise<unknown>>();

/** Registers an addon call so quit can wait for it. The entry removes itself. */
export function trackAddonWork<T>(worker: Promise<T>): Promise<T> {
  inFlight.add(worker);
  void worker.catch(() => undefined).finally(() => inFlight.delete(worker));
  return worker;
}

export function outstandingAddonWorkers(): number {
  return inFlight.size;
}

/** Waits for the addon's outstanding work; resolves to false once the budget runs out. */
export async function drainAddonWork(ms: number): Promise<boolean> {
  if (!inFlight.size) return true;
  const settled = Promise.allSettled([...inFlight]).then(() => true);
  if (ms <= 0) return await settled;
  const timer = new Promise<false>((resolve) => {
    const handle = setTimeout(() => resolve(false), ms);
    handle.unref?.();
  });
  return await Promise.race([settled, timer]);
}
