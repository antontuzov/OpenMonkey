# OpenMonkey — Road to a Premium Local AI Agent

A step-by-step build plan, ordered by what a real user feels first. Every item is grounded in
OpenMonkey's actual architecture: Electron + React, a local GGUF / MLX model, encrypted SQLite,
and approval-gated tools. Nothing here is a mock screen.

---

## Where the app stands today

**Working end to end**

- Native Electron shell: hidden inset title bar, 1360 × 860 window, tray, Dock icon, single instance.
- Local model runtime: Bonsai-4B GGUF via node-llama-cpp, optional MLX server, provider switching.
- First run: onboarding wizard, in-app model manager with resume/verify, macOS permissions page.
- Chat: token streaming over IPC, stop with partial persistence, regenerate, per-session encrypted
  history, multi-session sidebar with auto-title, rename, pin, delete and search, text attachments,
  failure states with recovery actions, per-session drafts.
- Chat actions: edit a question and resend it (the answer below it goes with it),
  regenerate with a switcher that keeps the previous answer, branch a chat from any
  message, copy and quote; every reply shows its duration and the tokens the model
  reported.
- Composer: Enter or Cmd+Enter sends (a stored setting), `@` offers the files of the
  folders the app may read, dropped and pasted files ride along with the message (up to
  eight, 256 KB each), and `/clear`, `/summarize` and `/help` are answered by the app
  itself rather than by the model.
- Command palette: Cmd+K opens one box that searches the chats, the settings pages and
  the commands with a single fuzzy matcher, opens the setting row it named, and is driven
  from the keyboard alone; the whole flow needs no mouse.
- History organizer: the sidebar files the chats as well as listing them — folders that
  count what they hold, labels kept once per chat, an archive of the chats filed away,
  saved searches under a name, and a passphrase-sealed export of a selected group of
  chats.
- Agent v2: schema-validated tool registry, Ask/Allow/Block per tool, session approvals,
  diff/shell/draft previews, encrypted audit log with export, symlink-safe workspace roots,
  live shell output with kill, Trash deletes.
- Activity rail: each task shows the stages it walked through — queued, approval, running —
  with the time each took, the lines a file write changed, its command and collapsible
  output, plus Copy and Retry; a denied action keeps its approval stage and reruns from the
  audit row it left behind. The rail and the approval preview read one diff engine, so the
  two cannot disagree about what a write does.
- Extensions: local stdio MCP servers with discovery, per-server approvals, health, restart,
  enable/disable and JSON-Schema-checked arguments.
- Memory: encrypted pinned facts, extractive cross-chat digests, an opt-in in-memory lexical
  workspace index, automatic retrieval plus a `memory.search_workspace` tool, and grounded
  `[file:<path>:<line>]` / `[fact:<id>]` citations. Settings → Memory exposes facts, digests,
  index status, rebuild/clear/search and a full opt-out.
- Appearance: light/dark/system, eight accents, 12 mood logos propagated to window, tray and Dock.
- Publishing: the agent can post to the user's own Telegram channel, Reddit account, Bluesky
  account or Mastodon account. Every post stops for approval, the secret lives in the macOS
  keychain and never in the settings file, the target comes from Settings rather than from
  the model, and the app keeps itself slow — an hourly cap and a minimum gap per channel,
  kept on disk so a restart does not forget them. A Bluesky sign-in that belongs to another
  handle is refused, a Mastodon instance has to be https because the token rides with every
  post, and a picture address on the local network is never fetched.
- Settings: Profile, Appearance, Approvals, Workspace, Privacy, Model and MCP servers pages
  with search and real controls.
- Privacy: AES-256-GCM rows, key file mode 0600, path confinement, local-only by default;
  the app's data folder is not a tool workspace root.
- Build: typecheck + production build pass; macOS/Windows packaging configured.
- Updates: the app checks for a release, says plainly what it found, and fetches only what
  it can install. Settings → Desktop carries the status, the release notes read from the
  changelog the release was built from, and a way back to the previous build. A release
  can be let out to part of the installs, decided on the Mac with no account and no
  telemetry.

**Known gaps**

- Tables and true FTS are deferred (see Phase 2 notes).
- MLX streaming is implemented but untested — MLX is not installed on this machine.
- Memory digests are extractive (recent messages and last answers), not model-written rolling
  summaries. Workspace search is lexical and lives only in RAM — no sqlite-vec, no embedding
  model, no persisted index, and the 4B model still mis-selects tools on some workspace turns.
  Automatic retrieval only triggers for messages containing workspace/file/folder/project-style
  words; lexical scoring can surface an irrelevant passage, so citations are grounded against
  the retrieved blocks rather than trusted from the model.
- MCP is local stdio only — no HTTP/SSE transport, OAuth or auto-install. Shell execution is
  piped, not a PTY, so interactive/TUI programs do not work. No plan preview — an approval
  shows the action and its diff, not a whole plan the agent intends to follow.
- Calendar/mail live paths are untested here to avoid new macOS Automation prompts.
- The 4B model frequently emits malformed task JSON; validation rejects it and shows a failed
  task instead of guessing at the intended call.
- Auto-update is in the app; whether the published 0.9.2 build is signed has not been
  verified here — the release job signs and notarizes only when the Apple credentials sit
  in the repository secrets. An unsigned build cannot replace itself, so the updater
  names the release and opens the release page instead of promising an install, and the
  app works out which case it is at runtime.
- Delta downloads are off on purpose. The artifact name carries no version, so the
  blockmap of the running build and the blockmap of the release on offer are the same
  file, and a patch built from them would not be the release. The whole archive is
  fetched instead.

**Effort legend:** S = 0.5–2 days, M = 3–5 days, L = 1–3 weeks (one engineer).

---

## Phase 0 — Close the baseline (P0) — ✅ complete 2026-10-22

1. ✅ **Renamed the project root** to `openmonkey/`; the app's `userData` path
   (`~/Library/Application Support/openmonkey`) was left untouched. *(S)*
