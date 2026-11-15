# Support

OpenMonkey is a local desktop app, so most reports need the same three facts before
anyone can reproduce them. The project tracks bugs and feature requests in GitHub
Issues on the repository linked from **Help → OpenMonkey on GitHub** in the app.

## Reporting from inside the app

Settings → Support does the slow part of a report for you, and it sends nothing.

- **This Mac** says the version, the macOS release and the architecture, so the three
  facts every report needs are already on screen.
- **Save diagnostics** writes `openmonkey-diagnostics-<date>.json` wherever you choose,
  with mode `0600`. It holds the app version, the privacy state, the loaded model, the
  MCP servers (name, state and tool count — never a command, an argument or an
  environment variable) and the last 500 log lines. It holds no conversation, no
  prompt, no key and no publishing credential.
- **Open a ticket** opens GitHub's own issue form with the version, the three
  questions and the note about the diagnostics file already written into it. Nothing
  is sent: the browser opens a page, you read it, you attach the file, you press the
  button.
- **Search the docs** finds the heading that answers your question in this
  repository and opens it on GitHub. The index covers this page, the model notes, the
  privacy page, the legal shelf and the security policy.
- **Response time** says what a small project can promise: a week for a bug or a
  crash, a reply within a week for a question or a feature request, and a note
  saying why not when the answer is no.

The support policy below is the same text as the **Response time** card, and the
private security path is the one in [SECURITY.md](../SECURITY.md).

## Before you report

1. **Version and OS.** The version sits at the bottom of Settings → Profile and on the
   onboarding footer (`OpenMonkey 0.9 · macOS`). Include the macOS version and whether
   the Mac is Apple Silicon or Intel. Settings → Support shows all three at once.
2. **What you did, what you expected, what happened.** A short numbered list is more
   useful than a screenshot of the end state. **Open a ticket** writes those three
   headings for you.
3. **Log lines.** Settings → Privacy → Diagnostics → **View log** shows the same entries
   as `logs/openmonkey.log`. Copy the lines around the failure. Conversation text,
   prompts and responses are never written there, so the file is safe to paste. **Save
   diagnostics** in Settings → Support writes the same tail into a JSON file, with the
   rest of the state beside it.

Never paste your passphrase, a backup file, or the contents of `data/secret.key`.

## Common answers

- **No model loaded.** Run `npm run download-models` in a development checkout, or
  open Settings → Model and use **Download** in an installed build. `docs/MODELS.md`
  lists paths and sizes.
- **Gatekeeper blocked the app.** Neither a tagged release nor a local
  `electron-builder` build carries an Apple Developer ID — the package job signs and
  notarizes only when the repository has the Apple secrets, and it does not. Clear
  quarantine once:
  `xattr -dr com.apple.quarantine /Applications/OpenMonkey.app`.
- **The updater never installs anything.** The updater only runs in a packaged app, and
  only when **Network access** is on. Installed builds check at launch and every six
  hours; the channel lives in Settings → Desktop → Updates. A Developer ID-signed build
  downloads its update and asks before restarting; an unsigned build only names the new
  version and opens its release page, so install the `.dmg` from there over the old app.
- **I forgot the passphrase.** There is no recovery by design. **Erase everything** in
  Settings → Privacy deletes the database and the key; the chat history cannot be
  decrypted without the passphrase.
- **A tool wants approval every time.** Turn on **Remember for this session** in the
  dialog, or adjust per-tool policy in Settings → Approvals. Auto-execute is off by
  default for a reason.
- **Network off but I need a download.** Settings → Privacy → Diagnostics → **Network
  access**. Loopback to the local MLX server is unaffected.
- **The window closed but the app is still running.** That is **Keep running when the
  window closes** (on by default outside macOS). Use the menu bar icon or Quit.
- **Two copies will not open.** OpenMonkey is single-instance: launching it again
  focuses the existing window.
- **Uninstalling.** A Homebrew install goes with `brew uninstall --cask openmonkey`;
  add `--zap` to remove `~/Library/Application Support/OpenMonkey` and the caches too.
  Without `--zap` your chats stay on disk.

## Security reports

Please do not open a public issue for a vulnerability. Use the repository's **Security
→ Report a vulnerability** flow so the report stays private until a fix ships. Include
the version, a minimal reproduction and the impact you believe it has. The full policy —
what is in scope, what is a documented limit rather than a bug, and what to expect — is
in [SECURITY.md](../SECURITY.md).

## Support policy for 0.9

- Supported: the current release on macOS 13 or newer, Apple Silicon and Intel.
- The MLX backend additionally needs Apple Silicon and a working Python MLX install.
- Third-party model weights, custom MCP servers and edited configuration files are
  supported on a best-effort basis only.
- Response times are best-effort; this is a small project, not a paid support desk.
  Pro licensing exists (Settings → License), but there is no checkout yet and no paid
  support tier. The terms, the refund policy and the export-control note are in
  [LEGAL.md](LEGAL.md).
