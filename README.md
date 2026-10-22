# OpenMonkey

A local-only AI agent for your desktop. It runs a small language model on your own
machine, talks through a chat window, shows its working in a live task monitor, and
expresses how a conversation is going through 12 ape portrait moods that update the
window, the menu bar tray and the Dock icon at the same time.

Nothing leaves the computer. There is no account, no telemetry, no API key and no
network call except the ones you explicitly ask the agent to make.

## Requirements

| | |
| --- | --- |
| OS | macOS or Windows 10+; the GGUF backend runs on both Apple Silicon and Intel |
| Runtime | Node.js 22.12 or newer (Electron 45's `engines` requirement) |
| Disk | ~600 MB for the model weights |
| Memory | ~2 GB resident once the model is loaded (measured against Bonsai-4B GGUF: 1.6 GB in the main process plus ~400 MB of helpers) |

## Get started

```bash
npm install          # also runs electron-rebuild for better-sqlite3
npm run download-models
npm run dev
```

`npm install` compiles `better-sqlite3` against Electron's ABI through the
`postinstall` hook. If you change Electron versions, re-run `npm run rebuild`.

`npm run download-models` fetches `prism-ml/Bonsai-4B-gguf` (~572 MB) into
`models/Bonsai-4B-gguf/Bonsai-4B.gguf`, verifies it against the repo's
`SHA256SUMS` when published, and deletes the file if the checksum mismatches.
It prints the sha256 of what it downloaded. Pass `--mlx` to additionally snapshot
`arcee-ai/Virtuoso-Lite-8bit-mlx` for the Apple Silicon backend (needs
`python3 -m pip install huggingface_hub mlx-lm`); without the flag it is skipped.

The first launch loads the weights into memory, so the window shows a "Loading the
local model" card for a few seconds before the composer becomes active.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | electron-vite dev server with hot reload |
| `npm run build` | Production bundles for main, preload and renderer |
| `npm run typecheck` | Checks both TypeScript programs (node + web) |
| `npm run download-models` | Fetches model weights (`--mlx` for the MLX snapshot) |
| `npm run rebuild` | Rebuilds `better-sqlite3` for the Electron ABI |
| `npm run package:mac` | `build` + electron-builder DMG/zip |
| `npm run package:win` | `build` + electron-builder NSIS installer |

## How it is laid out

```
src/main/       Electron host: window, tray, IPC handlers, sandboxed preload
src/agent/      OpenMonkey core: prompt loop, mood detection, tool dispatch
src/agent/tools FileSystemTools, WebBrowserTools, ShellTools, CalendarEmailTools
src/models/     ModelManager → BonsaiGGUF (node-llama-cpp) or MLXServer
src/ui/         LogoManager (mood → icons), mood-detector, task-emojis
src/renderer/   React UI: chat, settings, task monitor, styles
src/utils/      config (electron-store), storage (SQLite + AES-GCM), logger, types
assets/logos/   12 circular 512px mood portraits, sliced from the art sheet
scripts/        download-models.ts, crop-logos.py
```

The renderer and the main process never import each other's runtime code. They
share `src/utils/types.ts`, and everything else crosses the bridge through the
`window.electron` API that `src/main/preload.ts` exposes on a context-isolated,
sandboxed preload. Every subscription the renderer registers returns an
unsubscribe function, so views do not leak listeners.

`node-llama-cpp` is ESM with top-level await, so the CommonJS main bundle loads it
lazily with a dynamic import rather than a static `require`.

## The 12 moods

The agent infers a mood from the conversation and from its own replies. One
`setCurrentMood` call propagates to the tray icon, the Dock icon, the chat avatar,
the accent ring and the settings grid, and the chosen mood is persisted so the next
launch starts where you left it. Use **Cycle mood** in the sidebar to override it
manually.

`happy`, `neutral`, `angry`, `shocked`, `silly`, `cool`, `love`, `tired`,
`thinking`, `excited`, `calm`, `smile`

## Privacy and approvals

- Chat history and tasks live in `data/openmonkey.db` (SQLite) inside the app's
  userData directory: `~/Library/Application Support/openmonkey` in development and
  `~/Library/Application Support/OpenMonkey` once packaged.
- Message text is sealed with AES-256-GCM. The key is a random 32-byte secret in
  `data/secret.key`, written with mode `0600` on first run. Turning off
  **Encrypt stored data** in Settings → Privacy stores plaintext instead.
- `privacy.autoDeleteAfter` (7/30/90/365 days) prunes old rows on launch.
- The filesystem tool refuses any path outside `Documents`, `Downloads`, `Desktop`
  and the app's own data directory, and it caps reads at 256 KB.
- Tool actions need approval by default. Until **Run tool actions without asking**
  is switched on in Settings → Identity & approvals, every call — file write, shell
  command, web fetch, calendar or email action — stops at a dialog showing the tool
  and its arguments, with **Deny** / **Allow once**.
- The network is not reachable from the renderer: packaged builds get a
  `default-src 'self'` CSP with `connect-src 'none'`, applied in
  `onHeadersReceived`. Model inference happens in the main process.
- Logs are appended to `logs/openmonkey.log` in the userData directory.

## Configuration

Defaults live in `src/utils/config.ts` and are stored by electron-store under
`openmonkey-config`. Edit through Settings; the file is a plain JSON document in
userData if you prefer to change it directly.

| Key | Default | |
| --- | --- | --- |
| `model.provider` | `bonsai` | `bonsai` or `mlx` (MLX is Apple Silicon only) |
| `model.temperature` | `0.7` | 0 – 1.5 |
| `model.maxTokens` | `2048` | |
| `agent.name` | `OpenMonkey` | |
| `agent.personality` | `helpful` | |
| `agent.autoExecuteTasks` | `false` | Skips the approval dialog |
| `privacy.saveHistory` | `true` | |
| `privacy.encryptData` | `true` | |
| `privacy.autoDeleteAfter` | `30` | Days |
| `ui.currentMood` | `neutral` | |

## Troubleshooting

**"No model loaded" card on launch.** Run `npm run download-models`. Settings →
Model shows which backends it found; the GGUF path is
`models/Bonsai-4B-gguf/Bonsai-4B.gguf` in development and inside userData in
packaged builds.

**`better-sqlite3` threw `NODE_MODULE_VERSION` mismatch.** `npm run rebuild`.

**MLX backend unavailable.** The MLX snapshot plus `mlx-lm` are optional and only
work on Apple Silicon; the backend selector hides the option when either is missing.

**Want to watch the agent's internals.** `OPENMONKEY_DEVTOOLS=1 npm run dev` opens
DevTools; the packaged build stays closed. `OPENMONKEY_VERBOSE=1` also prints each
log line to the console, not only to `logs/openmonkey.log`.

## License

MIT — see [LICENSE](LICENSE).
