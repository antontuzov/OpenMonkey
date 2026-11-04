# OpenMonkey for macOS

## Which file do I want?

`OpenMonkey-arm64.dmg` — every Mac sold since late 2020 (Apple Silicon: M1, M2, M3,
M4, M5). Mount it, drag OpenMonkey to Applications, eject.

The download is the app only. The model weights are not inside it: on first run the
app tells you how many gigabytes it is about to fetch, and you can point it at a GGUF
file you already have instead.

Intel Macs (2019 and older) have no runner available to build on, so there is no
Intel artifact yet. Install
[from source](https://github.com/antontuzov/OpenMonkey#readme) on those.

## The first launch will be refused, and that is expected

These builds are **not signed or notarized with an Apple Developer ID**. That
certificate costs money and this project does not have one yet, so Gatekeeper treats
the app as untrusted the first time you open it — it is not damaged, and nothing about
it is broken.

Copy it to `/Applications` once, then tell macOS to stop treating a download as
foreign:

```sh
xattr -dr com.apple.quarantine /Applications/OpenMonkey.app
```

The app opens normally from then on. Anything you build yourself with
`npm run package:mac` has the same caveat.

Because the build is unsigned, the in-app updater cannot finish its job either. On
macOS, electron-updater hands the downloaded archive to Squirrel.Mac, and Squirrel
verifies the code signature of both the app that is running and the update that is
about to replace it. With no signature on either side, it refuses. New versions
therefore arrive as a release here, and dropping the new DMG over the old app is the
update. Signing the builds is the one thing that turns automatic updates on.

## Verifying what you downloaded

The SHA-256 of every file in this release is listed below. `sha256sum` or
`shasum -a 256` on the downloaded file should match its line.
