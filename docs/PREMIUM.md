# Premium upgrade list

The 0.9.0 build is already a credible premium app: 12 mood portraits across window,
tray and Dock; encrypted local history with a Keychain key and passphrase lock;
approval-gated tools with an audit log; Quick Ask on Option+Space; full EN/RU; a
lazy-loaded settings shell; and enforced budgets (767 ms cold start, 597 MB idle,
zero long tasks in a 320-token stream). This list is what to do next to justify a
price, ordered by what a buyer notices first.

Effort: **S** ≈ a day, **M** ≈ a week, **L** ≈ two weeks or more (one developer).
Every item names the evidence that proves it, because "premium" that cannot be
shown is just a claim.

## P0 — the first ten minutes

What a trial user judges before they decide to pay.

| # | Upgrade | Done when | Effort |
| --- | --- | --- | --- |
| 1 | **Signed, notarized DMG and a live update feed** | `spctl -a -vv` accepts the DMG on a clean Mac; a packaged 0.9.0 install updates itself to 0.9.1 from the GitHub release feed | M |
| 2 | **Onboarding finishes the job** | Fresh profile → model downloaded (progress with MB, %, ETA, pause/cancel), checksum verified, disk-space precondition, or an existing GGUF imported → first reply, all without leaving the flow | L |
| 3 | **An empty state worth looking at** | Mood-aware greeting plus four starter prompts (read a folder, summarize clipboard, explain this code, plan my day) that prefill the composer; dismissed prompts stay dismissed | S |
| 4 | **Markdown that matches model output** | Lists, headings, tables, blockquotes, task lists and links render; fenced code gets syntax highlighting and a copy button; diffs render as diffs; streaming never reflows finished text | M |
| 5 | **Message-level actions** | Edit and resend, regenerate with a variant switcher, branch a conversation from any message, copy/quote; each reply shows its duration and token count | M |
| 6 | **Composer power** | Send on Enter or Cmd+Enter (setting), @file mentions, pasted images, several attachments, `/clear` and `/summarize`, and drop-to-attach with a real drop zone | M |
| 7 | **One command palette** | Cmd+K searches conversations, settings pages and actions with fuzzy matching; today it only jumps to chat search. Whole flow usable without a mouse | M |
| 8 | **Task monitor as a first-class surface** | Timeline with per-step durations, collapsible stdout, a diff preview for file writes, retry and copy; approvals keyboard-first and readable at a glance | M |
| 9 | **Model manager that builds confidence** | Download with speed/ETA, verify and delete, tokens-per-second benchmark per backend, memory estimate before load, automatic backend pick, warm-up badge | M |
| 10 | **Quick Ask grows up** | History of quick asks, a follow-up turn in place, "open in chat", and pinning; stays keyboard-only | S |
| 11 | **Window feel** | macOS sidebar vibrancy, unified title bar, 160–220 ms springs for panel and view changes, crossfade into settings, no light flash on dark-mode resize (guarded today) | M |
| 12 | **Settings that answer questions** | Search across all pages, reset-this-section, and a privacy dashboard: key source, database size, last prune, and a counter of network requests the app made | M |

## P1 — depth that earns the price

| # | Upgrade | Done when | Effort |
| --- | --- | --- | --- |
| 13 | **Memory browser** | Facts and summaries can be viewed, edited and deleted; a citation previews its source; recall can be toggled per conversation | M |
| 14 | **Workspace retrieval** | Source list with reindex, ignore rules, chunk preview, and citations that jump to the exact passage | M |
| 15 | **Richer tool previews** | Calendar/email cards show what will change, shell commands explain themselves, web fetches show the page, file writes show a reversible diff | L |
| 16 | **MCP manager UX** | Add/edit a server, see health and stderr, and set a per-tool policy without editing JSON | M |
| 17 | **Conversation organization** | Folders/tags, archive, saved searches, and bulk export of a selection | M |
| 18 | **Tabs and multi-window** | Several conversations in one window or separate windows, with window-state restore | M |
| 19 | **Offline voice** | Push-to-talk with a local whisper.cpp model and optional speech playback through `say`; nothing leaves the Mac | L |
| 20 | **Optional vision** | A small VLM GGUF, image paste/drop and OCR, behind a clear opt-in download | L |
| 21 | **Theming** | Accent palette, saved custom tokens, true-black OLED mode, per-theme density; contrast audited at AA | M |
| 22 | **Notifications with verbs** | Approve/deny from the notification itself, focus-mode awareness, quiet hours | S |
| 23 | **Update UX** | In-app release notes, staged rollout, rollback to the previous version, delta downloads | M |
| 24 | **Localization depth** | Reviewed RU copy, date/number formats, at least one more language, RTL-safe layout | M |
| 25 | **Chat performance at scale** | Virtualized history beyond 500 messages, incremental markdown parsing, idle memory trimmed, cold start under 400 ms | M |
| 26 | **Reliability tools** | Database integrity check with automatic backup/restore, safe mode, crash-safe stream resume, and a local crash-log viewer (no telemetry) | M |
| 27 | **Menu bar and Dock** | Recent conversations and quick actions in the tray, subtle mood animation, Dock recent documents | S |
| 28 | **Accessibility as a gate** | VoiceOver pass over chat, settings and approvals; focus traps in every dialog; usable at 200% zoom; contrast AA verified | M |

## P2 — commercial layer (Phase 8)

