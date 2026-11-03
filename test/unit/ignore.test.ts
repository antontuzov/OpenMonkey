import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compileIgnoreRule,
  compileIgnoreRules,
  isIgnored,
  normalizeIgnoreRules,
} from "../../src/utils/ignore";

test("a rule without a slash matches that name at any depth", () => {
  const rules = compileIgnoreRules(["secrets"]);
  assert.equal(isIgnored(rules, "secrets"), true);
  assert.equal(isIgnored(rules, "docs/secrets"), true);
  assert.equal(isIgnored(rules, "docs/secrets/keys.md"), true);
  assert.equal(isIgnored(rules, "docs/public.md"), false);
});

test("a rule with a slash matches that path and everything under it", () => {
  const rules = compileIgnoreRules(["docs/private"]);
  assert.equal(isIgnored(rules, "docs/private"), true);
  assert.equal(isIgnored(rules, "docs/private/notes.md"), true);
  assert.equal(isIgnored(rules, "docs/public/notes.md"), false);
  assert.equal(isIgnored(rules, "other/docs/private"), false);
});

test("a wildcard matches a name and never crosses a slash", () => {
  const rules = compileIgnoreRules(["*.log"]);
  assert.equal(isIgnored(rules, "server.log"), true);
  assert.equal(isIgnored(rules, "logs/server.log"), true);
  assert.equal(isIgnored(rules, "logs/server.txt"), false);

  const scoped = compileIgnoreRules(["docs/*.md"]);
  assert.equal(isIgnored(scoped, "docs/notes.md"), true);
  assert.equal(isIgnored(scoped, "docs/sub/notes.md"), false);
});

test("a rule that names a folder keeps out everything inside it", () => {
  const rules = compileIgnoreRules(["logs/*"]);
  assert.equal(isIgnored(rules, "logs/server.log"), true);
  assert.equal(isIgnored(rules, "logs/nested"), true);
  assert.equal(isIgnored(rules, "logs/nested/server.log"), true);
});

test("a double star crosses folders, and may cross none", () => {
  const rules = compileIgnoreRules(["logs/**/archive"]);
  assert.equal(isIgnored(rules, "logs/archive"), true);
  assert.equal(isIgnored(rules, "logs/2024/archive"), true);
  assert.equal(isIgnored(rules, "logs/2024/03/archive"), true);
});

test("an empty rule says nothing", () => {
  assert.equal(compileIgnoreRule("   "), null);
  assert.equal(compileIgnoreRules(["", "  "]).length, 0);
});

test("rules are cleaned, de-duplicated and capped", () => {
  const rules = normalizeIgnoreRules(["  secrets  ", "secrets", "", "*.log"]);
  assert.deepEqual(rules, ["secrets", "*.log"]);

  const many = normalizeIgnoreRules(Array.from({ length: 80 }, (_, index) => `rule-${index}`));
  assert.equal(many.length, 50);
});
