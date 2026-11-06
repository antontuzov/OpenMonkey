/**
 * The new text of an answer, with a repeat of what is already written removed.
 *
 * A model asked to carry on from where it stopped sometimes writes the answer from
 * the beginning instead. The repeat is the part the two texts share; what comes after
 * it is the new text. When the model only repeated and wrote nothing new, the answer
 * comes back empty and the caller keeps what it had.
 *
 * Only a repeat that can be found whole is taken off. A continuation that merely
 * resembles what is written is left alone, because cutting it in the wrong place
 * would break the sentence.
 */
export function dropRepeatedStart(partial: string, continuation: string): string {
  const head = partial.trimStart();
  const rest = continuation.trimStart();
  if (!head || !rest) return continuation;

  // The model wrote the answer again and then carried on: what follows the repeat is new.
  const at = rest.indexOf(head);
  if (at >= 0) return rest.slice(at + head.length).trimStart();

  // The model repeated the beginning of the answer and stopped there, so it adds nothing.
  if (rest.length < head.length && head.startsWith(rest)) return "";

  return continuation;
}