2. ✅ **App identity**: 1024 px master icon with safe padding, generated `.icns` and `.ico`,
   wired into electron-builder, version set to `0.9.0`. *(S)*
3. ✅ **Real loop verified**: drove the live UI through CDP, sent a prompt, received
   “OpenMonkey is ready.” from the local model; history is persisted. Tool approval + relaunch
   check remains in Phase 2/3 acceptance work. *(S)*
4. ✅ **Committed and tagged** this baseline. *(S)*

---

## Phase 1 — First run that earns trust (P0) — ✅ core complete 2026-10-22

5. ✅ **Onboarding wizard**: Welcome → Identity (name, personality, accent) → Approvals →
   Model → chat. Skippable, persists `onboarding.completed`, accent previews live, branded
   loading state while config resolves. A workspace-folders step is deferred until the tool
   sandbox accepts user-chosen roots. *(M)*
6. ✅ **Model Manager UI (core)**: pinned Bonsai GGUF catalog, download to `.part` with
   HTTP Range resume, cancel/retry, SHA-256 verification, partial-download hydration after
   restart, and auto-load on completion. Verify was exercised in-app against the installed
   572 MB file. The zero-to-model network path was not re-run because the weights were
   already on disk. Deferred premium extras: delete/disk management, tok/s benchmark,
   RAM-based recommendation, context/GPU controls. *(L)*
7. ✅ **macOS permissions page**: honest Automation probes for Calendar and Mail with
   per-click re-check, Notifications labelled as managed by macOS (no fake status), and
   deep links into the relevant Privacy & Security panes. *(M)*

---

## Phase 2 — Chat people want to live in (P0, ~2 weeks) — ✅ core complete 2026-10-22

8. ✅ **Streaming + control**: one `chat-event` channel carries start/token/replace/done/stopped/
   error; tokens are held back briefly so a `task` fence never flashes in the reply; Stop aborts
   and keeps the partial answer (marked “Stopped”); regenerate replaces the stored answer and
   replays the original expanded prompt, including attachment text; drafts survive session
   switches. Edit-and-resend is deferred. Streaming verified natively with Bonsai; MLX SSE
   parsing exists but was not exercised because MLX is not installed. *(L)*
9. ✅ **Message craft (core)**: fenced code with language label and Copy/Copied, inline bold/
   code/links through the external-link policy, attachment chips, per-message duration and
   stopped/meta line. Tables and per-message delete are deferred. *(M)*
10. ✅ **Sessions**: auto-title from the first message, real sidebar ordered pinned-first,
    rename inline (Enter/Escape), pin, delete with 5 s inline confirmation, Arrow Up/Down
    navigation, debounced search over titles and decrypted message bodies, legacy single-thread
    migration to `conv_legacy`. Search scans recent decrypted rows rather than FTS5 (encrypted
    columns cannot be indexed on disk); archive and the rest of the organizer shipped later as
    the premium row 17 — folders, labels, saved searches and a passphrase-sealed export of a
    selection. *(L)*
11. ✅ **Composer upgrades (core)**: per-session drafts, drag-and-drop text attachments with
    extension allowlist, NUL-byte rejection and a 256 KB cap, native file picker through IPC,
    attachment chips, Enter sends, Shift+Enter newline. Slash commands are deferred to the
    Agent v2 command surface. *(M)* — later raised to the premium composer: `/clear`,
    `/summarize`, `/help`, `@file` mentions, several attachments per message and a
    stored Enter / Cmd+Enter setting.
12. ✅ **Failure UX (core)**: specific cards for model-not-ready, context overflow, offline and
    unknown errors, with retry / new chat / model settings actions; pre-send failures restore
    the draft and attachment and say the message was not sent. Tool-denied and corrupt-DB
    messages are deferred to Phases 3 and 7. The context-overflow branch is implemented but
    could not be forced live: llama.cpp truncated a 117 KB prompt instead of failing. *(S)*

**Phase 2 verification:** driven through the running Electron app over CDP — legacy migration,
streaming, Stop partial persistence, regenerate replacement, session create/auto-title/rename/
pin/search/switch/delete, drag-drop attachment answer, rejected drop, failed send with draft
restore, Enter-to-send, and the sidebar hover-actions layout. The native picker path is wired
but was not automated; drag-and-drop ingestion and attachment-aware replies were verified.

---

## Phase 3 — Agent v2: capability with guardrails (P1, ~3 weeks) — ✅ core complete 2026-10-22

13. ✅ **Tool protocol hardening (core)**: one registry defines every built-in action with its
    argument types, required flags, string/number caps, mutating flag and timeout, and the same
    list generates the model's protocol text. Arguments are normalized and rejected before any
    I/O on unknown keys, missing required values, wrong types, bad enums and overlong strings;
    MCP inputs run through a small JSON-Schema validator (properties, required,
    additionalProperties:false, items, enum, bounds, local $ref, anyOf/oneOf). Per-tool timeouts
    abort work, observations are capped (256 KB reads, 12 K web text, 60 K shell capture, 20 K
    live output), and invalid calls fail with a model-readable message plus an `invalid` audit
    row. Retry-with-backoff and a pre-execution plan preview are deferred. *(M)*
14. ✅ **Approval center**: six tool families each have Ask / Allow / Block; the master "Run
    tool actions without asking" switch overrides them. Read-only calls never prompt, but Block
    still refuses them. "Allow for session" is keyed to the exact `type.action` (or
    `server.tool`). Previews cover LCS diffs, shell command + cwd, calendar events, mail drafts,
    URL opens and MCP calls. Every call writes an encrypted audit row (AES-256-GCM) with
    decision, status, args and result/error; the page polls pending work, expands details and
    exports plain JSON mode 0600. Audit follows the retention job and clears via armed Confirm.
    Approvals are handled per task; a deliberate cross-task queue was not built. *(M)*
