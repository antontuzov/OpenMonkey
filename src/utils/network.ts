import { config } from "./config";
import logger from "./logger";

/**
 * One switch for every request the app makes on its own: model downloads and page
 * fetches. Loopback to the local MLX server is not an internet request, so it stays
 * outside the switch, and links handed to the user's browser are their action, not
 * the app's.
 */
export const NETWORK_OFF_MESSAGE = "Network access is off in Settings → Privacy → Diagnostics";

// Counted in memory for this process only: the privacy page wants to answer "what has
// this app done since I opened it", and the log already carries the dated history.
let allowed = 0;
let blocked = 0;

export function networkAllowed(): boolean {
  return config.get("privacy").networkAllowed !== false;
}

export function assertNetworkAllowed(reason: string): void {
  if (networkAllowed()) {
    allowed += 1;
    return;
  }
  blocked += 1;
  logger.info("network.blocked", { reason });
  throw new Error(NETWORK_OFF_MESSAGE);
}

/** How many requests the app made of its own accord since this process started. */
export function networkActivity(): { allowed: number; blocked: number } {
  return { allowed, blocked };
}

/**
 * The boolean form, for callers that would rather skip a request than throw. It is
 * counted the same way, so the privacy page sees traffic that never left the Mac.
 */
export function allowOutboundRequest(reason: string): boolean {
  try {
    assertNetworkAllowed(reason);
    return true;
  } catch {
    return false;
  }
}
