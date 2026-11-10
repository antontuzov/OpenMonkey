import { test } from "node:test";
import assert from "node:assert/strict";
import { bumpCask, dmgDigest } from "../../scripts/bump-cask";

const CASK = `cask "openmonkey" do
  version "0.9.2"
  sha256 "${"a".repeat(64)}"

  url "https://github.com/antontuzov/OpenMonkey/releases/download/v#{version}/OpenMonkey-arm64.dmg"
  app "OpenMonkey.app"
end
`;

const SHA = "5c09bf847158d5bbd94af47c1206115081ab750104f81199a1afee0c2e9e2d0b";

test("a bump rewrites the two pinned lines and leaves every other byte alone", () => {
  const out = bumpCask(CASK, "0.9.3", SHA);
  assert.ok(out.includes('  version "0.9.3"'));
  assert.ok(out.includes(`  sha256 "${SHA}"`));
  assert.equal(
    out.replace('  version "0.9.3"', '  version "0.9.2"').replace(`  sha256 "${SHA}"`, `  sha256 "${"a".repeat(64)}"`),
    CASK,
    "only the two pinned lines may change",
  );
});

test("bumping to the same pins changes nothing", () => {
  assert.equal(bumpCask(CASK, "0.9.2", "a".repeat(64)), CASK);
});

test("a cask without a version stanza is refused, not silently appended to", () => {
  assert.throws(() => bumpCask(CASK.replace(/^  version .+\n/m, ""), "0.9.3", SHA), /no version stanza/);
});

test("a cask without a sha256 stanza is refused", () => {
  assert.throws(() => bumpCask(CASK.replace(/^  sha256 .+\n/m, ""), "0.9.3", SHA), /no sha256 stanza/);
});

test("a digest that is not SHA-256 hex is refused", () => {
  assert.throws(() => bumpCask(CASK, "0.9.3", "not-a-digest"), /SHA-256/);
  assert.throws(() => bumpCask(CASK, "0.9.3", "z".repeat(64)), /SHA-256/);
});

test("a version the cask cannot pin is refused", () => {
  assert.throws(() => bumpCask(CASK, "latest", SHA), /not a version/);
  assert.throws(() => bumpCask(CASK, '0.9.2"; rm -rf', SHA), /not a version/);
});

test("the digest comes from the release's own asset metadata", () => {
  const assets = [
    { name: "OpenMonkey-arm64.zip", digest: `sha256:${"b".repeat(64)}` },
    { name: "OpenMonkey-arm64.dmg", digest: `sha256:${SHA}` },
  ];
  assert.equal(dmgDigest(assets, "OpenMonkey-arm64.dmg"), SHA);
});

test("a release without the DMG is refused by name", () => {
  assert.throws(() => dmgDigest([{ name: "OpenMonkey-arm64.zip", digest: `sha256:${SHA}` }], "OpenMonkey-arm64.dmg"), /no OpenMonkey-arm64\.dmg/);
});

test("an asset GitHub recorded no digest for is refused rather than guessed", () => {
  assert.throws(() => dmgDigest([{ name: "OpenMonkey-arm64.dmg" }], "OpenMonkey-arm64.dmg"), /no digest/);
  assert.throws(() => dmgDigest([{ name: "OpenMonkey-arm64.dmg", digest: null }], "OpenMonkey-arm64.dmg"), /no digest/);
});

test("a digest in another algorithm is refused", () => {
  assert.throws(
    () => dmgDigest([{ name: "OpenMonkey-arm64.dmg", digest: `sha512:${"c".repeat(128)}` }], "OpenMonkey-arm64.dmg"),
    /cannot read/,
  );
});