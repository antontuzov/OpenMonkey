/**
 * Who gets a new version first.
 *
 * A release can be held back for a share of the installs and let out slowly, so a
 * bad build reaches a few people before it reaches everyone. The share is decided
 * by the publisher and travels with the release; the app only compares its own
 * number against it.
 *
 * Nothing here identifies a machine: the id is a random string the install made
 * for itself, it never leaves the Mac, and the only thing derived from it is a
 * number between 0 and 99.
 */

/** The share of installs a release is offered to, as a percentage. */
export const FULL_ROLLOUT = 100;

/**
 * The bucket this install falls in for one version.
 *
 * The version is part of the mix, so a build that was held back does not stay
 * held back for the next one: the cohort is redrawn every release.
 */
export function rolloutBucket(installId: string, version: string): number {
  const text = `${installId}:${version}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

/**
 * Whether this install is in the cohort the release is offered to.
 *
 * A rollout of 0 offers the release to nobody, and one of 100 offers it to
 * everybody, so the ends of the scale mean what they say.
 */
export function isInCohort(bucket: number, rollout: number): boolean {
  const share = Math.max(0, Math.min(FULL_ROLLOUT, Math.round(rollout)));
  return bucket < share;
}

/**
 * The rollout a release carries.
 *
 * A release that says nothing is offered to everybody: a publisher who has not
 * thought about staging must not have their users held back by accident.
 */
export function rolloutOf(manifest: unknown): number {
  const value = (manifest as { rollout?: unknown } | null | undefined)?.rollout;
  if (typeof value !== "number" || !Number.isFinite(value)) return FULL_ROLLOUT;
  return Math.max(0, Math.min(FULL_ROLLOUT, Math.round(value)));
}
