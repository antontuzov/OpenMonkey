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
- **The agent can post to your own Telegram channel or Reddit account.** `publish.post`
  goes out under your own account — never a third party's — and stops for approval
  first, because a post cannot be taken back. The credentials live in the macOS
  keychain: the Telegram bot token, and for Reddit the script app id, the app secret,
  the account name and the account password. They are never written to the settings
  file, and on a Mac with no keychain the app refuses to store them at all rather than
  fall back to plaintext. The target — the chat id, the subreddit — comes from
  Settings → Publishing, so the model cannot post to a channel you did not name. The
  app also keeps itself slow, because a channel that answers every few minutes reads as
  a bot: ten posts an hour on Telegram, two on Reddit, a quarter of an hour between
  Reddit posts, and the count survives a restart. A post that asks for upvotes,
  comments or follows is refused before it leaves the Mac, since that is what gets an
  account removed. `publish.list_channels` reports what is set up and how much room is
  left, without ever showing the token. Both actions sit behind Settings → Privacy →
  network access.
- **An approval can be answered from the notification itself.** The banner macOS shows
  when a tool wants your yes now carries **Allow** and **Deny**, so a decision no longer
  needs the window in front of you: press one and the tool runs, press the other and it
  is refused. The dialog that was waiting for an answer closes by itself, in the main
  window and in Quick Ask alike. The buttons can be turned off in Settings → Desktop,
  where macOS — which decides on its own whether a banner shows actions at all — is
  named as the one that has the last word. Quiet hours are there too: pick the hours,
  and the notifications stay quiet inside them while the Dock badge still counts what
  waits for you. A window that is already in front still gets no banner at all, and the
  app never answers an approval twice.
- **The app keeps copies of your history and says whether they are readable.** Settings →
  Privacy now has a Storage row that runs SQLite's own integrity check against the
  database, lists the copies the app has made and lets you put one back. A copy is taken
  on launch when the newest one is older than twelve hours, so a laptop that slept
  through its interval still gets one, and then every twelve hours while the app runs —
  only while it runs, because nothing here is a background service. The five newest
  copies are kept, each written `0600` in a folder that is `0700`, so another account on
  the Mac cannot read them. Putting one back is undoable by design: the live database is
  snapshotted into the rotation first, the button needs two presses, and a name that is
  not one of the app's own copies is refused before the folder is opened. Copies work
  while the history is locked with a passphrase, because the file is a plain SQLite
  database and only the row values are sealed. A damaged database is named with the
  verdict SQLite gave, not with a spinner.

### Changed

- **A long chat no longer builds every message.** The chat panel mounts only the messages
  near the reader — a screenful of them — and the ones above and below stand in as the
  space they would take, so the scrollbar still tells the truth about how long the chat
  is. Every message is measured as it appears, so the space is its real height and not a
  guess, and the message you were reading is put back where it was when the rows around
  it change size. The chat keeps its newest message in view until you deliberately
  scroll up into the past: a chat that grows while you watch it no longer leaves you
  staring at the top of the history, and a layout that shrinks or grows under you is not
  mistaken for you leaving. Opening a chat lands on its newest message, as it always did. A
  history of six hundred messages mounts fewer than sixty of them; the end-to-end suite
  measures that on every run and prints the number, and the scroll geometry, into the
  log.
- **Markdown is parsed while the answer arrives, not after it.** While the model is
  still writing, only the unfinished tail is parsed again — the blocks that are already
  finished are kept as they are, so a long answer stops being re-read on every token. A
  message that is opened again from the history is parsed once and kept in a bounded
  cache, so a long history does not hold a copy of every answer it has ever shown.

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
- Fifteen tests cover the publisher with every request stubbed: the Telegram message and
  the photo caption, the Reddit token and the submit call, the refusal of a post that asks
  for upvotes, the hourly cap, the gap between two posts, the missing token and the
  missing target, the length limits of each channel, and nothing fetched at all when
  the network switch is off. The saved token never appears in what the model is told.
- The settings pages check their own row titles against the search index without a
  window. The end-to-end sweep types every row a page renders into the search box, but
  it needs a screen; a headless test now reads the same titles out of the page source
  and asks the index for them. It caught the publishing policy row, which had been
  added to the Approvals page without being added to the index.
- Twelve headless tests cover the notification: the banner carries Allow and Deny,
  pressing Allow answers the approval with a yes, pressing Deny with a no, the buttons
  stay away when they are turned off, a window that is in front gets no banner, quiet
  hours silence it and the morning brings it back. Five more cover the hours
  themselves, including a window that runs past midnight and a pair that means nothing.
- Twenty-seven headless tests cover the chat window and the incremental parser without a
  screen: a chat of five hundred messages mounts a screenful and nothing more, the
  space above and below adds up to the height of the whole list, a measured message
  beats the guess, and a reader in the middle gets what is around them. Twelve of them
  cover when the chat follows its newest message: a chat taller than the window keeps
  it in view, scrolling up into the past stops it, a layout that shrinks or grows
  under the reader is not mistaken for the reader leaving, a scroll of a few pixels is
  not a scroll at all, scrolling back to the end starts it again, and a pin the chat
  made itself is not read as the reader leaving — the case the end-to-end run caught on
  CI, where a five-hundred-message history pinned to 12,683 and the follow machine,
  still holding 12,854 from before the pin, froze the window mid-history. The parser keeps
  the blocks that are finished, produces the same blocks a full parse would, and parses
  again when the answer is replaced, when a code fence is still open, or when a quote is
  still growing. The end-to-end suite measures the same thing with a real window: a
  history of six hundred messages mounts fewer than sixty message bodies, the scroll
  height still covers all six hundred, the newest message is the one left on screen,
  and scrolling to the middle moves the window there instead of mounting the lot.
- Eight integration tests run the copies against real SQLite files: a launch writes one
  and a launch with a fresh copy writes nothing, a copy stands on its own when it is
  opened without the app (the chat written before it is read back out of the file),
  only the five newest survive a rotation, a sound database says "ok", a database whose
  second page has been scrambled over is reported as damaged with the verdict SQLite
  gave, putting a copy back drops the chat that came after it and brings the one it
  holds while the live connection keeps writing, a name that is not one of the app's
  copies — `../../secret.key`, a nested folder, an empty string — is refused and leaves
  the live file byte-for-byte unchanged, and the status names its own interval instead
  of hardcoding one. Two end-to-end specs run the same thing through the page: the
  Storage row checking a live database, copying it on demand and the files on disk
  carrying `0700` and `0600`, and a restore that arms on the first press, completes on
  the second, and drops the verdict it can no longer stand behind.

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
