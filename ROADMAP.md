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
- Agent v2: schema-validated tool registry, Ask/Allow/Block per tool, session approvals,
  diff/shell/draft previews, encrypted audit log with export, symlink-safe workspace roots,
  live shell output with kill, Trash deletes.
- Extensions: local stdio MCP servers with discovery, per-server approvals, health, restart,
  enable/disable and JSON-Schema-checked arguments.
- Memory: encrypted pinned facts, extractive cross-chat digests, an opt-in in-memory lexical
  workspace index, automatic retrieval plus a `memory.search_workspace` tool, and grounded
  `[file:<path>:<line>]` / `[fact:<id>]` citations. Settings → Memory exposes facts, digests,
  index status, rebuild/clear/search and a full opt-out.
- Appearance: light/dark/system, eight accents, 12 mood logos propagated to window, tray and Dock.
- Settings: Profile, Appearance, Approvals, Workspace, Privacy, Model and MCP servers pages
  with search and real controls.
- Privacy: AES-256-GCM rows, key file mode 0600, path confinement, local-only by default;
  the app's data folder is not a tool workspace root.
- Build: typecheck + production build pass; macOS/Windows packaging configured.

**Known gaps**

- Edit-and-resend, slash commands, tables and true FTS are deferred (see Phase 2 notes).
- MLX streaming is implemented but untested — MLX is not installed on this machine.
- Memory digests are extractive (recent messages and last answers), not model-written rolling
  summaries. Workspace search is lexical and lives only in RAM — no sqlite-vec, no embedding
  model, no persisted index, and the 4B model still mis-selects tools on some workspace turns.
  Automatic retrieval only triggers for messages containing workspace/file/folder/project-style
  words; lexical scoring can surface an irrelevant passage, so citations are grounded against
  the retrieved blocks rather than trusted from the model.
- MCP is local stdio only — no HTTP/SSE transport, OAuth or auto-install. Shell execution is
  piped, not a PTY, so interactive/TUI programs do not work. No tool retry or plan preview.
- Calendar/mail live paths are untested here to avoid new macOS Automation prompts.
- The 4B model frequently emits malformed task JSON; validation rejects it and shows a failed
  task instead of guessing at the intended call.
- No signed builds or auto-update.

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
    columns cannot be indexed on disk); archive is deferred. *(L)*
11. ✅ **Composer upgrades (core)**: per-session drafts, drag-and-drop text attachments with
    extension allowlist, NUL-byte rejection and a 256 KB cap, native file picker through IPC,
    attachment chips, Enter sends, Shift+Enter newline. Slash commands are deferred to the
    Agent v2 command surface. *(M)*
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

## Phase 5 — Desktop premium (P1, ~2 weeks)

22. **Quick Ask**: menu-bar popover + global shortcut (⌥Space), runs the same agent, approvals
    appear without opening the main window. *(M)*
23. **Desktop citizenship**: launch at login, window state restore, native menu with real
    commands, notifications for approvals/done, Dock badging, close-to-tray preference. *(M)*
24. **Appearance v2**: theme preview cards (from the reference), text size S/M/L, density,
    custom accent with WCAG contrast check, animated mood transitions honoring Reduce Motion. *(M)*
25. **Accessibility & i18n**: full keyboard map, focus traps, ARIA labels, VoiceOver pass,
    EN/RU strings with locale dates. *(L)*
26. **Micro-interactions**: streaming caret, skeleton loaders, toasts instead of modals for
    success, inline task progress, no sound by default. *(S)*

---

## Phase 6 — Privacy you can prove (P0, ~1 week)

27. **Secrets & locking**: move the encryption key to Keychain (`safeStorage`), optional
    passphrase, auto-lock, lock on sleep, erase-all with confirmation. *(M)*
28. **Portability**: encrypted export/import of sessions, memory and settings; DB schema
    versioning and migrations; WAL checkpoint on quit. *(M)*
29. **Diagnostics**: rotating local logs with redaction, view/clear UI, offline indicator and
    a deny-all-network switch. No telemetry by default. *(S)*
30. **Privacy page truthfulness**: every toggle enforces its claim (save history, encryption,
    retention run daily, not only at launch). *(S)*

---

## Phase 7 — Release engineering (P0 before public launch, ~2–3 weeks)

31. **Tests**: unit (path confinement, approval gating, crypto, mood mapping), integration
    (IPC contract), e2e (Playwright + Electron), visual snapshots of chat/settings, a11y
    checks. *(L)*
32. **CI/CD**: GitHub Actions on macOS arm64 + x64; typecheck, tests, build, package; signing
    with Developer ID, hardened runtime, notarization and stapling; Windows signing. *(L)*
33. **Auto-update**: `electron-updater` with GitHub Releases, staged rollout, rollback,
    migration-safe startup. *(M)*
34. **Performance budgets**: UI interactive < 2.5 s cold, no jank when streaming, settings
    lazy-loaded, memory ceiling documented, model load progress always visible. *(M)*
35. **Docs & launch**: README screenshots, privacy page, model compatibility table,
    troubleshooting, release notes, support channel. *(M)*

---

## Phase 8 — Commercial layer (only if you charge, P2)

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
