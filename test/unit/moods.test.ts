import { test } from "node:test";
import assert from "node:assert/strict";
import { MOODS, MOOD_LOGOS } from "../../src/utils/types";

test("there are twelve moods, each with its own logo", () => {
  assert.equal(MOODS.length, 12);
  assert.equal(new Set(MOODS).size, 12);
  const files = MOODS.map((mood) => MOOD_LOGOS[mood].file);
  assert.equal(new Set(files).size, 12);
  for (const file of files) assert.match(file, /^monkey-[a-z]+-[a-z]+\.png$/);
});

test("every mood carries an English and a Russian label and a colour", () => {
  for (const mood of MOODS) {
    const logo = MOOD_LOGOS[mood];
    assert.ok(logo.label.trim(), `${mood} has an English label`);
    assert.ok(logo.labelRu.trim(), `${mood} has a Russian label`);
    assert.match(logo.color, /^#[0-9a-f]{6}$/i);
  }
  const labels = MOODS.map((mood) => MOOD_LOGOS[mood].label);
  assert.equal(new Set(labels).size, 12);
  const russian = MOODS.map((mood) => MOOD_LOGOS[mood].labelRu);
  assert.equal(new Set(russian).size, 12);
});
