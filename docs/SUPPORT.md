# Support

OpenMonkey is a local desktop app, so most reports need the same three facts before
anyone can reproduce them. The project tracks bugs and feature requests in GitHub
Issues on the repository linked from **Help → OpenMonkey on GitHub** in the app.

## Before you report

1. **Version and OS.** The version sits at the bottom of Settings → Profile and on the
   onboarding footer (`OpenMonkey 0.9 · macOS`). Include the macOS version and whether
   the Mac is Apple Silicon or Intel.
2. **What you did, what you expected, what happened.** A short numbered list is more
   useful than a screenshot of the end state.
3. **Log lines.** Settings → Privacy → Diagnostics → **View log** shows the same entries
   as `logs/openmonkey.log`. Copy the lines around the failure. Conversation text,
   prompts and responses are never written there, so the file is safe to paste.

Never paste your passphrase, a backup file, or the contents of `data/secret.key`.

## Common answers

- **No model loaded.** Run `npm run download-models` in a development checkout, or
  open Settings → Model and use **Download** in an installed build. `docs/MODELS.md`
  lists paths and sizes.
- **Gatekeeper blocked the app.** Builds from a tagged release are signed and
  notarized; local `electron-builder` output is not. For an unsigned local build,
  right-click → Open, or clear quarantine with
  `xattr -d com.apple.quarantine /Applications/OpenMonkey.app`.
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

## Security reports

Please do not open a public issue for a vulnerability. Use the repository's **Security
→ Report a vulnerability** flow so the report stays private until a fix ships. Include
the version, a minimal reproduction and the impact you believe it has.

## Support policy for 0.9

- Supported: the current release on macOS 13 or newer, Apple Silicon and Intel.
- The MLX backend additionally needs Apple Silicon and a working Python MLX install.
- Third-party model weights, custom MCP servers and edited configuration files are
  supported on a best-effort basis only.
- Response times are best-effort; this is a small project, not a paid support desk.
  The planned commercial layer (Phase 8 in `ROADMAP.md`) is not available.
