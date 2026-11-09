import * as path from "node:path";
import { dataRoot } from "./config";
import { LicenseManager, deviceFingerprint } from "./license";

/**
 * The license of this Mac. Both files live in the app's own data folder: the license
 * the user was sent, and the day the trial started. Neither leaves the Mac, and
 * neither is ever asked about over the network.
 */
export const licenseService = new LicenseManager({
  licenseFile: path.join(dataRoot(), "license.json"),
  trialFile: path.join(dataRoot(), "trial.json"),
  deviceId: deviceFingerprint(),
});

/** The gate the paid actions go through. */
export const licenseGate = {
  entitled: (): boolean => licenseService.entitled(),
  require: (feature: string): void => licenseService.require(feature),
};
