import { test } from "node:test";
import assert from "node:assert/strict";
import { DesktopManager } from "../../src/main/desktop-manager";
import { notifications } from "./electron-stub.mjs";
import config from "../../src/utils/config";
import type { ApprovalRequest } from "../../src/utils/types";

/** The approval the agent raises when a tool wants the user's yes. */
const request = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  requestId: "approval_task_1",
  taskId: "task_1",
  request: {
    type: "shell",
    action: "run_command",
    arguments: { command: "ls" },
    summary: "Run ls in Documents",
    mutating: true,
  },
  preview: {
    kind: "command",
    title: "Run ls",
    command: "ls",
    cwd: "/Users/me/Documents",
    explanation: "Lists the files in the folder",
    risks: [],
  },
  policy: "ask",
  origin: "main",
  ...overrides,
});

interface Harness {
  manager: DesktopManager;
  answered: Array<{ requestId: string; approved: boolean }>;
  shown: () => typeof notifications;
}

const harness = (options: { focused?: boolean; at?: Date } = {}): Harness => {
  const answered: Array<{ requestId: string; approved: boolean }> = [];
  const manager = new DesktopManager({
    getMainWindow: () => ({ isFocused: () => Boolean(options.focused) }) as never,
    showMainWindow: () => undefined,
    resolveApproval: (requestId, approved) => answered.push({ requestId, approved }),
    now: () => options.at ?? new Date(),
  });
  return { manager, answered, shown: () => notifications };
};

/** The desktop settings the notification reads, restored after the test. */
const withDesktop = async (
  changes: Partial<ReturnType<typeof config.get<"desktop">>>,
  run: () => Promise<void> | void
): Promise<void> => {
  const before = config.get("desktop");
  config.set("desktop", { ...before, ...changes });
  try {
    await run();
  } finally {
    config.set("desktop", before);
  }
};

test("the notification carries Allow and Deny", async () => {
  notifications.length = 0;
  await withDesktop({ notifications: true, notifyActions: true }, () => {
    harness().manager.notifyApproval(request());
  });

  assert.equal(notifications.length, 1);
  const notification = notifications[0];
  assert.equal(notification.shown, true);
  assert.deepEqual(
    notification.options.actions?.map((action) => action.text),
    ["Allow", "Deny"]
  );
  assert.equal(notification.options.body, "Run ls in Documents");
});

test("pressing Allow answers the approval with a yes", async () => {
  notifications.length = 0;
  const { manager, answered } = harness();
  await withDesktop({ notifications: true, notifyActions: true }, () => {
    manager.notifyApproval(request());
  });

  notifications[0].emit("action", 0);
  assert.deepEqual(answered, [{ requestId: "approval_task_1", approved: true }]);
});

test("pressing Deny answers the approval with a no", async () => {
  notifications.length = 0;
  const { manager, answered } = harness();
  await withDesktop({ notifications: true, notifyActions: true }, () => {
    manager.notifyApproval(request());
  });

  notifications[0].emit("action", 1);
  assert.deepEqual(answered, [{ requestId: "approval_task_1", approved: false }]);
});

test("with the buttons turned off the notification only opens the window", async () => {
  notifications.length = 0;
  const { manager, answered } = harness();
  await withDesktop({ notifications: true, notifyActions: false }, () => {
    manager.notifyApproval(request());
  });

  assert.equal(notifications[0].actions.length, 0);
  notifications[0].emit("action", 0);
  assert.deepEqual(answered, []);
});

test("a window that is in front keeps the notification away", async () => {
  notifications.length = 0;
  await withDesktop({ notifications: true, notifyActions: true }, () => {
    harness({ focused: true }).manager.notifyApproval(request());
  });
  assert.equal(notifications.length, 0);
});

test("the quiet hours silence the notification", async () => {
  notifications.length = 0;
  const night = new Date("2026-11-05T23:30:00");
  await withDesktop(
    { notifications: true, notifyActions: true, quietHours: { enabled: true, from: "22:00", to: "08:00" } },
    () => {
      harness({ at: night }).manager.notifyApproval(request());
    }
  );
  assert.equal(notifications.length, 0);
});

test("outside the quiet hours the notification comes back", async () => {
  notifications.length = 0;
  const morning = new Date("2026-11-05T09:30:00");
  await withDesktop(
    { notifications: true, notifyActions: true, quietHours: { enabled: true, from: "22:00", to: "08:00" } },
    () => {
      harness({ at: morning }).manager.notifyApproval(request());
    }
  );
  assert.equal(notifications.length, 1);
});
