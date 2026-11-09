# Privacy

OpenMonkey is a local app. It has no account system, no telemetry, no analytics and no
remote API. Everything below describes what version 0.9 stores and what it sends.

## What stays on this Mac

- **Inference.** The model runs in the Electron main process (GGUF via
  `node-llama-cpp`) or in a local `mlx_lm.server` child process on Apple Silicon.
  Prompts and replies never leave the machine.
- **Conversations, tasks and audit rows.** Stored in `data/openmonkey.db` (SQLite,
  WAL mode) inside the app's userData directory:
  `~/Library/Application Support/openmonkey` in development,
  `~/Library/Application Support/OpenMonkey` in packaged builds.
- **Memory facts and summaries.** Same database, same encryption and retention rules.
- **Queued posts.** A post waiting to go out later is stored in the same database, with
  its text sealed like a message body. It does not travel in an exported backup: the
  post was approved on this Mac, and the credential it would need lives in this Mac's
  keychain.
- **Post drafts.** A post the agent wrote but has not sent is stored in the same
  database, with its text sealed like a message body. It does not travel in an exported
  backup either: it was never sent, it was written on this Mac, and the credential it
  would need lives in this Mac's keychain. A draft that has not gone out is never pruned
  by the retention timer — it is unsent work waiting for you — and it is removed as soon
  as it is sent or queued for later.
- **Logs.** `logs/openmonkey.log` in the same directory.
- **Attachments.** A file you attach is read locally and its text is sent to the local
  model; there is no upload.

## Encryption at rest

Message bodies, task records, audit rows, memory facts and the text of a queued post and
of a draft are sealed with AES-256-GCM
(`enc:v1:` envelope) when **Encrypt stored data** is on — the default.

- The 32-byte key is kept in the macOS Keychain through Electron `safeStorage`. On a
  system without a usable keychain the app falls back to `data/secret.key` with mode
  `0600`, and says so in Settings → Privacy.
- A **passphrase lock** wraps the key with scrypt (N=2¹⁵, r=8, p=1) and deletes every
  copy the app could open on its own, so the prompt is real. There is no recovery
  path: a forgotten passphrase means the history cannot be read. Export a sealed
  backup before enabling it.
- With the lock on, **Auto-lock** closes the database after the chosen idle period
  (the app polls every 20 seconds) and whenever this Mac sleeps or its screen locks.
- Turning encryption off rewrites every row as plaintext and `VACUUM`s the file, so
  the ciphertext does not linger in free pages. Turning it back on re-seals everything
  under a fresh key.

## Retention

**Auto-delete after** (7/30/90/365 days, default 30) prunes older messages, tasks and
audit rows at launch and every six hours while the app runs. A queued post that has not
gone out yet is never pruned — it is waiting for its time — and one that has gone out is
pruned with the rest. A post draft is never pruned for the same reason: it has not gone
out either, and it is waiting for you to send it or to queue it. With **Save conversation
history** off, a conversation lives only in memory for the current run and nothing is
written to disk. The Privacy page reports the actual state rather than a promise.

## What the app sends over the network

The app only makes a request when you ask for one:

| Action | Destination |
| --- | --- |
| Download Bonsai weights | `huggingface.co` (pinned revision, checksum verified) |
| Fetch a page through the Web tool | the URL shown in the approval dialog |
| Check for updates (installed builds) | GitHub Releases for this repository |
| MCP server you configured | whatever that server reaches |
| Open a link | your default browser, after you click it |
| Post to your own Telegram channel | `api.telegram.org` |
| Post to your own Reddit account | `www.reddit.com` / `oauth.reddit.com` |
| Post to your own Bluesky account | `bsky.social` |
| Post to your own Mastodon account | the instance you set in Settings → Publishing |
| Fetch a picture for a Bluesky or Mastodon post | the picture's own address |

The four publishing destinations carry the secret that belongs to them, and only to
them: the Telegram bot token, the Reddit script app and password, the Bluesky app
password and the Mastodon access token. Each of them lives in the macOS keychain,
never in the settings file, and the page shows only the last four characters of the
identifying field. A post goes to the target you set in Settings, never to a target
the model names.

A post the app sends on its own is a post you read and approved first. When a post is
queued for later, the app shows you the exact text, the channel and the time and waits
for your approval; when the time comes it sends exactly that text to that channel
without asking again. Nothing is sent that you did not see first, and a post whose
approval policy is Block is refused. A draft is the same promise in the other order:
the agent can write a post down, but it cannot send it. Only you can, from the page in
Settings → Publishing where the draft waits, and the wording you leave there is the
wording that goes out. The network switch below holds a queued post too:
with it off, the app waits and sends nothing until you turn it back on.

**Network access** in Settings → Privacy → Diagnostics is a hard switch for
app-initiated requests: model downloads, page fetches, update checks and MCP traffic
fail while it is off. Loopback to the local MLX server is not an internet request and
stays available.

## Logs

Logs rotate at 2 MB and keep two older copies. Conversation text, prompts and
responses are replaced by their lengths before anything reaches disk, so a log can say
which phase failed without reproducing what was said. **View log** and **Clear log**
live in Settings → Privacy → Diagnostics.

## Erase everything

**Erase everything** drops the database, the key in every form it exists and the logs.
Settings survive because they never hold conversation text. Erasing is immediate and
cannot be undone; export a backup first if the history matters.

## What this does not protect

- A user or process with access to your unlocked macOS session can read the database
  and the keychain item while the app is running.
- The model's output can repeat anything you typed; encryption at rest does not stop
  that.
- A backup file is only as private as its passphrase. It is sealed with scrypt
  (N=2¹⁵) and AES-256-GCM, and is capped at 64 MB.
- macOS may index files outside the app's control; the app itself does not.

## Verification

The privacy behaviour is covered by tests: encryption on/off cycles and the `VACUUM`,
retention pruning, save-history off, export contents, path confinement including a
symlink escape, log redaction/rotation, and the text of a queued post and of a draft
staying sealed in the database. See `ROADMAP.md` → Phase 7.