15. ✅ **Files v2 (core)**: Settings → Workspace lists Documents, Downloads and Desktop and adds
    custom roots through the native picker (wired; picker not automated). Confinement checks the
    lexical path, then realpath of the deepest existing ancestor, so symlinks cannot escape;
    tests covered `../` traversal, a symlink to `/etc` and a shell cwd outside the roots. Writes
    show a diff before approval; deletes use `shell.trashItem`; the app's own data folder (DB,
    key, logs) is no longer a tool root. Tree browser and file watching are deferred. *(M)*
16. ✅ **Shell v2 (core)**: commands run inside a workspace root with explicit cwd, per-command
    approval, a command + cwd preview, live output in the task rail (last 20 K characters), a
    60 K capture cap, a 75 s timeout and a Kill button that also closes a waiting approval.
    Execution is piped (`child_process`), not a PTY, so interactive and full-screen TUI
    programs are unsupported; env display is deferred. *(M)*
17. ✅ **Web v2 (core)**: `fetch_page` extracts readable text (12 K cap), honors robots.txt with
    longest-match rules and allow-on-tie, and caches responses (bounded, 30 min robots TTL).
    `search` parses DuckDuckGo HTML results with title, host and URL attribution (8 results).
    `open_in_browser` remains the only mutating web action. Per-host rate limiting is not
    implemented; search depends on DuckDuckGo's HTML endpoint. *(M)*
18. ✅ **Calendar & mail v2 (core)**: event and draft previews show the exact fields before
    approval; drafts target the DRAFTS mailbox and there is deliberately no send action; account
    selection is explicit; every AppleScript call has a 30 s timeout, 4 MB buffer and surfaced
    stderr. The Phase 1 TCC probe page is unchanged. Live calendar/mail paths were intentionally
    not exercised to avoid new macOS Automation prompts on this machine. *(M)*
19. ✅ **Extensions (MCP)**: local stdio servers via `@modelcontextprotocol/sdk` — config
    registry, connect on launch, tool discovery (`readOnlyHint` decides read-only), per-server
    Ask/Allow/Block, enable/disable, restart, health/error state and tool list in Settings.
    Server tools appear as `server.tool`, with schema-checked arguments, a 60 s call timeout and
    abort support. The UI warns that env values are plain text and prefer wrapper scripts.
    Stdio only — no HTTP/SSE, OAuth or auto-install. The add/remove form was wired but not
    exercised end to end; a test server added via IPC was verified for connect, discovery,
    restart, toggle, read-only and mutating calls, session approval and Block. *(L)*

**Phase 3 verification:** driven through the running Electron app over CDP with native captures
— MCP connect/discovery/restart/toggle and a read-only call; mutating MCP approval allow-once,
deny and allow-for-session; policy Allow and Block (including read-only calls); invalid JSON,
unknown action and unknown/missing argument rejection with `invalid` audit rows; file diff
preview + write; traversal, true symlink escape and shell cwd escape; shell preview, live ticks
and Kill mid-run (partial output persisted, no error); cancel while an approval is waiting
(status `cancelled`, audit decision `cancelled`, no file change); Trash delete; workspace root removal;
encryption-key read rejection; audit rows, decision labels, clear-with-confirm and empty state.
Not automated: audit export through the native save dialog, workspace folder picker, live
calendar/mail calls, and adding/removing an MCP server through the Settings form.

---

## Phase 4 — Local memory (P1, ~2 weeks) — ✅ core complete 2026-10-22

20. ✅ **Conversation memory**: pinned facts are encrypted at rest (AES-256-GCM, `enc:v1:`),
    capped at 50 entries and injected newest-first (12 facts / 3,000 characters) with
    `[fact:<id>]` labels. Cross-chat digests are computed on demand from stored messages —
    extractive excerpts of each chat plus its last answer, labelled `[chat "<title>"]` — so
    no second model call and no summary cache. Settings → Memory lists facts and digests,
    supports add/delete/clear and shows exactly what is injected. Disabling memory stops all
    injection while keeping explicitly pinned facts visible and deletable. *(L)*
21. ✅ **Local RAG (core)**: opt-in lexical index of text files in the configured workspace
    roots, held in memory (1,200 files / 3,000 chunks / 256 KB per file / 8 MB total; hidden,
    secret-looking and symlinked paths skipped). Retrieval happens automatically for
    workspace-intent messages (top 2 passages, 700-character excerpts) and through the
    read-only `memory.search_workspace` tool (4 hits, one best passage per file). A turn with
    retrieved context is answer-only: tool blocks are ignored and the retrieved passage is used
    if the model spends its turn on a call. The 4B model's inline citations are stripped and
    replaced with a deterministic `Sources: [file:<path>:<line>]` built from the passage that
    contains a distinctive term from its answer, because the model otherwise invents or
    mislabels paths. Disabling memory or workspace search clears the in-memory index at once;
    digests are derived on demand and disappear with the setting.
    Deferred: sqlite-vec/embeddings (no extra model was downloaded), index persistence, file
    watching, and semantic (non-lexical) ranking. *(L)*

**Phase 4 verification:** driven through the running Electron app. Pinned fact add/persist,
encrypted row in SQLite and key mode 0600; fact recall with `[fact:…]` citation; index
status/rebuild and direct IPC search; a natural-language workspace question answered with the
launch codename and `Sources: [file:/tmp/om-memory-workspace/project-notes.md:1]` while the log
showed `memory.context.injected` (no task was run); a stray retrieved source-code passage was
rejected by the grounding pass; memory-off cleared the index to 0 files/0 chunks, made search
return an explicit error, prevented retrieval injection, and kept the pinned fact visible but
not injected. Test workspace, facts, conversations and screenshots were removed afterwards;
default config is memory on, workspace search off.

---

## Phase 5 — Desktop premium (P1, ~2 weeks) — ✅ core complete 2026-10-23

22. ✅ **Quick Ask**: borderless 560×440 popover registered on ⌥Space through
    `globalShortcut`, opened from the tray, the menu or the shortcut without activating the
    main window. It streams into the same conversation the main window is on, hides on blur
    and on Escape, and carries `origin: "quick"` through `TaskManager` → `ApprovalRequest` so
    each surface renders only its own approvals. "Open chat" hands focus to the composer. *(M)*
