import { test } from "node:test";
import assert from "node:assert/strict";
import { dropRepeatedStart } from "../../src/utils/continuation";

test("a continuation that picks up where the answer stopped is kept as it is", () => {
  const partial = "The tree is called ";
  assert.equal(dropRepeatedStart(partial, "an oak."), "an oak.");
});

test("a continuation that writes the answer again loses the repeated part", () => {
  const partial = "The tree is called an oak. It is more than two hundred years old.";
  const whole = `${partial} Its branches spread across the yard.`;
  assert.equal(dropRepeatedStart(partial, whole), "Its branches spread across the yard.");
});

test("a continuation that only repeats the answer leaves nothing new", () => {
  const partial = "The tree is called an oak. It is more than two hundred years old.";
  assert.equal(dropRepeatedStart(partial, partial), "");
});

test("a continuation that stops in the middle of the repeat adds nothing", () => {
  const partial = "The tree is called an oak. It is more than two hundred years old.";
  assert.equal(dropRepeatedStart(partial, "The tree is called an oak."), "");
});

test("a continuation that only resembles the answer is left whole", () => {
  const partial = "The tree is called an oak.";
  assert.equal(
    dropRepeatedStart(partial, "The tree is called an oak's cousin, a birch."),
    "The tree is called an oak's cousin, a birch."
  );
  assert.equal(dropRepeatedStart(partial, "A totally different sentence."), "A totally different sentence.");
});

test("an empty or missing continuation changes nothing", () => {
  assert.equal(dropRepeatedStart("The tree is called an oak.", ""), "");
  assert.equal(dropRepeatedStart("", "The tree is called an oak."), "The tree is called an oak.");
  assert.equal(dropRepeatedStart("   ", "The tree is called an oak."), "The tree is called an oak.");
});
