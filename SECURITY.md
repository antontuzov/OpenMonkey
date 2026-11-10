# Security policy

## Supported versions

The latest released 0.9.x build on macOS 13 or newer gets security fixes. Older
releases are superseded by the update channel; there are no long-term branches.

## Reporting a vulnerability

Please report privately through GitHub's **Security → Report a vulnerability**
flow on this repository:
<https://github.com/antontuzov/OpenMonkey/security/advisories/new>.
That keeps the report visible only to the maintainers until a fix ships. Do not
open a public issue, and do not post details to Discussions or social channels.

Include:

- The app version (Settings → Profile, bottom) and your macOS version.
- A minimal reproduction — the smallest sequence that shows the problem.
- The impact you believe it has, and any precondition (a malicious MCP server, a
  crafted backup file, a page the Web tool fetches).

Logs are safe to attach: conversation text, prompts and responses are replaced by
their lengths before anything reaches `logs/openmonkey.log`. Never attach your
passphrase, `data/secret.key`, a backup file, or your keychain contents.

## Scope

In scope: the app's own code — main process, renderer, preload bridge, agent
tools, storage and encryption, the update and publishing pipelines.

Out of scope, by design:

- Anything an already-unlocked macOS session can do. PRIVACY.md's "What this does
  not protect" lists these limits; they are documented, not vulnerabilities.
- The quality or content of model output. The model is a third-party weight file
  running locally; report weight problems to the weight's publisher.
- Third-party MCP servers and custom model weights. Report those upstream; the
  app's approval gate and path confinement around them are in scope.

## What to expect

This is a small project, not a paid security desk. Reports are read on a
best-effort basis; a confirmed issue gets a fix in the next release and, if you
want, credit in the release notes. Please give a reasonable window to ship a fix
before publishing details.