23. ✅ **Desktop citizenship**: window bounds/maximization restored through a separate
    `openmonkey-window` store, with a saved position reused only while it still overlaps a
    connected display; native menu whose items send real `menu-command`s (new chat ⌘N, command
    palette ⌘K, Quick Ask, activity ⌘\, composer ⌘L, stop ⌘., settings ⌘,, mood, GitHub, data
    folder)
    and re-installs on language change; macOS notifications for awaiting-approval and for an
    approved action finishing, skipped while the owning surface is visible and focused; Dock
    badging from the count of awaiting approvals; close-to-tray and launch-at-login toggles
    (`login-item` only applies to packaged builds); tray menu, tooltip and mood submenu, and a
    tray click that recreates the window if it was destroyed. The tray menu also holds the
    chats themselves — pinned first, then the ones touched last, rebuilt on every opening so
    the list is never stale — and a New Chat item that starts one without opening the window
    first; the files brought into a chat are kept by the Dock (`addRecentDocument`), so the
    Dock menu and File → Open Recent hand them back, and the file lands in the composer of
    the open chat, read by the main process rather than by the renderer. A mood that turns
    while the app is in the background nods the Dock icon once. *(M)*
24. ✅ **Appearance v2**: theme cards (Light / Dark / System, where System tracks
    `prefers-color-scheme` live), text scale S/M/L applied as `setZoomFactor` (0.9 / 1 / 1.12)
    so chat scales too, a comfortable/compact density per theme through `data-density`
    (the app follows the theme it is showing, and a config written before the split
    keeps the density it had in both), a free-form accent
    picker with a WCAG report (`checkAccent` mixes the accent the same way the CSS tokens do
    and grades AA / large-text / low), and a Reduce Motion switch that also honours the system
    setting. Settings patches are partial per section, so changing one field cannot revive a
    stale sibling. A True black switch repaints the dark theme on `#000000` — paper, cards and
    sidebar — so an OLED panel keeps its pixels off, and the vibrant window stops letting the
    desktop through when it is on. Paper, card, second card, line, ink, muted, faint and
    sidebar can each be picked by hand, for the light theme and the dark theme separately,
    and the app repaints with them at once; the colours mixed from the accent follow the
    card you picked, and the card names the pairings that fall below AA for the theme being
    edited, with one button to put the built-in colours back. *(M)*
25. ✅ **Accessibility & i18n**: EN/RU/AR dictionary with `t()`/`locale()`, `documentElement.lang`,
    locale-formatted times (12-hour en-US, 24-hour ru-RU, 24-hour ar-EG) and mood names shared
    with the native tray through `MOOD_LOGOS.labelRu`/`labelAr` and one `moodName(mood, language)`
    helper, so the window and the tray cannot drift apart on a name; every date, time, figure and
    size now comes from one formatter module built on the language the app is in rather than on the
    Mac's (`src/renderer/format.ts`), with the locale data read once at start-up instead of inside
    the first render of an arriving message; the layout follows the direction the text runs
    in, so a language written from the right can be mirrored — every physical `ml`/`pl`/
    `left`/`right` was rewritten as a logical `ms`/`ps`/`start`/`end`, the arrows that point
    somewhere turn with the text, the switches and theme previews are mirrored, and the
    document says which way it runs (`documentElement.dir`); Arabic is the language that asks
    for the mirror, so it ships with all 487 strings and turns the interface the other way round
    when it is picked; the keyboard map is shown in Settings and echoed
    by the native menu accelerators; the approval dialog is a real `role="dialog"` with
    `aria-modal`, labelled and described headings, autofocus, Tab/Shift+Tab wrap, Escape to
    deny and focus restore; icon-only controls carry `aria-label`s and toasts/streaming text
    use live regions (53 labelled controls and 11 live regions on the chat surface). Long
    explanatory copy, the onboarding flow and the welcome/failure cards stay English. The same
    claims are now a gate rather than a note: `src/utils/a11y.ts` holds the rules with no DOM in
    them, the palette is contrasted from `global.css` itself for all eight swatches in all three
    schemes — light, dark and true black — Settings → Privacy → Diagnostics runs the audit over
    the screen in front of you, and CI runs it against the real app and fails on any finding. *(L)*
26. ✅ **Micro-interactions**: streaming caret and held-back fence tail while answering, message
    skeletons on history load, inline task progress in the rail, and toasts instead of modals
    for success (copy, fact saved/removed, folder added, audit exported, reindex) with no sound
    anywhere and no audio element in the app. *(S)*

**Phase 5 verification:** driven through the running Electron app over CDP. Quick Ask opened
programmatically, streamed, hid on Escape, kept its own approval inline (a `shell.run_command`
approved there executed with output `quick-approval` while the main window showed nothing), and
"Open chat" left focus in the composer. Window state restored 1360×794 at (40, 30) from the
store; menu commands settings / focus-composer / search / activity / cycle-mood all observed
their effect; appearance changes (Dark → L → compact → Reduce Motion → accent `#f6e7a1` flagged
low-contrast → RU) persisted to disk and survived a reload; the RU chat surface, task rail and
copy toast were screenshot-checked, which is what surfaced the hardcoded `Copy`, `on/off`,
mood-name and rail labels fixed in this pass. **Not exercised natively** (they need real OS
input or a second instance): the traffic-light/⌘W close path behind close-to-tray — renderer
`window.close()` bypasses the preventable `close` event, so it is not a valid test — the ⌥Space
global key itself, notification banners, the Dock badge pixel, launch-at-login (dev-gated), and
the tray context menu, whose RU labels and language-change rebuild are wired but were never
opened on screen.
The approval dialog rendered and resolved in the main window through "Allow for session", but
Tab-cycling and focus restore were not instrumented; both belong in the Phase 7 e2e pass. The
streaming caret and the history skeleton were confirmed in the render paths, not captured on
screen (local history loads faster than the debounce).
`npm run typecheck` and `npm run build` are clean.

