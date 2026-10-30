import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import logger from "../../src/utils/logger";

const logDir = path.join(process.env.OM_STUB_HOME as string, "logs");
const live = path.join(logDir, "openmonkey.log");

test("message text is replaced by its length before it reaches disk", () => {
  logger.clear();
  logger.info("test.redaction", { content: "the secret body", prompt: "the hidden prompt", response: "the model reply", mood: "happy" });
  const text = fs.readFileSync(live, "utf8");
  assert.equal(text.includes("the secret body"), false);
  assert.equal(text.includes("the hidden prompt"), false);
  assert.equal(text.includes("the model reply"), false);
  assert.match(text, /contentLength/);
  assert.match(text, /promptLength/);
  assert.match(text, /responseLength/);
  assert.match(text, /"mood":"happy"/);
});

test("the log rotates at 2 MB and keeps two older copies", () => {
  logger.clear();
  const line = "x".repeat(1000);
  for (let i = 0; i < 5000; i++) logger.info("test.bulk", { index: i, line });
  assert.ok(fs.statSync(live).size <= 2 * 1024 * 1024);
  assert.ok(fs.existsSync(`${live}.1`));
  assert.ok(fs.existsSync(`${live}.2`));
  assert.equal(fs.existsSync(`${live}.3`), false);
  assert.ok(fs.statSync(`${live}.1`).size > 1024 * 1024);
});

test("tail returns the newest lines and clear removes the rotations", () => {
  logger.clear();
  for (let i = 0; i < 30; i++) logger.info("test.tail", { index: i });
  const tail = logger.tail(5);
  assert.equal(tail.trim().split("\n").length, 5);
  assert.match(tail, /"index":29/);
  assert.equal(tail.includes('"index":24'), false);
  logger.clear();
  assert.equal(logger.tail(10), "");
  assert.equal(fs.existsSync(`${live}.1`), false);
  assert.equal(fs.existsSync(`${live}.2`), false);
});

test("a redacted line still says which phase failed", () => {
  logger.clear();
  logger.info("test.failure", { error: "ELOOP", content: "private" });
  const text = fs.readFileSync(live, "utf8");
  assert.match(text, /"error":"ELOOP"/);
  assert.equal(text.includes("private"), false);
});
