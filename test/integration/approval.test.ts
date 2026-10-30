import { test, after } from "node:test";
import assert from "node:assert/strict";
import storage from "../../src/utils/storage";
import config from "../../src/utils/config";
import { TaskManager } from "../../src/agent/task-manager";
import type { ApprovalRequest, TaskRequest } from "../../src/utils/types";

type Event = [string, unknown];
const events: Event[] = [];
const agent = {
  emit: (event: string, payload: unknown) => events.push([event, payload]),
};

storage.init();
const manager = new TaskManager(agent as never);

const setPolicy = (shell: "ask" | "allow" | "block") => {
  config.merge({
    agent: { ...config.get("agent"), approvalPolicies: { ...config.get("agent").approvalPolicies, shell } },
  } as never);
};

const shellTask = (command: string): TaskRequest => ({
  type: "shell",
  action: "run_command",
  arguments: { command },
  summary: `Run ${command}`,
  mutating: false,
});

const waitForApproval = async (count: number): Promise<ApprovalRequest> => {
  for (let i = 0; i < 200; i++) {
    const requests = events.filter(([name]) => name === "approval-request").map(([, payload]) => payload as ApprovalRequest);
    if (requests.length >= count) return requests[count - 1];
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("no approval request arrived");
};

after(() => {
  storage.close();
});

test("a block policy refuses before the command is started", async () => {
  setPolicy("block");
  const task = await manager.executeTask(shellTask("echo should-not-run"), null);
  assert.equal(task.status, "denied");
  assert.match(task.error ?? "", /Blocked by your approval policy/);
  assert.equal(task.output ?? "", "");
});

test("an ask policy waits for a decision and a deny runs nothing", async () => {
  setPolicy("ask");
  const before = events.filter(([name]) => name === "approval-request").length;
  const running = manager.executeTask(shellTask("echo denied-should-not-run"), null);
  const approval = await waitForApproval(before + 1);
  assert.equal(approval.request.action, "run_command");
  assert.equal(approval.policy, "ask");
  const pending = manager.getActiveTasks().find((task) => task.id === approval.taskId);
  assert.equal(pending?.status, "awaiting-approval");
  manager.resolveApproval(approval.requestId, false);
  const task = await running;
  assert.equal(task.status, "denied");
  assert.match(task.error ?? "", /declined/);
  assert.equal(task.output ?? "", "");
});

test("remembering an allow carries the decision to the next call", async () => {
  setPolicy("ask");
  const before = events.filter(([name]) => name === "approval-request").length;
  const first = manager.executeTask(shellTask("echo approved-ok"), null);
  const approval = await waitForApproval(before + 1);
  manager.resolveApproval(approval.requestId, true, true);
  const done = await first;
  assert.equal(done.status, "completed");
  assert.match(done.result ?? "", /approved-ok/);

  const second = await manager.executeTask(shellTask("echo remembered-ok"), null);
  assert.equal(second.status, "completed");
  assert.match(second.result ?? "", /remembered-ok/);
  assert.equal(events.filter(([name]) => name === "approval-request").length, before + 1);
});

test("an allow policy runs without asking", async () => {
  setPolicy("allow");
  const before = events.filter(([name]) => name === "approval-request").length;
  const task = await manager.executeTask(shellTask("echo allowed-ok"), null);
  assert.equal(task.status, "completed");
  assert.match(task.result ?? "", /allowed-ok/);
  assert.equal(events.filter(([name]) => name === "approval-request").length, before);
});
