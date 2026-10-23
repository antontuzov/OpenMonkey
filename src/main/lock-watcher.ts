import { powerMonitor } from "electron";
import config from "../utils/config";
import storage from "../utils/storage";
import logger from "../utils/logger";

const POLL_MS = 20_000;

/**
 * Idle and sleep locking. Only a passphrase profile has something to lock: without
 * one the key belongs to the macOS login session, so the toggle stays inert.
 */
export function startLockWatcher(onLock: () => void): void {
  const armed = () => config.get("privacy").autoLockMinutes > 0 && storage.lockable && !storage.locked;

  const timer = setInterval(() => {
    if (!armed()) return;
    if (powerMonitor.getSystemIdleTime() < config.get("privacy").autoLockMinutes * 60) return;
    logger.info("history.auto.locked", { reason: "idle" });
    onLock();
  }, POLL_MS);
  timer.unref();

  const onSleep = () => {
    if (!armed()) return;
    logger.info("history.auto.locked", { reason: "sleep" });
    onLock();
  };
  powerMonitor.on("suspend", onSleep);
  powerMonitor.on("lock-screen", onSleep);
}
