/**
 * The legal shelf, in one place: the app, the landing page and the guard test all
 * read these links, so a renamed document is renamed everywhere at once.
 * Fragments are GitHub heading anchors of docs/LEGAL.md — the guard test
 * regenerates them from the file's headings and fails if one drifts.
 */
const REPO = "https://github.com/antontuzov/OpenMonkey";

export const LEGAL_LINKS = {
  eula: `${REPO}/blob/main/docs/LEGAL.md#end-user-license-agreement`,
  refunds: `${REPO}/blob/main/docs/LEGAL.md#refund-policy`,
  exportControl: `${REPO}/blob/main/docs/LEGAL.md#export-control`,
  privacy: `${REPO}/blob/main/docs/PRIVACY.md`,
  security: `${REPO}/security/advisories/new`,
} as const;