| # | Upgrade | Done when | Effort |
| --- | --- | --- | --- |
| 29 | **Offline license** | A signed license file unlocks the app; 14-day trial, grace period, optional device binding, no phone-home required | M |
| 30 | **Pricing page and checkout** | Merchant-of-record checkout (Paddle or Lemon Squeezy), clear local-first refund policy, license delivered by email | M |
| 31 | **Support that scales** | In-app ticket with an attached redacted diagnostics bundle, searchable docs, and an honest response-time policy | M |
| 32 | **Frictionless install** | Homebrew cask, a download page with checksums, and a one-line uninstall note | S |
| 33 | **Legal shelf** | EULA, privacy page (exists), security-report path (exists), refund and export-control statements linked from the app and site | S |
| 34 | **Founding-user program** | Beta channel entitlement, changelog feed in-app, and a named early-adopter perk | S |

## Shipped so far

Each item below carries the evidence the list asks for — a test, a capture, or a
recorded number — not a claim.

| # | Upgrade | Evidence |
| --- | --- | --- |
| 2 | Onboarding finishes the job | The model step offers both routes in — a download with MB, %, ETA and pause/cancel, or "Use a file I have" for a GGUF already on the Mac — and states the free space it needs before it asks for a byte. The digest is verified, then the flow asks the model one question and shows its own answer before it lets you out. 10 integration tests (a download against a Range server, resume, a wrong digest refused, a volume without room refused before any request reaches the server, an import that copies and keeps the original, a non-GGUF refused, a valid but unpinned model reported honestly, every phase reported as it happens), an e2e spec that reaches a real answer through the wizard, and a capture of the last step showing Bonsai-4B at 572 MB and the model's answer on screen |
| 3 | An empty state worth looking at | Four starter prompts that prefill the composer, and a dismissal that sticks across a reload — two e2e specs |
| 4 | Markdown that matches model output | 14 unit tests (parser, tokenizer, offset stability while streaming), an e2e spec per block, a region baseline and a docs capture |
| 5 | Message-level actions | 14 integration tests (variant groups, truncation, branching, token accounting), an e2e spec that walks the switcher, quotes, copies and branches, two docs captures; the reply on screen shows 3.4 s and 128 tokens |
| 6 | Composer power | Send on Enter or Cmd+Enter as a stored setting, @file mentions over the folders the app may read, up to eight attachments per message, `/clear` and `/summarize`, and a drop zone that takes files — 13 unit tests (prompt building, file search), 8 integration tests (attachments in the prompt and in the history, the upgrade of an old file, clear, summarize), 4 e2e specs and three docs captures |
| 7 | One command palette | Cmd+K opens a box that searches the chats, the settings pages and the commands with one fuzzy matcher, lands on the row it named and is driven from the keyboard alone — 11 unit tests (the matcher and its ranking), 4 e2e specs (open and close, a setting found by a hidden word, keyboard-only navigation, the Russian palette) and two docs captures |
| 8 | Task monitor as a first-class surface | Every task carries its stages with a time each (queued → approval → running), a collapsible output, a diff for file writes, Copy and Retry — one diff engine feeds both the approval preview and the rail, so the two cannot disagree. 14 unit tests (the diff and its context window, the stage maths and the duration format), 10 integration tests (a write reports its lines, an append reports the whole file, the timeline and the sealed change survive a restart, a failed task reruns from its own audit row), 3 e2e specs against the live model (a real write timed and diffed on the rail, a denied write keeping its approval stage and asking again on Retry, the Russian rail), one docs capture. The captured rail reads `done · 8ms · queued 1ms → running 4ms · Change (+2 / −0)` |
| 9 | Model manager that builds confidence | Memory estimate before the load, a tokens-per-second benchmark measured in the app (22.8 t/s on Bonsai-4B), backend pick and warm-up badge — e2e spec and a docs capture |
| 10 | Quick Ask grows up | History, pinned questions and "open in chat" — one e2e spec |
| 11 | Window feel | Material sidebar and spring timings on every panel, no light flash on a dark-mode resize — one e2e spec |
| 12 | Settings that answer questions | Cross-page search that types all 63 rendered row titles, reset-this-page, and a privacy dashboard that answers from the main process — three e2e specs and four docs captures |
| 13 | Memory browser | Settings → Memory is a two-pane browser over everything the agent knows: pinned facts and per-chat summaries can be searched, rewritten, deleted and forgotten, and recall is toggled per conversation. The digest the model derives always stays visible beside your own summary, so nothing the model sees is hidden from you. A citation in an answer is a chip that opens the source behind it — the fact, the chat summary or the exact file lines — and a deleted source says so instead of failing quietly. 6 unit tests (the citation pattern, its spans and the order it resolves in), 13 integration tests (a fact rewritten in place keeping its id, an empty fact refused, a summary replacing the digest, recall changing the prompt and not the note, forgetting dropping the summary and the flag, a chat excluded from its own prompt, a fact and a chat citation resolving, a file citation reading lines 4–16 around line 10, a file outside the allowed folders resolving to nothing), 2 e2e specs (the browser holding a fact and a chat and changing both, a citation opening its source) and a docs capture |

## Do not rebuild

These are already the premium signal and should be protected, not replaced: the
12-mood portrait system wired to window, tray and Dock; AES-256-GCM history with a
Keychain key, scrypt lock and auto-lock; per-tool approvals, "remember for session"
and the audit log; Quick Ask with inline approvals; full EN/RU with a real a11y
audit; the lazy settings chunk; the perf budgets and their tests. Any new feature
must keep the zero-telemetry, zero-network-by-default promise, and every list item
above needs a test, a capture, or a recorded number before it is called done.

## Suggested sequence

1. **Sprint 1 — trust and first run:** 1, 2, 9, 11, 12.
2. **Sprint 2 — chat depth:** 4, 5, 6, 7, 8, 10.
3. **Sprint 3 — brain depth and money:** 13, 14, 15, 16, 23, 29, 30, 31.
4. **Later:** voice, vision, tabs, extra languages.
