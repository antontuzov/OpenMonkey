import { MOODS, type Mood } from "../utils/types";

const PATTERNS: Array<[Mood, RegExp]> = [
  ["love", /\b(love|adore|beautiful|wonderful|thank you|thanks so much|appreciate)\b/i],
  ["excited", /\b(excited|awesome|amazing|let's go|woohoo|cant wait|can't wait|huge win)\b/i],
  ["shocked", /\b(wow|whoa|wowza|omg|oh my|no way|seriously|shocked|stunned|what\?)\b/i],
  ["angry", /\b(angry|mad|furious|annoyed|frustrated|hate|broken|useless|damn|ugh)\b/i],
  ["tired", /\b(tired|exhausted|sleepy|drained|burnt out|burned out|insomnia|long day)\b/i],
  ["thinking", /\b(think|analyse|analyze|consider|reason|compare|evaluate|why|how does|figure out)\b/i],
  ["cool", /\b(cool|nice|chill|slick|elegant|clean|solid|impressive)\b/i],
  ["silly", /\b(lol|lmao|haha|hehe|silly|joke|funny|goofy|meme)\b/i],
  ["calm", /\b(calm|relax|peaceful|okay thanks|alright|steady|meditat|breath)\b/i],
  ["happy", /\b(happy|glad|great|excellent|perfect|yay|good news|delighted)\b/i],
  ["smile", /\b(\bhi\b|hello|hey|smile|friendly|nice to meet|greetings)\b/i],
];

/**
 * Keyword match, first hit wins, ordered so strong signals (anger, exhaustion)
 * beat generic praise. Defaults to the previous mood's neutral baseline.
 */
export function detectMood(text: string): Mood {
  for (const [mood, pattern] of PATTERNS) {
    if (pattern.test(text)) return mood;
  }
  return "neutral";
}

export function isMood(value: unknown): value is Mood {
  return typeof value === "string" && (MOODS as string[]).includes(value);
}
