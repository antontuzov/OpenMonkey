import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import storage from "../../src/utils/storage";
import config, { dataRoot } from "../../src/utils/config";
import { TaskManager } from "../../src/agent/task-manager";
import type { ApprovalRequest, TaskRequest } from "../../src/utils/types";

type Event = [string, unknown];
const events: Event[] = [];
const agent = { emit: (event: string, payload: unknown) => events.push([event, payload]) };

const home = process.env.HOME as string;
const workspace = path.join(home, "Documents", "timeline-work");
const target = path.join(workspace, "plan.md");

storage.init();
const manager = new TaskManager(agent as never);

const setPolicy = (file: "ask" | "allow" | "block") => {
  config.merge({
    agent: { ...config.get("agent"), approvalPolicies: { ...config.get("agent").approvalPolicies, file } },
  } as never);
};

before(() => {
  fs.mkdirSync(workspace, { recursive: true });
});

after(() => {
  storage.close();
});

const writeTask = (): TaskRequest => ({
  type: "file",
  action: "write_file",
  arguments: { path: target, content: "first\n" },
  summary: "write the plan",
  mutating: true,
});

const waitForApproval = async (): Promise<ApprovalRequest> => {
  for (let i = 0; i < 200; i++) {
    const requests = events
      .filter(([name]) => name === "approval-request")
      .map(([, payload]) => payload as ApprovalRequest);
    if (requests.length) return requests[requests.length - 1];
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("no approval request arrived");
};

test("a task that waits for a decision records the wait as a step of its own", async () => {
  setPolicy("ask");
  const running = manager.executeTask(writeTask(), null);
  const approval = await waitForApproval();

  const waiting = manager.getActiveTasks().find((task) => task.id === approval.taskId);
  assert.deepEqual(
    waiting?.steps?.map((step) => step.label),
    ["queued", "approval"]
  );
  assert.ok((waiting?.steps?.[0].endedAt ?? 0) > 0, "the queue step is over");
  assert.equal(waiting?.steps?.[1].endedAt, undefined, "the wait is still open");

  manager.resolveApproval(approval.requestId, true);
  const done = await running;
  assert.equal(done.status, "completed");
  assert.deepEqual(
    done.steps?.map((step) => step.label),
    ["queued", "approval", "running"]
  );
  for (const step of done.steps ?? []) {
    assert.ok((step.endedAt ?? 0) >= step.startedAt, `${step.label} ends after it starts`);
  }
});

test("a task that needs no decision goes straight from the queue to the work", async () => {
  setPolicy("allow");
  const task = await manager.executeTask(
    { ...writeTask(), arguments: { path: target, content: "second\n" } },
    null
  );
  assert.equal(task.status, "completed");
  assert.deepEqual(
    task.steps?.map((step) => step.label),
    ["queued", "running"]
  );
});

test("the timeline and the change survive a restart", () => {
  const stored = storage.getTasks(10).find((task) => task.id);
  const withDiff = storage.getTasks(10).find((task) => task.diff);
  assert.ok(withDiff, "the write is on disk with its change");
  assert.equal(withDiff.diff?.path, target);
  assert.equal(withDiff.diff?.added, 1);
  assert.ok(withDiff.steps?.length, "the timeline is on disk too");
  assert.equal(stored?.status !== undefined, true);
});

test("the change on disk is sealed like the rest of the history", () => {
  const db = new Database(path.join(dataRoot(), "openmonkey.db"), { readonly: true });
  try {
    const row = db.prepare("SELECT diff FROM tasks WHERE diff IS NOT NULL LIMIT 1").get() as {
      diff: string;
    };
    assert.ok(row.diff.startsWith("enc:v1:"));
    assert.equal(row.diff.includes("first"), false);
  } finally {
    db.close();
  }
});
