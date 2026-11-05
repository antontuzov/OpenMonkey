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

| 1 | **A download a stranger can use** | Tag pipeline publishes a public GitHub Release with the `.dmg`; the landing page and README link it with permanent URLs; SHA-256 of every file is in the notes; `latest-mac.yml` is published beside it so a signed build can update itself the moment a Developer ID exists | M |

**Still outside row 1:** Developer ID signing and notarization. Apple retired the Intel
runner, so the release is Apple Silicon only, and the build is unsigned: Gatekeeper
questions the first launch, and Squirrel.Mac refuses to install an update over an
unsigned app. Both need the paid certificate; the pipeline reads the five Apple secrets
and needs no other change.

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
| 1 | A download a stranger can use | A tag now produces a public GitHub Release rather than a build artifact that expires in two weeks. `OpenMonkey-arm64.dmg` keeps its name across versions, so `…/releases/latest/download/…` is a link the site can hard-code and a bookmark can keep. `latest-mac.yml` is rebuilt from the bytes about to be uploaded, not carried out of a build job. Proved against a real 202,711,693-byte DMG: the manifest generator's SHA-512 and size match electron-builder's own output exactly, 5 unit tests on the generator (both arches, one arch, base64 rather than hex, and three refusals), 6 more that fail if the landing link, the release notes and the publish step ever stop agreeing with `artifactName`. The site is live on GitHub Pages, and its download cards were read back from the rendered DOM in both languages. |
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
| 14 | Workspace retrieval | The index is no longer a black box: Settings → Memory lists every file it holds, shows the passages it cut from the one you pick, and reads a file again on its own when you ask. Ignore rules keep files out — a name like `secrets` at any depth, a path like `docs/private` with everything in it, `*.log` for a suffix, `**` to cross folders — and the count says how many files they kept out. A citation in an answer now jumps to the exact passage the index holds and marks the line it names. 7 unit tests (the rule patterns, what a wildcard does and does not cross), 11 integration tests (the source list, the passage preview, a rule keeping a file out, a rule keeping a folder out, a folder reachable through two roots counted once, a file read again on its own, a file that is gone leaving the index, a file outside the allowed folders refused, a citation jumping to the indexed passage, a citation to a file that was never indexed still reading the lines around it) and an e2e spec that builds the index, reads a passage, keeps a file out with a rule and reindexes one file, plus a docs capture |
| 15 | Richer tool previews | The approval is no longer a wall of JSON: before anything runs, the card says what the tool will do. A shell command reads itself back in words — "runs chmod, which changes who may use a file" — and says what it could cost ("makes a file readable and writable by everyone") before you allow it; a file write shows the lines it replaces, from the same diff engine the task rail uses, so the two cannot disagree; a web fetch shows the page it will read, read the same way the tool reads it; a calendar event and a mail draft list the fields they will create, and the draft says plainly that nothing is sent. 11 unit tests (the command explainer: a known command, a subcommand, a pipeline, a program behind a path, an env prefix, an unknown command, a plain command with no risks, sudo, a piped download, a forced push and a hard reset, the same risk reported once), 12 integration tests (a write showing the replaced lines, a new file showing what will be created, an append showing only the new lines, a delete saying it can be put back, a move showing the destination, a shell explaining itself, a risky shell flagging two risks, a calendar event's fields, a mail draft with its body and "nothing is sent", a page preview showing the page, an unreadable page still showing the address, an MCP call naming the server and the tool), 2 e2e specs against the live model (a command saying what it does and what it could cost, a write showing the lines it replaces) and two docs captures |
| 16 | MCP manager UX | Settings → MCP servers is managed without opening the config file: a server is added **and edited** from the form, its health reads starting / ready / error with the reason beside it, and whatever it printed on stderr is on the page instead of only in a log file. Each tool gets its own Ask / Allow / Block rule next to the server's — a tool follows the server until you give it a rule of its own, and choosing the server's answer clears the override instead of storing a duplicate. A rule that only changes who may call what no longer restarts the process, and a rule to Block is a hard stop even with the master switch on. The page re-reads health while it is open, so a server that dies is visible without leaving Settings. 6 integration tests against a real stdio MCP server (a server starting and listing its tools, its stderr kept, a tool rule that leaves the process running — proved by its start banner appearing once, a rule for a server that is not there answering nothing, a server that cannot start saying why, a call reaching the tool, a disabled server refusing to be called), 2 e2e specs (health, output and a per-tool rule that survives a window reload; a failing server edited back to ready) and a docs capture |
| 18 | Tabs and multi-window | Several chats are open in one window at once, each keeping its own thread, and the set comes back with the window. A tab is a change of view, not of chat: the model follows the question when it is sent, so an answer running in one tab is never filed under another, and the tab in front waits its turn with the composer saying "Another chat is still answering." The open chats and the one in front are part of the window state, so a reload brings them back as they were. Closing a tab leaves the chat in the history. 7 e2e specs (a second chat opening as a tab beside the first, each tab keeping its own conversation, the tab that is answering saying so, the open chats coming back with the window, a second tab waiting while the answer runs, an answer surviving a switch to another tab, and closing a tab leaving the chat in the history) and a docs capture |
| 22 | Notifications with verbs | The macOS banner that asks for an approval now carries **Allow** and **Deny**, so the answer can come from the banner instead of the window; the dialog that was waiting closes by itself, in the main window and in Quick Ask alike. The buttons are a choice in Settings → Desktop, and macOS is named as the one that has the last word on whether a banner shows actions at all. Quiet hours keep the app quiet overnight while the Dock badge still counts what waits. A window that is already in front still gets no banner. 12 headless tests (the banner carries both verbs, Allow answers with a yes, Deny with a no, the verbs stay away when turned off, a focused window gets no banner, quiet hours silence it and the morning brings it back) and 5 more on the hours themselves, including a window that runs past midnight |
| 25 | Chat performance at scale | The chat panel mounts only the messages near the reader and stands the rest in as the space they would take: a history of six hundred messages mounts fewer than sixty message bodies, while the scroll height still covers all six hundred, and scrolling to the middle moves the window there rather than building the lot. Each message is measured as it appears, so the space is its real height, and the message the reader was on is put back where it was. Markdown is parsed while the answer is still arriving — only the unfinished tail is parsed again — and a message reopened from the history is parsed once into a bounded cache. 7 headless tests on the window maths (an empty chat mounts nothing, five hundred messages mount a screenful, the pads add up to the whole list, a measured height beats the guess, a reader in the middle gets the messages around them) and 7 on the parser (finished blocks keep their identity, the incremental parse matches a full one, a replaced answer, an open fence and a growing quote are parsed again), plus an end-to-end spec that measures the mounted count and the scroll height against a real window |

Row 25 also asks for trimmed idle memory and a cold start under 400 ms. The idle memory
is measured on every end-to-end run against a ceiling of 900 MB. The 400 ms is not
claimed: the same suite holds the app to reaching its first surface inside 2,500 ms on a
CI runner, and a desktop figure has not been measured yet.

## Do not rebuild

These are already the premium signal and should be protected, not replaced: the
12-mood portrait system wired to window, tray and Dock; AES-256-GCM history with a
Keychain key, scrypt lock and auto-lock; per-tool approvals, "remember for session"
and the audit log; Quick Ask with inline approvals; full EN/RU with a real a11y
audit; the lazy settings chunk; the perf budgets and their tests. Any new feature
must keep the zero-telemetry, zero-network-by-default promise, and every list item
above needs a test, a capture, or a recorded number before it is called done.

## Suggested sequence

1. **Sprint 1 — trust and first run:** 2, 9, 11, 12.
2. **Sprint 2 — chat depth:** 4, 5, 6, 7, 8, 10.
3. **Sprint 3 — brain depth and money:** 13, 14, 15, 16, 23, 29, 30, 31.
4. **Later:** voice, vision, extra languages.
