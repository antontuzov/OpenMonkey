import { config } from "./config";
import logger from "./logger";

/**
 * One switch for every request the app makes on its own: model downloads and page
 * fetches. Loopback to the local MLX server is not an internet request, so it stays
 * outside the switch, and links handed to the user's browser are their action, not
 * the app's.
 */
export const NETWORK_OFF_MESSAGE = "Network access is off in Settings → Privacy → Diagnostics";

export function networkAllowed(): boolean {
  return config.get("privacy").networkAllowed !== false;
}

export function assertNetworkAllowed(reason: string): void {
  if (networkAllowed()) return;
  logger.info("network.blocked", { reason });
  throw new Error(NETWORK_OFF_MESSAGE);
}
