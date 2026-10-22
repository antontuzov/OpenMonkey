# OpenMonkey — Road to a Premium Local AI Agent

A step-by-step build plan, ordered by what a real user feels first. Every item is grounded in
OpenMonkey's actual architecture: Electron + React, a local GGUF / MLX model, encrypted SQLite,
and approval-gated tools. Nothing here is a mock screen.

---

## Where the app stands today

**Working end to end**

- Native Electron shell: hidden inset title bar, 1360 × 860 window, tray, Dock icon, single instance.
- Local model runtime: Bonsai-4B GGUF via node-llama-cpp, optional MLX server, provider switching.
- Chat: message history from encrypted SQLite, typing state, model error states, stop generation.
- Agent: file, web, shell, calendar/mail tools with per-action approval prompts and auto-execute.
- Appearance: light/dark/system, eight accents, 12 mood logos propagated to window, tray and Dock.
- Settings: Profile, Appearance, Approvals, Privacy, Model pages with search and real controls.
- Privacy: AES-256-GCM rows, key file mode 0600, path confinement, local-only by default.
- Build: typecheck + production build pass; macOS/Windows packaging configured.

**Known gaps**

- No first-run onboarding; a new user lands in chat with no model and no guidance.
- Model download is a terminal script, not an app flow.
- Responses arrive all at once; no streaming, regenerate or edit.
- One conversation thread ("Main Session"); no session list, search or rename.
- No memory, no MCP/extension system.
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

## Phase 1 — First run that earns trust (P0, ~1.5 weeks)

5. **Onboarding wizard** (the reference wizard, rebuilt for real features only):
   Welcome → Profile (name, accent) → Workspace folders → Model setup → Ready. Persist an
   `onboarded` flag; allow resume and "Skip for now". *(M)*
   *Done when a fresh `userData` completes the wizard without a terminal and lands in chat.*
6. **Model Manager UI**: catalog for Bonsai GGUF (and any local MLX endpoint), download with
   progress/resume/checksum, disk usage, delete, tok/s benchmark, RAM-based recommendation,
   context size, GPU layer count. First-run download lives here. *(L)*
   *Done when a user can go from zero to a loaded model inside the app, with cancel and retry.*
7. **macOS permissions page**: Automation (Calendar/Mail) and Notifications status with deep
   links via `x-apple.systempreferences:`, re-check button, explanation of each grant. *(M)*
   *Done when the page reflects changes without restarting the app.*

---

## Phase 2 — Chat people want to live in (P0, ~2 weeks)

8. **Streaming + control**: token streaming over IPC, stop mid-stream, regenerate, edit and
   resend, persist partials safely on quit. *(L)*
   *Done when first token appears under ~1 s after model load and Stop leaves a clean message.*
9. **Message craft**: Markdown, syntax-highlighted code with copy, tables, link policy, token
   and duration meta, message actions (copy/retry/delete). *(M)*
10. **Sessions**: auto-title from the first message, rename, pin, archive, delete, full-text
    search over decrypted history, migrate the existing thread. *(L)*
    *Done when the sidebar SESSIONS group is real, searchable and keyboard navigable.*
11. **Composer upgrades**: drafts per session, drag-and-drop text files, attachment chips with
    size limits, slash commands (`/file`, `/web`, `/shell`), Cmd+Enter send, Shift+Enter newline. *(M)*
12. **Failure UX**: model OOM, context overflow, tool denied, offline, corrupt DB — each with a
    specific message and a working fix button. *(S)*

---

## Phase 3 — Agent v2: capability with guardrails (P1, ~3 weeks)

13. **Tool protocol hardening**: JSON-schema validation, per-tool timeouts, observation
    truncation, retry with backoff, multi-step plan shown before execution. *(M)*
14. **Approval center**: per-tool/per-action policies, "remember for this session", dry-run
    preview (diff for files, command preview for shell), queue for concurrent requests,
    in-app audit log with export. *(M)*
15. **Files v2**: workspace folder picker in-app, tree browser, diff before write, move to
    Trash instead of delete, file watch, symlink resolution tests. *(M)*
16. **Shell v2**: PTY with live output in the task rail, cwd/env display, kill button,
    output caps, per-command approval. *(M)*
17. **Web v2**: readability extraction, search with attribution, caching, robots.txt, rate
    limits, "open in browser" stays the only mutating action. *(M)*
18. **Calendar & mail v2**: TCC flow, draft preview, explicit send confirmation, account
    selection, AppleScript timeouts and graceful failure. *(M)*
19. **Extensions (MCP)**: local stdio server registry, tool discovery, per-server approvals,
    health status, enable/disable. Only ship the Settings page once real servers work. *(L)*

---

## Phase 4 — Local memory (P1, ~2 weeks)

20. **Conversation memory**: rolling summaries + pinned facts, injected with citations;
    "what do you remember?" page to view and delete entries. *(L)*
21. **Local RAG**: `sqlite-vec` + a small local embedding model, index workspace documents on
    demand, retrieve with sources, hard size limits, full opt-out. *(L)*
    *Done when answers cite file + line and disabling memory removes all derived data.*

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