---

## Phase 6 — Privacy you can prove (P0, ~1 week)

27. ✅ **Secrets & locking**: the history key is generated once and wrapped by `safeStorage`
    into `secret.key.enc`, with the plaintext `secret.key` (0600) kept only as the no-vault
    fallback and deleted after the wrapped copy has been read back. An **optional passphrase**
    replaces that: setting one scrypt-wraps the key (N=2^15) into `secret.key.pass` at 0600 and
    deletes every copy the vault could open alone, so a locked database is never even opened —
    `storage.init()` refuses, the model still loads, and the app shows a full-screen lock gate.
    **Auto-lock** polls `powerMonitor.getSystemIdleTime()` every 20 s at 1/5/15/60 minutes and
    also fires on `suspend` and `lock-screen`; it is inert without a passphrase, and the picker
    says so by disabling those choices. Locking, unlocking and erasing all route through one
    path that closes the database (checkpointing the WAL), zeroes the in-memory key, empties the
    agent's decrypted turns and the model's chat context, and rebuilds the windows so no
    decrypted text survives in a renderer that already painted it. **Erase-all** needs the word
    `ERASE` typed, then deletes the database, the key in every form it exists in and the logs,
    and reopens an empty store with a fresh key. Turning encryption *off* is refused while a
    passphrase is set — the wrapped copy is then the only key, and dropping encryption would
    strand every stored row. Quick Ask refuses to answer while locked rather than replying from
    an empty context it cannot write to. Retention now runs on a six-hour timer as well as at
    launch, and `close()` folds the WAL back into the database. *(M)*
28. ✅ **Portability**: "Export backup" seals every chat, message, memory fact and the settings
    into one file with AES-256-GCM under scrypt(N=2^15, r=8, p=1) keyed by a passphrase typed for
    that file, so a backup is independent of the history key and can never reopen the database it
    came from. The file leaves as `openmonkey-export.1:salt:iv:tag:body`, written 0600 with a
    dated `.openmonkey-export` default name. "Import backup" merges instead of replacing: a chat
    whose id is already here is skipped, facts are deduped by their text, every body is re-sealed
    with the receiving install's key, and a blank row (unreadable where it was written) is dropped
    rather than restored as an empty bubble. Restoring settings is a separate opt-in that applies
    only the sections this build knows and cannot switch this machine's encryption off. The
    database stamps `PRAGMA user_version = 1` when it opens an unstamped file and refuses a backup
    written for a newer layout; open windows hear `local-data-changed` after an import. A short or
    wrong passphrase, a foreign JSON file and a file over 64 MB are refused with readable errors
    before anything is touched. *(M)*
29. ✅ **Diagnostics**: lines are appended synchronously and the log rotates at 2 MB keeping two
    older copies; message text never reaches it — `content`, `prompt` and `response` become their
    lengths at write time. Settings → Privacy → Diagnostics shows the tail in place and clears
    the file plus its rotations, so the clear itself is the first new line. One **network
    switch** covers every request the app makes on its own: off, model downloads and web fetches
    refuse with the page's wording and log `network.blocked`, while the local model and links
    handed to the user's browser keep working. An online/offline chip reads the renderer's
    connection state. No telemetry anywhere. *(S)*
30. ✅ **Privacy page truthfulness**: every switch enforces its claim while the app runs, not at
    the next launch. Turning encryption on or off re-encodes every sealed column — `messages`,
    `tasks`, `audit`, `memory_facts` — in one transaction, `VACUUM`s the file so no freed page
    still holds the old ciphertext, and reopens it under the new key; a failure rolls the rewrite
    back and restores the previous setting, and the switch is disabled while the rewrite is in
    flight. Save-history off writes nothing at all. Retention prunes at launch **and every six
    hours** on a timer, and the page says exactly that instead of "daily". The whole page — lede,
    history rows, key wording, lock picker, portability, diagnostics — is translated in EN and
    RU. *(S)*

