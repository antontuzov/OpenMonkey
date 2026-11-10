# Legal

The statements that govern OpenMonkey as shipped: the end-user license agreement,
the refund policy and the export-control note. The privacy statement lives in
[PRIVACY.md](PRIVACY.md) and the security-report path in [SECURITY.md](../SECURITY.md);
this page shelves them all.

Applies to OpenMonkey 0.9 and later. Last reviewed 2026-11-10.

## End-user license agreement

**The code is MIT-licensed.** The source in this repository carries the MIT license
(`LICENSE` at the root), and nothing on this page takes those rights away: you may
use, copy, modify and redistribute the source under those terms. This agreement
covers what the MIT license does not — the official builds, the paid Pro license
file, and the promises made about them.

**The official build.** The disk images published on the repository's Releases page
are built by the project's own pipeline from this source. You may install and run
them on Macs you control. They are provided as they are, without warranty of any
kind: a local model can be wrong, a tool can act on what the model says, and every
side effect is put in front of you for approval precisely because the software
cannot promise the outcome. To the extent the law allows, the authors are not
liable for damages arising from use of the app — lost data, lost posts, lost
profits. The app keeps its own history encrypted and its own backups; keeping a
copy of what matters remains your job.

**The free tier.** Chat, tools and memory are free and stay free. No account, no
telemetry, no phone-home.

**The Pro license.** Pro — posting to your own channels, posts queued for later,
and drafts — is unlocked by a license file: a signed JSON document checked on your
Mac against a public key shipped inside the app. It costs $29 once, per person or
organisation. There is no subscription and nothing to renew unless the license was
issued with an expiry date, which the License page shows.

- A fresh install starts a **14-day trial** of Pro, remembered on disk so a restart
  does not hand out another one. Then a **7-day grace period**, then the free tier.
- A license may be **bound to one Mac**. The binding is a hash of the machine; a
  license issued for another Mac is refused on this one. An unbound license works
  on the Macs you control.
- The license is a file, not an account. Do not publish it or resell it. The app
  cannot enforce that remotely — there is no phone-home — so this term is an
  honour obligation, and violating it ends the support and refund promises below.
- Taking the license off the Mac (Settings → License → Remove) returns the app to
  the free tier. Nothing else is taken away.

**Your content.** What you type, what the model writes and what you post belong to
you. The app stores them locally and sends them only where you point it: the
publishing targets you set in Settings, under your own accounts, after your
approval. The authors claim nothing over any of it.

## Refund policy

Try Pro before you pay: the 14-day trial runs the whole publishing suite, and
nothing is crippled inside it.

If you buy a license and change your mind, you get **30 days from the purchase to
ask for a full refund**, no questions asked. After 30 days a refund is at the
author's discretion — a license that cannot do what the License page says it does
is refunded at any time.

To ask, open an issue on the repository titled "Refund" with the license id (the
`id` field of the license file — not the file itself, and no payment details in
public). The reply arranges the payment side privately.

Because the license is checked only on your Mac, a refund cannot reach in and
take the file back. You are asked to remove it in Settings → License when the
refund lands; the refund is recorded against the license id, and a refunded
license gets no further support or paid upgrades.

There is no checkout on this site yet: licenses are issued directly by the author.
When a merchant-of-record checkout opens, its payment flow handles the money and
this policy still governs the license.

## Export control

OpenMonkey is open-source software, publicly available at no charge, that uses
standard, publicly documented cryptography (AES-256-GCM, Ed25519, scrypt) to seal
data on the user's own machine. It is not designed or modified for any military,
weapons or intelligence end-use, and it must not be used in prohibited weapons
programs.

The project has no accounts and collects no location, so it does not — and cannot
— screen who downloads it. You are responsible for checking that downloading,
importing or using the app is lawful where you live, including any sanctions or
encryption-import rules that apply to you. The authors make no representation
that the app is lawful in every jurisdiction.

## Privacy

What the app stores, what it encrypts, what it sends and what it deliberately
cannot protect against is written down in [PRIVACY.md](PRIVACY.md). That document
is the privacy policy; it is kept in the repository so every change to it is a
commit you can read.

## Security reports

Please do not open a public issue for a vulnerability. The private reporting path
and what to include are in [SECURITY.md](../SECURITY.md).

## Contact

Everything else — questions, bug reports, refund requests — goes to
[GitHub Issues](https://github.com/antontuzov/OpenMonkey/issues). This is a small
project; answers are best-effort, and [SUPPORT.md](SUPPORT.md) says what is
supported.