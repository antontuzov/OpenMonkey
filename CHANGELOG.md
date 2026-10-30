# Changelog

All notable changes to OpenMonkey are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions match the tag
that produced the build.

## 0.9.0 — 2026-10-30

The release-candidate build: local chat with tools, approvals, memory, privacy
controls and a desktop shell that can be installed and updated.

### Added

- **Chat** — streaming replies from a local model, conversation sessions with search,
  pin and rename, attachments, stop and retry, and failure states that say what
  happened.
- **Agent v2** — validated tool calls (files, web, shell, calendar/email), per-tool
  approval policies, a session-scoped "remember" choice, an audit log, and MCP
  servers.
- **Task monitor** — live tasks with moods, a command rail and an approval dialog that
  owns the decision; a fenced `task` block in a reply is parsed, repaired when a
  closing brace is doubled, and audited.
- **Memory** — cross-chat summaries, pinned facts, and optional local workspace
  retrieval with citations.
- **Desktop** — Quick Ask popover on Option+Space with inline approvals, launch at
  login, close-to-tray, native menu, notifications, Dock badge, window-state restore.
- **Appearance** — warm-gray and mint design tokens, 12 mood portraits wired to the
  window, tray and Dock, theme previews, text scale, density, contrast, reduced
  motion.
- **Localization and accessibility** — full EN/RU interface, named controls, landmark
  structure, live regions, focus handling; verified in an automated a11y audit.
- **Privacy** — AES-256-GCM history sealed by a Keychain key (0600 file fallback),
  optional scrypt passphrase lock with idle/sleep auto-lock, erase-everything,
  encrypted backup export/import with schema stamps, 7–365-day retention, a
  deny-all-network switch, and rotating logs that redact conversation text.
- **Release engineering** — unit (34) and integration (20) suites on `node:test`,
  Playwright e2e on a throwaway profile with a committed visual baseline, performance
  budgets (cold start, streaming jank, memory, lazy settings chunk), GitHub Actions
  verification matrix and tag packaging, hardened-runtime entitlements, and
  `electron-updater` with stable/beta channels.

### Fixed

- Mood portraits failed to load in packaged builds because their URLs were rooted at
  `/logos/…` under `file://`; all renderer asset paths are now document-relative, and
  the e2e a11y audit fails on any image that does not decode.
- A model reply that closed a task fence with an extra `}` no longer fails as invalid
  JSON; only surplus trailing braces are repaired, and the repair is logged.
- The Privacy toggle no longer accepts a second click while a re-encryption is in
  flight, which could queue a flip against a stale snapshot.
- The integration suite no longer flakes on a fake home without `Documents`: the
  runner creates the allowed folders before the shell tests and kills a stuck child
  after two minutes.

### Performance

- Settings loads as its own 132 kB chunk instead of inflating the 780 kB entry bundle.
- Streamed tokens coalesce into one render per animation frame: a 320-token stream
  kept zero long tasks and a 17.7 ms maximum frame gap.
- The model-load card counts elapsed seconds so a slow load never looks frozen.

### Known limitations

- The updater, signed packaging and notarization have not run end to end: there is no
  release feed or Developer ID certificate in this checkout, and unpackaged builds
  skip updates by design.
- Apple's MLX backend is optional and requires a separate Python environment; the
  GGUF backend is the default.
- A forgotten passphrase cannot be recovered.