**Phase 6 verification (27):** every step below ran against the real Electron app, on the real
profile, with `data/` and the config copied to `/tmp` first and restored afterwards. Cold boot
read the wrapped key from the macOS keychain and decrypted all 43 stored messages; setting the
passphrase left `secret.key.pass` (0600, 128 bytes) and removed `secret.key.enc`; the next cold
boot came up `keySource: "locked"` with the database unopened, `getConversations()` empty, the
model loaded to `ready`, and the lock gate on screen; a wrong passphrase cleared the field, set
`aria-invalid` and reported "That passphrase does not match" without unlocking; the right one
reopened the store with the 43 messages back in the chat. "Lock now" closed the database and left
no `-wal`/`-shm` beside it, which is the same `close()` that shutdown uses. Removing the
passphrase re-wrapped the key into the vault and the same 43 messages still decrypted, proving the
wrap → unwrap → re-wrap round trip kept the key; asking to switch encryption off in that state came
back with `encryptData: true` and a `privacy.encrypt.off.blocked` log line. Erase-all rejected `erase` ("Type ERASE to
confirm") with nothing deleted, then on `ERASE` shrank the database from 200 KB to 4 KB, wrote a
fresh key, deleted the log folder and kept logging into a new file; audit, facts and chats all
came back empty. **Not exercised:** the idle auto-lock timer and the sleep/`lock-screen` hooks —
`HIDIdleTime` was 0.002 s when checked, i.e. this Mac was in use, so the 60-second threshold never
arrived; the code paths are wired but unproven on a real sleep. A genuine ⌘Q quit was not driven
(the menu accelerator is unreachable from CDP), so the WAL fold is proven through `close()` on the
lock path rather than through shutdown. Log rotation itself is not yet exercised either — the 2 MB
threshold needs a long run.
`npm run typecheck` and `npm run build` are clean.

**Phase 6 verification (28):** the macOS save/open panels cannot be clicked from a debugger
without seizing the screen, so both IPC handlers were driven end to end — real SQLite database,
real config, real crypto — with only the dialog answer scripted. All ~30 assertions passed.
Export refused a 7-character passphrase *before* opening any panel; a cancelled panel came back
`cancelled: true` and wrote no file; the export wrote 0600, opened with the envelope header and
held no plaintext body. The receiving side then ran erase-all, which rotates the key; importing
into that empty database brought back the chat title, both bodies, timestamps, the attachment
name, the duration and the memory fact under the *new* key, told exactly one open window
`local-data-changed`, re-sealed the rows on disk with this machine's `enc:v1:` envelope and no
plaintext, and applied the file's 90-minute retention window while leaving the local
`encryptData` alone. A wrong passphrase, a plain-JSON file and a second import of the same file
each changed nothing. **The harness caught a real bug**: the writer emitted
`openmonkey-export.1.` with a trailing dot while the reader compared `openmonkey-export.1`, so
every backup would have been rejected as damaged — fixed with one shared header constant. In the
app, Settings → Privacy → Portability shows the passphrase field, both buttons disabled and "Use
at least 8 characters" until the eighth character, then enabled, with `backup format v1 ·
database layout v1` read from the live schema. **Not exercised:** a real click in the native
save/open panel (scripted instead), and the `user_version` stamp reaching the database *header* —
a freshly written pragma lives in the `-wal` until a checkpoint, so a clean ⌘Q quit is still the
proof owed. Localization note for item 30: the Portability controls are translated
(`Фраза для копии`, `Сохранить копию`, `Загрузить копию`) but the Privacy page's older rows and
its lede are hardcoded English.
`npm run typecheck` and `npm run build` are clean.

**Phase 6 verification (29):** a node harness drove the real logger, the web tool and the model
downloader, then the app was checked live. Redaction: a line carrying a 19/17/17-character
content, prompt and response wrote only `contentLength`, `promptLength`, `responseLength` — no
secret reached the file. Rotation: 6 000 lines (~5.8 MB) left the live file at 1.59 MB with
`openmonkey.log.1` and `.2` at 2.09 MB each and no `.3`. **The harness caught a second real
bug**: the first run ended with a 3.7 MB live file and *no* `.1` — a buffered `WriteStream` was
being renamed while its queued chunks were still flushing, so the byte counter and the file size
drifted apart. The logger now appends synchronously, and the same run lands on the numbers above.
`tail(5)` returned the five newest lines ending at `index: 5999`; `clear` emptied the file,
removed both rotations and the next line was `logs.cleared`. With the switch off the gate threw,
`fetch_page` was refused, and `download()` returned `phase: "error"` carrying the same sentence
without writing a `.part` file. In the app: the Diagnostics section renders, View log showed 29
lines, Clear left exactly `logs.cleared` with its notice, and the switch flipped the copy to the
"Off:" sentence; with it off the Model page's **Download** button reported "Network access is off
in Settings → Privacy → Diagnostics" and the log gained `network.blocked
{"reason":"model-download"}`; switched back on afterwards. **Not exercised:** the offline chip
under a genuine disconnection (it reads `navigator.onLine`; faking it would prove nothing about
the OS), and rotation under real app load — the burst test above is the proof.
`npm run typecheck` and `npm run build` are clean.

**Phase 6 verification (30):** a node harness drove the real `Storage` against a real SQLite file
and a real 0600 key file on disk; all 18 assertions passed. Encryption on → every body carries
`enc:v1:` and no plaintext body remains; off → every body is plaintext again and, after the
`VACUUM`, a byte scan of the file finds zero `enc:v1:` remnants (the first run found 142, which is
what put the `VACUUM` in); on again → sealed under a fresh key; a second process opening the same
file cold read the bodies back. Retention pruned a 100-day-old message and task and kept a fresh
one; with save-history off a new turn wrote no row. In the running app the switch flipped
mid-session: ON → keychain key, 175 sealed rows, no plaintext body on disk, 43 messages still in
the chat; OFF → 0 sealed rows, the body readable as plaintext, the same 43 messages still there;
ON again → keychain key and sealed rows back. No restart between any of them. The Privacy page
rendered fully in RU (0 leftover English row strings — `Фраза для копии`, the history rows, the
lock picker, the lede) and back in EN. **Not exercised:** the six-hour timer itself was not
waited for — pruning is proven through the launch path and an explicit `runRetention()`, and the
timer calls the same method. One double-click on the encryption switch raced the stale privacy
snapshot and landed as a single flip; the switch now disables itself while the rewrite is in
flight, which removes that window.
`npm run typecheck` and `npm run build` are clean.

---

## Phase 7 — Release engineering (P0 before public launch, ~2–3 weeks)

31. ✅ **Tests**: unit suites on `node:test` (no test-runner dependency) for the task-fence parser,
    tool-argument validation and its JSON Schema subset, the backup envelope, and the mood logo
    map; integration suites that bundle the real modules with a stubbed `electron` and drive a
    real SQLite file — encryption flipping and `VACUUM`, retention pruning, save-history off,
    export contents, approval gating (block, deny, remember, allow), path confinement including a
    symlink escape, and logger redaction/rotation/tail/clear. Playwright launches the built
    Electron app on a throwaway profile for e2e: onboarding, the chat surface with a button/
    image/field/landmark a11y audit, Settings → Privacy rows and switch names, the history switch,
    RU/EN round trip, close-to-tray, and a committed visual snapshot of the Privacy page.
    `npm test` runs unit + integration; `npm run test:e2e` builds and runs Playwright.
    The Bonsai gap is closed: a doubled closing brace in a task fence is repaired (and logged as
    `tasks.fence.repaired`) instead of failing as invalid JSON. *(L)*
    Still owed in a later pass: the approval dialog's Tab cycle and Escape path, which need a real
    model turn or an injected approval to open the dialog.
32. ✅ **CI/CD**: GitHub Actions on macOS arm64 + x64; typecheck, tests, build, package; signing
    with Developer ID, hardened runtime, notarization and stapling; Windows signing. *(L)*
33. ✅ **Auto-update**: `electron-updater` with GitHub Releases, staged rollout, rollback,
    migration-safe startup. *(M)*
34. ✅ **Performance budgets**: UI interactive < 2.5 s cold, no jank when streaming, settings
    lazy-loaded, memory ceiling documented, model load progress always visible. *(M)*
35. ✅ **Docs & launch**: README screenshots, privacy page, model compatibility table,
    troubleshooting, release notes, support channel. *(M)*

**Phase 7 verification (31):** `npm test` runs 34 unit and 20 integration assertions in under a
second; `npm run test:e2e` builds and runs 6 Playwright tests against the real Electron app in
about three seconds. The unit suites cover the fence parser (valid, doubled/tripled braces, braces
inside strings, unclosed fence with and without trailing prose), tool validation and the JSON
Schema subset, the backup envelope (round trip, wrong passphrase, tamper, newer version/layout,
field normalization, 64 MB cap) and the twelve moods. The integration suites run against a real
SQLite file under a throwaway `HOME`: encryption off leaves no `enc:v1:` anywhere in the file
after the `VACUUM`, back on re-seals, retention prunes a 100-day-old row, save-history off writes
nothing, an export carries plaintext bodies, path confinement rejects `/etc/hosts` and a symlink
that leaves `~/Documents`, approvals block/deny/remember/allow, and the logger redacts three
fields, rotates at 2 MB keeping `.1`/`.2`, tails five lines and clears its rotations. E2E launches
the built app with `OPENMONKEY_USER_DATA` pointed at a temporary profile (the only automation hook
in the main process, gated to unpackaged builds): onboarding renders, Skip setup reaches the
composer, the a11y audit finds no unnamed button/field/image or missing landmark, Privacy shows
three named switches, history flips off and on, RU renders with `lang="ru"` and back, and
`BrowserWindow.close()` with `closeToTray` on hides instead of destroying the window. The Privacy
snapshot is committed at `test/e2e/app.spec.mjs-snapshots/`. **Fixed while writing the suites:** the
approval tests were flaky because the fake `HOME` had no `Documents` folder and the shell tool
defaulted its cwd there — the runner now creates the three allowed folders up front. **Not
covered:** the approval dialog's Tab/Escape cycle (no model turn opens it), idle auto-lock, and
snapshot portability across machines (the baseline is this Mac's rendering).
`npm run typecheck` and `npm run build` are clean.

**Phase 7 verification (32):** `.github/workflows/ci.yml` has three jobs. `verify` runs on a
`macos-latest` (arm64) runner with Node 24 and npm cache: `npm ci`,
`npm run typecheck`, `npm test`, `npm run build`. `e2e` runs `npm run test:e2e` on the same
runner and
uploads `test-results/` and `playwright-report/` only on failure. `package` runs only for `v*` tags,
after `verify`, on both runners: it builds and calls
`electron-builder --mac --arm64|x64 --publish never`, reading `CSC_LINK`, `CSC_KEY_PASSWORD`,
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` from repository secrets, and uploads
`release/*.dmg` and `release/*.zip` for 14 days. Packaging config: output `release/`, resources
`build/`, `OpenMonkey-${version}-${arch}.${ext}`, GitHub `draft` publish, hardened runtime with
`build/entitlements.mac.plist` (JIT, unsigned executable memory, dyld env) for the app and its
helpers. The YAML and the plist parse; the workflow is syntactically valid. **Not exercised:** no
GitHub remote receives this repository yet, so no runner has executed the workflow; signing and
notarization cannot run without a Developer ID certificate, and the package job produces an
unsigned build when the secrets are absent. Windows signing is intentionally out of scope — the
product ships macOS builds.

**Phase 7 verification (33):** `src/main/updater.ts` wires `electron-updater` behind the same
`app.isPackaged` and `networkAllowed()` gates as every other outbound call. At launch (packaged
only) it sets `autoDownload`, `autoInstallOnAppQuit` and `allowDowngrade = false`, checks
immediately and then every six hours on an `unref`'d timer; `update-downloaded` shows a native
dialog with **Restart now** / **Later**. The channel comes from Settings → Desktop → Updates
(`desktop.updateChannel`, default `stable`): `stable` maps to the `latest` feed, `beta` to `beta`,
so prereleases are opt-in; the same choice can be made from the app menu (**Help → Check for
Updates…**, packaged builds only, which also triggers a manual check). Rollback is reinstalling an
older signed build — the updater never downgrades by itself — and startup stays migration-safe
because the database carries its schema stamp and encryption state before any feed is consulted.
E2E test 6 clicks **Desktop**, reads the channel row and hint, selects **Beta**, polls the config
through IPC for `"beta"`, selects **Stable** and polls for `"stable"`. All 7 e2e tests pass.
**Not exercised:** an actual download and install — the app under test is unpackaged, where the
updater intentionally does nothing, and no release feed exists yet; the beta feed likewise awaits
a published prerelease. `npm run typecheck` and `npm run build` are clean.

**Phase 7 verification (34):** `test/e2e/perf.spec.mjs` enforces the budgets against the built app.
Cold start — process spawn to the first interactive surface (onboarding), including Playwright's
launch overhead — measured **526, 487 and 559 ms** on three runs against a 2,500 ms budget. Idle
memory with no model loaded measured **455 MB** total across Browser (199), GPU (94), Utility (47)
and renderer (115) processes against a 900 MB ceiling; the model is resident in the main process, so
a 4B GGUF adds its file size and working set on top — the documented companion budget is 4 GB total
with one 4B model warm, which stays well inside an 8 GB Mac. A synthetic stream injected over the
real IPC channel (320 tokens at ~8 ms, 3.1 s) kept **0 long tasks** and a **17.7 ms maximum frame
gap** over 180 frames against a 120 ms frame budget; that path exercises the same renderer code as
a real reply. Settings is now a lazy chunk (132 kB) split out of the 780 kB entry bundle (down from
906 kB), and the perf test proves the chunk is requested only when Settings first opens. The model
load card now shows an elapsed-seconds counter beside the spinner, so a long load cannot look
frozen; the model-download card already reports a percentage progress bar. **Not exercised:** a
real Bonsai load and real token cadence — `models/Bonsai-4B-gguf/` is empty in this workspace and
the download was deliberately not repeated, so model-load duration and decode speed are unmeasured;
the synthetic stream proves the display path, not llama.cpp throughput. `npm run typecheck` and
`npm run build` are clean.

**Phase 7 verification (35):** the model is back on disk: `npm run download-models`
fetched 572,270,624 bytes and the pinned SHA-256 (`4524b3f9…e42168`) matched. The built
app then loaded it in about a second (`loading-model` → `ready`, `provider: "bonsai"`)
and answered "hello from Bonsai." in 4 s; measured working set with the model warm was
2,005 MB (main 1,703, GPU 102, helper 47, renderer 153), now the documented figure.
Documentation shipped: `README.md` gains a real chat hero, onboarding/Privacy/Desktop
screenshots captured from the app by `scripts/capture-docs.mjs`, current requirements,
the full script table with test commands, accurate privacy bullets, the expanded config
table and troubleshooting; `docs/PRIVACY.md` covers key storage, the passphrase lock,
retention, every outbound call, log redaction, erasing and what is not protected;
`docs/MODELS.md` states backend/platform/disk/memory compatibility and the pinned
hashes; `docs/SUPPORT.md` covers triage facts, common answers and the private
security-report path; `CHANGELOG.md` records 0.9.0 and its known limitations.
**Fixed while capturing:** every mood portrait was a rooted `/logos/…` URL, which
resolves to the disk root under `file://` in built and packaged builds — all renderer
asset paths now go through `logoUrl()` and are document-relative, and the e2e a11y
audit fails on any image whose `naturalWidth` is zero. The committed Privacy snapshot
was regenerated with the portraits loading. **Not covered:** screenshots are macOS
English only, and the signed/notarized artifacts and live update feed from items 32–33
still do not exist in this checkout. `npm run typecheck` and `npm run build` are clean.

**Phase 7 verification (31, second pass — model teardown):** quitting the app while a
model load was running aborted the process with SIGABRT. The macOS crash report shows
the cause: `AddonModelLoadModelWorker::Execute()` was still running on a libuv thread
while `node::Environment::CleanupHandles()` freed the JS context, so the addon
completed the worker into freed memory. The fix is not a bigger timeout but a real
drain: one shared tracker (`src/models/addon-work.ts`) now wraps every addon worker —
the load, the generation and the four GGUF inspection calls — and teardown waits for
them. A generation can be aborted (15 s budget); a load cannot, so it gets 90 s, and
the shutdown watchdog (150 s) was raised to outlast it, because a forced exit under a
live worker is the very crash being fixed. `SIGTERM`/`SIGINT` now run the same drain
instead of killing the process, which also preserves the WAL checkpoint that closes the
encrypted history. Four integration tests cover the contract (quit waits for a load it
cannot cancel, a failing load is still drained, the wait is bounded, a later load is
refused once quit began) and an e2e spec quits the app during a real load and asserts
exit code 0 with no signal. **A/B proof:** with the load wait removed and the abort
budget cut to 50 ms, that e2e spec failed and produced a 17th crash report with the
identical `CleanupHandles` / `ggml_uncaught_exception` signature; the experiment was
reverted and the suite rerun. The harness itself was the other half of the fix — the
e2e runner used to hard-kill a still-loading app, which is what produced the crash
reports in the first place, so every spec now quits through one waiting helper. Cold
start across the last full run measured 831–850 ms against a 2,500 ms budget, and the
run left **0 crash reports** in `~/Library/Logs/DiagnosticReports`.
`npm run typecheck` and `npm run build` are clean.

---

## Phase 8 — Commercial layer (only if you charge, P2)

The product-polish backlog that precedes pricing, with acceptance evidence and a
sprint order, is in [docs/PREMIUM.md](docs/PREMIUM.md).

36. **Licensing**: offline-verifiable license, trial, grace period, no phone-home by default.
37. **Update & support policy**: supported macOS versions, model deprecations, refund policy.
38. **Optional paid convenience** (hosted nothing): curated model packs, team policy templates,
    priority support — while the local core stays fully functional without an account.

---

## Suggested release slices

| Release | Steps | Promise |
| --- | --- | --- |
| **v1.0 (private beta)** | 0, 5, 6, 8, 12, 27 | Fresh install works; streaming chat; private by default |
| **v1.1** | 9, 10, 11, 13, 14, 22 | A chat app you use daily; approvals you can audit |
| **v1.2** | 7, 15–19, 24, 25 | Real tools, real extensions, polished desktop UX |
| **v2.0 (public)** | 20–21, 28–35 | Memory, signed/notarized builds, auto-update, tests and docs |

---

## Visual direction carried from the reference set

- **Keep:** warm paper background, single monospace family, hairlines over shadows, grouped
  settings navigation, green page titles derived from the accent, segmented controls,
  accent swatches, mood grid, composer card, right-hand task/command rail, onboarding wizard
  rhythm.
- **Do not replicate:** Gateway, Devices, Infrastructure, Skills — these describe a cloud
  product OpenMonkey is not. Their real equivalents are Permissions, Extensions (MCP) and
  Audit log, and they ship only when the functionality exists.
- **New surfaces follow the same grammar:** one accent variable, one card radius, one type
  scale, no new colors unless they carry meaning (danger, warning, success).

## Definition of "premium" (used as the acceptance bar)

1. Every state has loading, empty, error and retry — no dead ends.
2. Nothing is simulated: model, tools, permissions and storage all report the truth.
3. Keyboard-first, VoiceOver-clean, works in light and dark.
4. Instant UI; streaming feels alive; long tasks always show progress.
5. Trust is visible: approvals before side effects, an audit trail, and provable local storage.
6. One coherent visual voice across window, tray, Dock, onboarding and settings.
