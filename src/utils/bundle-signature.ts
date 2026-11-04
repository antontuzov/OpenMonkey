import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Squirrel.Mac is what installs a macOS update, and it verifies the code signature of
 * both the running app and the archive replacing it. An app with no identity behind it
 * can therefore learn about a release and download it but can never install it.
 *
 * electron-builder writes `Contents/_CodeSignature` only when it signs with an
 * identity, so that directory separates a CI build that got the Developer ID from a
 * local one, which carries at most the arm64 linker's adhoc signature.
 *
 * `appPath` is what Electron's `app.getAppPath()` returns: inside a packaged app that
 * is `<bundle>/Contents/Resources/app.asar`.
 */
export function bundleIsSigned(appPath: string): boolean {
  const contentsDir = path.dirname(path.dirname(appPath));
  return existsSync(path.join(contentsDir, "_CodeSignature"));
}
