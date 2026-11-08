import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, parseVersion, pickPreviousRelease } from "../../src/utils/rollback";

const release = (tag: string, extra: { draft?: boolean; prerelease?: boolean; dmg?: boolean } = {}) => ({
  tag_name: tag,
  draft: extra.draft,
  prerelease: extra.prerelease,
  assets: extra.dmg === false ? [] : [{ name: `${tag}-arm64.dmg`, browser_download_url: `https://example.test/${tag}.dmg`, size: 1000 }],
});

test("a tag becomes the three numbers of a version", () => {
  assert.deepEqual(parseVersion("0.9.2"), [0, 9, 2]);
  assert.deepEqual(parseVersion("v0.9.2"), [0, 9, 2]);
  assert.deepEqual(parseVersion("1.2"), [1, 2, 0]);
  assert.deepEqual(parseVersion("1"), [1, 0, 0]);
});

test("a tag that is not a version is not one", () => {
  assert.equal(parseVersion("nightly"), null);
  assert.equal(parseVersion(""), null);
});

test("the newer version is the bigger one", () => {
  assert.ok(compareVersions([0, 9, 3], [0, 9, 2]) > 0);
  assert.ok(compareVersions([1, 0, 0], [0, 9, 9]) > 0);
  assert.ok(compareVersions([0, 9, 2], [0, 9, 2]) === 0);
});

test("the release to go back to is the newest one older than the running version", () => {
  const target = pickPreviousRelease(
    [release("v0.9.3"), release("v0.9.2"), release("v0.9.1")],
    "0.9.3"
  );
  assert.equal(target?.version, "0.9.2");
  assert.equal(target?.url, "https://example.test/v0.9.2.dmg");
  assert.equal(target?.size, 1000);
});

test("a draft and a prerelease are not versions to fall back to", () => {
  const target = pickPreviousRelease(
    [release("v0.9.3"), release("v0.9.2", { draft: true }), release("v0.9.1", { prerelease: true }), release("v0.9.0")],
    "0.9.3"
  );
  assert.equal(target?.version, "0.9.0");
});

test("a release without a disk image cannot be fetched, so it is not offered", () => {
  const target = pickPreviousRelease([release("v0.9.2", { dmg: false }), release("v0.9.1")], "0.9.3");
  assert.equal(target?.version, "0.9.1");
});

test("there is nothing to go back to when the running version is the oldest", () => {
  assert.equal(pickPreviousRelease([release("v0.9.3")], "0.9.3"), null);
  assert.equal(pickPreviousRelease([], "0.9.3"), null);
});

test("a version the app cannot read has no rollback", () => {
  assert.equal(pickPreviousRelease([release("v0.9.1")], "nightly"), null);
});
