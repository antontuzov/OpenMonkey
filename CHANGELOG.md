# Changelog

All notable changes to OpenMonkey are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions match the tag
that produced the build.

## Unreleased

### Added

- **The agent can find pictures on the internet.** `web.image_search` asks two openly
  licensed indexes — Openverse first, Wikimedia Commons behind it — and answers with the
  direct image URL, the page the picture came from, its author and its licence, so a
  result is something you may actually publish rather than a thumbnail of unknown
  rights. DuckDuckGo's and Bing's image endpoints were tried first and rejected: they
  bot-challenge most shared networks and return no rights information at all.
  `web.save_image` downloads one of those hits into your own folders. The approval names
  the destination, only `image/*` responses are written, the file is capped at 25 MB,
  robots.txt is respected, and a path outside the folders you gave the agent is refused
  before a single byte is fetched. Both actions sit behind Settings → Privacy → network
  access, so with the switch off neither request leaves the Mac.
- **Analysis reports quote numbers the app measured.** `file.inspect` walks a folder and
  answers with what a report actually needs — rows and columns, per-column min, max, mean
  and sum, the values behind a category, the keys and shape of a JSON document, headings
  and word counts — instead of handing the model a truncated page and hoping it adds up.
  Tables are recognised by their shape rather than only by `.csv`, so a report exported as
  `.txt` still gets measured. A file bigger than the 4 MB read cap is measured up to the
  cap and says so, binary files are named rather than parsed, the walk stops at 40 matches
  and reports the stop, and nothing is written: the action needs no approval.

### Fixed

- **Your chats are yours to read even before the model loads.** The sidebar's session
  list and the open tabs were restored only after the agent reported `ready`, so a Mac
  with no weights on disk — every first run from the DMG, and every machine still
  downloading them — opened the app to "No chats yet" over conversations that were
  sitting in its own database. The list now loads as soon as there is an agent to ask.

### Testing

- The end-to-end suite says which of its specs need the pinned Bonsai weights, from one
  shared check instead of eight copies of the same path, and skips the rest on a runner
  that has never downloaded 546 MB. CI's e2e leg went from nine failures to none for
  every spec that does not actually ask the model for tokens.
- The streaming test still measures frame gaps on a runner but no longer judges them:
  without a display to composite for, the window is paced by the host and the same
  stream that never exceeds 40 ms locally read 283 ms on CI.
- Nine headless tests cover the image tools with every fetch stubbed: attribution and
  licence in the answer, the fallback when the first index is down, a non-image refused,
  an oversized file refused, a path outside the workspace refused without downloading,
  and nothing fetched at all when the network switch is off.
- The motion spec stopped reading the settings page. It measured the chat panel's spring
  but never navigated to the chat, relying on the starter-prompt spec to leave it there —
  and that spec is skipped on a machine with no model, so on CI the panel was absent and
  its transition duration came back as nothing. A spec that needs a surface now opens it.
- Twenty-seven tests cover the measuring pass: eighteen on the facts themselves (quoted
  commas and newlines inside a field, `n/a` in a price column, money signs, ragged rows,
  a `.txt` export read as a table, a wide table that says what it left out) and nine that
  run the tool over real files on disk, including one over the read cap and one over a
  folder of 45 matches. Writing the capped-file test is what found the first crash: min
  and max were taken with a spread over the whole column, so a 330 000-row export blew
  the call stack. They are folded in a loop now.

## 0.9.2 — 2026-11-05

The tag whose pipeline actually publishes. 0.9.1's build died before it could upload
anything, so `releases/latest/download/OpenMonkey-arm64.dmg` was a 404 and the landing
page linked to it; this release is the first file anyone can download.

### Fixed

- **A tag now reaches GitHub Releases.** The package job passed the Apple signing
  secrets as environment variables even when the repository has none, and
  electron-builder read an empty `CSC_LINK` as a certificate path and failed the build.
  The names are now absent rather than blank, so an unsigned build completes and the
  release job publishes the DMG, the updater zip, their block maps and `latest-mac.yml`.
- **Installed builds show their mood art.** `assetPath()` joined onto
  `Contents/Resources`, but the builder copies the folder to
  `Contents/Resources/assets`, so every packaged run looked for the twelve portraits one
  directory too high and the tray and Dock stayed empty.

### Changed

- **The updater promises only what it can do.** On a build without a Developer ID
  signature it no longer downloads an archive it cannot install; a new version now
  names itself and opens the release page, and the download-and-restart path stays on
  for signed builds. Settings → Desktop → Updates says the same thing.

## 0.9.1 — 2026-11-04

The first build anyone can download. Nothing about the app itself changed in this
release; what changed is that a tag now produces a public artifact instead of a
temporary one.

### Added

- **A published release** — a tag runs the package job, then publishes a public GitHub
  Release with `OpenMonkey-arm64.dmg`, the updater zip, their block maps and
  `latest-mac.yml`. The release notes are kept in the repository and carry the SHA-256
  of every file built.
- **Download links that keep working** — artifacts are named by architecture and not by
  version, so `releases/latest/download/OpenMonkey-arm64.dmg` is a permanent link. The
  landing page and README point straight at the disk image.
- **The product site is online** — `landing/` publishes to GitHub Pages from `main`.
- Several chats open in one window at once, each keeping its own thread, restored with
  the window (0.9.0 shipped the code; this is the release that carries it).
- `scripts/make-update-manifest.mjs` rebuilds the macOS update manifest from the
  archives actually on disk, so it is correct whichever arches reach a release.

### Fixed

- The CI `verify` and `package` jobs waited on Apple's retired Intel runner, which never
  answers; every run sat queued for a day and was then cancelled. Both jobs build on
  Apple Silicon now, and an Intel or Windows installer is stated as absent rather than
  implied.
- The landing page promised a Windows installer and an Intel build that no pipeline
  produced.

### Known limits

The release is unsigned: there is no Apple Developer ID behind it, so Gatekeeper
questions the first launch and the in-app updater can report a new version but cannot
install one. Both are settled by the certificate, not by code — the package job already
reads the five Apple secrets.

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
