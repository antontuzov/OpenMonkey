import { test } from "node:test";
import assert from "node:assert/strict";
import { withinQuietHours, validQuietHours } from "../../src/utils/quiet-hours";

const at = (hour: number, minute = 0): Date => new Date(2026, 10, 5, hour, minute);

test("the window is closed when it is switched off", () => {
  assert.equal(withinQuietHours(at(23), { enabled: false, from: "22:00", to: "08:00" }), false);
});

test("a window inside one day opens and closes on its own hours", () => {
  const quiet = { enabled: true, from: "09:00", to: "17:00" };
  assert.equal(withinQuietHours(at(8, 59), quiet), false);
  assert.equal(withinQuietHours(at(9), quiet), true);
  assert.equal(withinQuietHours(at(16, 59), quiet), true);
  assert.equal(withinQuietHours(at(17), quiet), false);
});

test("a window that crosses midnight wraps around", () => {
  const quiet = { enabled: true, from: "22:00", to: "08:00" };
  assert.equal(withinQuietHours(at(21, 59), quiet), false);
  assert.equal(withinQuietHours(at(22), quiet), true);
  assert.equal(withinQuietHours(at(3), quiet), true);
  assert.equal(withinQuietHours(at(7, 59), quiet), true);
  assert.equal(withinQuietHours(at(8), quiet), false);
});

test("a window that starts and ends at the same hour is empty", () => {
  assert.equal(withinQuietHours(at(10), { enabled: true, from: "09:00", to: "09:00" }), false);
});

test("nonsense hours are not quiet hours", () => {
  const broken = { enabled: true, from: "25:00", to: "08:00" };
  assert.equal(withinQuietHours(at(23), broken), false);
  assert.equal(validQuietHours(broken), false);
  assert.equal(validQuietHours({ enabled: true, from: "22:00", to: "08:00" }), true);
  assert.equal(validQuietHours({ enabled: true, from: "9:05", to: "08:00" }), true);
});
