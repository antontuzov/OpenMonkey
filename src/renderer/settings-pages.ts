import type { SettingsPage } from "../utils/types";
import type { StringKey } from "./i18n";

/**
 * The title every settings page shows. The palette, the settings search and the
 * page itself all read it, so a renamed page is renamed everywhere at once.
 */
export const SETTINGS_PAGE_TITLES: Record<SettingsPage, StringKey> = {
  profile: "settings.profile",
  appearance: "settings.appearance",
  desktop: "settings.desktop",
  approvals: "settings.approvals",
  memory: "settings.memory",
  workspace: "settings.workspace",
  permissions: "settings.permissions",
  privacy: "settings.privacy",
  extensions: "settings.extensions",
  model: "settings.model",
};

/** The order the settings sidebar lists the pages in. */
export const SETTINGS_PAGE_ORDER: SettingsPage[] = [
  "profile",
  "appearance",
  "desktop",
  "approvals",
  "memory",
  "workspace",
  "permissions",
  "privacy",
  "extensions",
  "model",
];
