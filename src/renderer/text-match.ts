/**
 * Text matching shared by the settings search and the command palette.
 */

const words = (text: string): string[] => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * A Russian row is titled in the nominative ("история") while the word a person types
 * carries a case ending ("историю"), and neither contains the other. Two words match when
 * they share all but their last two letters, which is enough for Russian, English plurals,
 * and "encrypt"/"encryption", while "beta" still cannot reach "better".
 */
export function stemMatches(a: string, b: string): boolean {
  const shorter = Math.min(a.length, b.length);
  if (shorter < 5) return false;
  let shared = 0;
  while (shared < shorter && a[shared] === b[shared]) shared += 1;
  return shared >= 4 && shared >= shorter - 2;
}

/** A single word is allowed to arrive at a row by its stem; a phrase must appear whole. */
export function stemHit(text: string, needle: string): boolean {
  if (needle.includes(" ")) return false;
  return words(text).some((word) => stemMatches(word, needle));
}
