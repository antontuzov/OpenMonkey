import { app } from "electron";
import * as path from "node:path";

// Automation and portable profiles: redirect the whole profile folder before the
// config store, the database and the logger resolve their paths.
if (!app.isPackaged && process.env.OPENMONKEY_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.OPENMONKEY_USER_DATA));
}
