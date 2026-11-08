import { test } from "node:test";
import assert from "node:assert/strict";
import { FULL_ROLLOUT, isInCohort, rolloutBucket, rolloutOf } from "../../src/utils/rollout";

test("the same install lands in the same bucket for the same version", () => {
  const first = rolloutBucket("abc123", "0.9.3");
  assert.equal(first, rolloutBucket("abc123", "0.9.3"));
  assert.ok(first >= 0 && first < 100, "a bucket is a number between 0 and 99");
});

test("a new release draws a new cohort", () => {
  // The version is part of the mix, so a build that was held back does not stay
  // held back for the next one.
  const id = "abc123";
  const buckets = new Set(
    ["0.9.3", "0.9.4", "0.9.5", "0.9.6", "0.9.7"].map((version) => rolloutBucket(id, version))
  );
  assert.ok(buckets.size > 1, "the cohort is redrawn every release");
});

test("different installs are not all in the same place", () => {
  const buckets = new Set(
    Array.from({ length: 40 }, (_, index) => rolloutBucket(`install-${index}`, "0.9.3"))
  );
  assert.ok(buckets.size > 10, "the buckets spread out");
});

test("a rollout of a hundred reaches everybody and a rollout of none reaches nobody", () => {
  for (let bucket = 0; bucket < 100; bucket += 1) {
    assert.equal(isInCohort(bucket, FULL_ROLLOUT), true);
    assert.equal(isInCohort(bucket, 0), false);
  }
});

test("a rollout of a quarter reaches roughly a quarter of the installs", () => {
  let offered = 0;
  for (let index = 0; index < 4000; index += 1) {
    if (isInCohort(rolloutBucket(`install-${index}`, "0.9.3"), 25)) offered += 1;
  }
  assert.ok(offered > 800 && offered < 1200, `${offered} of 4000 were offered it`);
});

test("a share outside the scale is read as the nearest end of it", () => {
  assert.equal(isInCohort(50, 140), true);
  assert.equal(isInCohort(50, -20), false);
});

test("a release that says nothing about a rollout is offered to everybody", () => {
  assert.equal(rolloutOf({}), FULL_ROLLOUT);
  assert.equal(rolloutOf(null), FULL_ROLLOUT);
  assert.equal(rolloutOf({ rollout: "half" }), FULL_ROLLOUT);
  assert.equal(rolloutOf({ rollout: Number.NaN }), FULL_ROLLOUT);
});

test("a release that says a share is believed", () => {
  assert.equal(rolloutOf({ rollout: 25 }), 25);
  assert.equal(rolloutOf({ rollout: 25.4 }), 25);
  assert.equal(rolloutOf({ rollout: 250 }), FULL_ROLLOUT);
  assert.equal(rolloutOf({ rollout: -5 }), 0);
});
