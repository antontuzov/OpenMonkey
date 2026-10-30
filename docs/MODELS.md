# Models

OpenMonkey ships one wired, checksum-pinned model and one optional Apple Silicon
backend. Nothing is fetched at install time; `npm run download-models` does it on
demand.

## Compatibility

| Model | Backend | Platforms | Disk | Memory | Status |
| --- | --- | --- | --- | --- | --- |
| **Bonsai-4B** (`prism-ml/Bonsai-4B-gguf`, `Bonsai-4B.gguf`) | `node-llama-cpp` (GGUF) | macOS Apple Silicon + Intel, Windows | 572,270,624 bytes (~546 MiB) | measured 1.7 GB in the main process plus 0.3 GB of GPU/utility/renderer helpers (2.0 GB total) | Default, tested |
| **Virtuoso-Lite 8-bit MLX** (`arcee-ai/Virtuoso-Lite-8bit-mlx`) | `mlx_lm.server` (Python) | macOS on Apple Silicon only | snapshot size on Hugging Face | loaded by the Python server | Optional, hides itself when unavailable |

The GGUF entry pins its revision (`78f2c2ba…`) and SHA-256
(`4524b3f9…e42168`) in `src/models/catalog.ts`, so a download is reproducible and the
file is deleted if the checksum does not match.

## Requirements per backend

- **GGUF** — nothing beyond Node/Electron; `better-sqlite3` is the only native
  rebuild. The model loads into the main process, so its memory counts against the
  app's main process.
- **MLX** — Apple Silicon, `python3 -m pip install huggingface_hub mlx-lm`, and the
  snapshot from `npm run download-models -- --mlx`. The app starts
  `python3 -m mlx_lm.server` on port 8080 (or the next free port) and talks to it on
  loopback. Settings → Model hides the option while either piece is missing.

## Memory and startup budget

Measured on this Mac with the built app (see `ROADMAP.md`, Phase 7):

| State | Working set |
| --- | --- |
| Shell only, onboarding, no model | 455 MB total — main 199, GPU 94, helper 47, renderer 115 |
| Model loaded and ready | 2,005 MB total — main 1,703, GPU 102, helper 47, renderer 153 |

Load time on this Mac was about a second; a first reply took 3.7 s. Cold start to the
first interactive surface measured 487–559 ms across runs against a 2,500 ms budget. A
model load has no percentage to report from `llama.cpp`, so the chat shows an
elapsed-seconds counter beside the spinner; the download, by contrast, reports real
percentage progress.

## Not wired

Other GGUF files are not selectable in the UI, even if you place them on disk. The
loader reads `models/Bonsai-4B-gguf/Bonsai-4B.gguf` in development and the same
relative path inside userData in packaged builds. Support requests about third-party
weights are out of scope for 0.9.
