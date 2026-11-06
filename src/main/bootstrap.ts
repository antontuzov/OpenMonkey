import { app } from "electron";
import * as path from "node:path";
import { noteLaunch, planSafeMode, safeModeRequested } from "../utils/safe-mode";
import type { SafeModeInfo } from "../utils/types";

// Automation and portable profiles: redirect the whole profile folder before the
// config store, the database and the logger resolve their paths.
if (!app.isPackaged && process.env.OPENMONKEY_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.OPENMONKEY_USER_DATA));
}

/** Where the count of launches that died early is kept. */
export const crashRecordFile = path.join(app.getPath("userData"), "safe-mode.json");

/**
 * What this launch does, decided before anything else loads: a launch asked for
 * safe mode gets it, and a launch after the app died twice in a row gets it too.
 */
export const safeMode: SafeModeInfo = (() => {
  const record = noteLaunch(crashRecordFile);
  return planSafeMode(safeModeRequested(process.argv, process.env), record.crashes);
})();
