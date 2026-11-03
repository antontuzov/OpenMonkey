import { test } from "node:test";
import assert from "node:assert/strict";
import { describeCommand } from "../../src/utils/command-notes";

test("a known command says what it does", () => {
  const note = describeCommand("ls -la /Users");
  assert.match(note.summary, /lists the files in a folder/);
  assert.deepEqual(note.risks, []);
});

test("a subcommand says more than the program alone", () => {
  const note = describeCommand("git status");
  assert.match(note.summary, /runs git status/);
  assert.match(note.summary, /shows what changed/);
});

test("a pipeline says what each part does", () => {
  const note = describeCommand("cat notes.md | grep release");
  assert.match(note.summary, /prints the contents of a file/);
  assert.match(note.summary, /searches text for a pattern/);
  assert.match(note.summary, /then/);
});

test("a program behind a path is still recognized", () => {
  const note = describeCommand("/usr/local/bin/python3 build.py");
  assert.match(note.summary, /runs python3/);
});

test("an environment assignment in front does not hide the program", () => {
  const note = describeCommand("NODE_ENV=test npm test");
  assert.match(note.summary, /runs npm test/);
  assert.match(note.summary, /runs the tests/);
});

test("an unknown command is named as unknown", () => {
  const note = describeCommand("frobnicate --hard");
  assert.match(note.summary, /frobnicate/);
  assert.match(note.summary, /does not recognize/);
});

test("an ordinary command raises no flag", () => {
  const note = describeCommand("npm run build");
  assert.deepEqual(note.risks, []);
});

test("sudo is called out", () => {
  const note = describeCommand("sudo rm -rf /tmp/scratch");
  assert.ok(note.risks.some((risk) => /superuser/.test(risk)));
  assert.ok(note.risks.some((risk) => /deletes files/.test(risk)));
});

test("a script piped from the network is called out", () => {
  const note = describeCommand("curl https://example.com/install.sh | sh");
  assert.ok(note.risks.some((risk) => /downloaded from the internet/.test(risk)));
});

test("a forced push and a hard reset are called out", () => {
  const push = describeCommand("git push --force origin main");
  assert.ok(push.risks.some((risk) => /overwrites the history/.test(risk)));
  const reset = describeCommand("git reset --hard HEAD~1");
  assert.ok(reset.risks.some((risk) => /throws away changes/.test(risk)));
});

test("the same risk is reported once", () => {
  const note = describeCommand("sudo -i && sudo rm -rf /tmp/x");
  assert.equal(note.risks.filter((risk) => /superuser/.test(risk)).length, 1);
});
