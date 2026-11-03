import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import storage from "../../src/utils/storage";
import config from "../../src/utils/config";
import { TaskManager } from "../../src/agent/task-manager";
import type { TaskRequest } from "../../src/utils/types";

const home = process.env.HOME as string;
const workspace = path.join(home, "Documents", "diff-work");
const target = path.join(workspace, "notes.txt");

const agent = { emit: () => undefined };

storage.init();
const manager = new TaskManager(agent as never);

before(() => {
  fs.mkdirSync(workspace, { recursive: true });
  config.merge({
    agent: { ...config.get("agent"), approvalPolicies: { ...config.get("agent").approvalPolicies, file: "allow" } },
  } as never);
});

after(() => {
  storage.close();
});

const writeTask = (file: string, content: string, action: "write_file" | "append_file" = "write_file"): TaskRequest => ({
  type: "file",
  action,
  arguments: { path: file, content },
  summary: `${action} ${path.basename(file)}`,
  mutating: true,
});

test("a write that creates a file reports every line as added", async () => {
  fs.rmSync(target, { force: true });
  const task = await manager.executeTask(writeTask(target, "alpha\nbeta\n"), null);
  assert.equal(task.status, "completed");
  assert.ok(task.diff, "the task carries a diff");
  assert.equal(task.diff?.path, target);
  assert.equal(task.diff?.added, 2);
  assert.equal(task.diff?.removed, 0);
  assert.deepEqual(
    task.diff?.lines.map((line) => line.kind),
    ["add", "add"]
  );
});

test("a write that changes a line shows one removal and one addition", async () => {
  const task = await manager.executeTask(writeTask(target, "alpha\ngamma\n"), null);
  assert.equal(task.status, "completed");
  assert.equal(task.diff?.added, 1);
  assert.equal(task.diff?.removed, 1);
  assert.deepEqual(
    task.diff?.lines.map((line) => `${line.kind} ${line.text}`),
    ["same alpha", "del beta", "add gamma"]
  );
});

test("an append is reported as the whole file plus the new lines", async () => {
  const task = await manager.executeTask(writeTask(target, "delta\n", "append_file"), null);
  assert.equal(task.status, "completed");
  assert.equal(task.diff?.added, 1);
  assert.equal(task.diff?.removed, 0);
  assert.equal(fs.readFileSync(target, "utf8"), "alpha\ngamma\ndelta\n");
});

test("the file on disk is what the diff claims", async () => {
  assert.equal(fs.readFileSync(target, "utf8"), "alpha\ngamma\ndelta\n");
});

test("a task that failed can be run again from what it asked", async () => {
  const failed = await manager.executeTask(
    {
      ...writeTask(path.join(workspace, "missing", "notes.txt"), "recovered\n"),
      action: "write_file",
    },
    null
  );
  assert.equal(failed.status, "completed");

  const again = await manager.retryTask(failed.id);
  assert.ok(again, "the task was run again");
  assert.equal(again?.status, "completed");
  assert.equal(again?.id === failed.id, false, "the retry is a task of its own");
  assert.equal(fs.readFileSync(path.join(workspace, "missing", "notes.txt"), "utf8"), "recovered\n");
  // The file already held the text, so the second run changed nothing.
  assert.equal(again?.diff?.added, 0);
  assert.equal(again?.diff?.removed, 0);
});

test("a task with nothing to run again is refused", async () => {
  assert.equal(await manager.retryTask("task_that_never_ran"), null);
});
