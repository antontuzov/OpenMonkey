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

### What the weights cost, and how fast they answer

Settings → Model shows both of these before and after a load, and
`npm run benchmark-model` prints the same pair from the command line:

| Measurement | Bonsai-4B on this Mac |
| --- | --- |
| Weights | 566 MB |
| KV cache for a 4,096-token context | 1.29 GB |
| Total the estimate asks for | 1.85 GB system RAM, 0 MB VRAM |
| Context the file was trained on | 32,768 tokens |
| Generation speed, warm | 22.8–24.1 tokens/s |
| First token | 223–306 ms warm, ~2 s in a cold process |

The speed comes from the app's own benchmark: one fixed prompt, temperature 0, a
96-token cap, timed from the first token to the last so reading the prompt is not
counted. The same prompt wrote 78 tokens in 3.42 s. A cold `npm run benchmark-model`
run measured 13.3 tokens/s, because the weights are still being paged in while the
model writes; the 1.85 GB estimate lines up with the 2,005 MB loaded working set
above.

The MLX backend is measured the same way (its own streamed request, token counts from
`usage.completion_tokens`), so the two numbers are comparable — but no MLX install was
available on this Mac, so only the Bonsai column carries a recorded number.

![The measured run in Settings → Model](docs/screenshots/settings-model-benchmark.png)

## Not wired

Other GGUF files are not selectable in the UI, even if you place them on disk. The
loader reads `models/Bonsai-4B-gguf/Bonsai-4B.gguf` in development and the same
relative path inside userData in packaged builds. Support requests about third-party
weights are out of scope for 0.9.
