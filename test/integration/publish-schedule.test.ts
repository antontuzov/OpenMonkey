import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { PublishTools, parseWhen, type PublishDeps } from "../../src/agent/tools/publish";
import { PublishScheduler } from "../../src/main/publish-scheduler";
import { publishQueue, type PublishQueue } from "../../src/utils/publish-queue";
import storage from "../../src/utils/storage";
import { dataRoot } from "../../src/utils/config";
import type {
  PublisherChannel,
  PublisherSecret,
  ScheduledPost,
  ScheduledPostStatus,
} from "../../src/utils/types";
import type { PublisherSecrets } from "../../src/utils/publisher-secrets";

const BOT_TOKEN = "123456789:AAHfiqksKZ8WmTn2a1b2c3d4e5f6g7h8i";

/** A secret store that keeps the values in memory, so no test touches a keychain. */
const secretsWith = (values: Partial<Record<PublisherChannel, PublisherSecret>>): PublisherSecrets => ({
  available: () => true,
  read: (channel) => values[channel] ?? null,
  write: (channel, secret) => {
    values[channel] = secret;
  },
  clear: (channel) => {
    delete values[channel];
  },
});

/** The queue in memory, so a test never depends on what another one left behind. */
class FakeQueue implements PublishQueue {
  posts: ScheduledPost[] = [];
  writable = true;

  available(): boolean {
    return this.writable;
  }

  add(post: {
    channel: PublisherChannel;
    text: string;
    title?: string;
    imageUrl?: string;
    dueAt: number;
  }): ScheduledPost {
    const created: ScheduledPost = {
      ...post,
      id: `post_${this.posts.length + 1}`,
      createdAt: Date.now(),
      status: "pending",
      attempts: 0,
    };
    this.posts.push(created);
    return created;
  }

  list(statuses?: ScheduledPostStatus[]): ScheduledPost[] {
    return statuses ? this.posts.filter((post) => statuses.includes(post.status)) : [...this.posts];
  }

  get(id: string): ScheduledPost | null {
    return this.posts.find((post) => post.id === id) ?? null;
  }

  save(post: ScheduledPost): void {
    const index = this.posts.findIndex((item) => item.id === post.id);
    if (index >= 0) this.posts[index] = post;
    else this.posts.push(post);
  }

  remove(id: string): void {
    this.posts = this.posts.filter((post) => post.id !== id);
  }
}

let counter = 0;
const historyFile = (): string => {
  counter += 1;
  return path.join(dataRoot(), `publish-history-${counter}.json`);
};

const makeTools = (overrides: Partial<PublishDeps> = {}): PublishTools =>
  new PublishTools({
    secrets: overrides.secrets ?? secretsWith({}),
    settings:
      overrides.settings ?? (() => ({ telegramChat: "-1001234567890", redditSubreddit: "openmonkey" })),
    fetchImpl: overrides.fetchImpl,
    now: overrides.now,
    historyFile: overrides.historyFile ?? historyFile(),
    queue: overrides.queue,
  });

const telegramTools = (
  queue: PublishQueue,
  now?: () => number,
  historyFilePath?: string,
  calls?: string[]
): PublishTools =>
  makeTools({
    queue,
    now,
    historyFile: historyFilePath,
    secrets: secretsWith({ telegram: { token: BOT_TOKEN } }),
    fetchImpl: (async (url: string | URL) => {
      calls?.push(String(url));
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch,
  });

test("a scheduled post waits for its time instead of going out", async () => {
  const queue = new FakeQueue();
  const calls: string[] = [];
  const tools = telegramTools(queue, () => Date.parse("2026-11-09T10:00:00Z"), undefined, calls);
  const out = await tools.execute("schedule", {
    channel: "telegram",
    text: "Tomorrow's build notes",
    when: "in 45 minutes",
  });

  assert.match(out, /Scheduled: the post goes to -1001234567890/);
  assert.match(out, /Settings → Publishing/);
  assert.equal(queue.posts.length, 1);
  assert.equal(queue.posts[0].status, "pending");
  assert.equal(queue.posts[0].text, "Tomorrow's build notes");
  assert.equal(queue.posts[0].dueAt, Date.parse("2026-11-09T10:45:00Z"));
  assert.deepEqual(calls, [], "nothing was sent yet");
});

test("a time the app cannot read is refused", async () => {
  const tools = telegramTools(new FakeQueue());
  await assert.rejects(
    () => tools.execute("schedule", { channel: "telegram", text: "Later", when: "whenever" }),
    /could not be read/
  );
});

test("a post scheduled for a time that has passed is refused", async () => {
  const tools = telegramTools(new FakeQueue(), () => Date.parse("2026-11-09T10:00:00Z"));
  await assert.rejects(
    () =>
      tools.execute("schedule", {
        channel: "telegram",
        text: "Too late",
        when: "2026-11-09T09:00:00Z",
      }),
    /not in the future/
  );
});

test("a post scheduled without a saved token is refused", async () => {
  const tools = makeTools({ queue: new FakeQueue() });
  await assert.rejects(
    () => tools.execute("schedule", { channel: "telegram", text: "No token", when: "in 10 minutes" }),
    /No telegram token is saved/
  );
});

test("a Reddit post scheduled without a title is refused", async () => {
  const queue = new FakeQueue();
  const tools = makeTools({
    queue,
    secrets: secretsWith({
      reddit: { clientId: "id", clientSecret: "secret", username: "user", password: "pass" },
    }),
  });
  await assert.rejects(
    () => tools.execute("schedule", { channel: "reddit", text: "No title", when: "in 10 minutes" }),
    /needs a title/
  );
});

test("the app reads a time the way a person says it", () => {
  const now = Date.parse("2026-11-09T10:00:00Z");
  assert.equal(parseWhen("in 30 minutes", now), now + 30 * 60_000);
  assert.equal(parseWhen("in 2 hours", now), now + 2 * 60 * 60_000);
  assert.equal(parseWhen("in 1 day", now), now + 24 * 60 * 60_000);
  assert.equal(parseWhen("2026-11-10T09:00:00Z", now), Date.parse("2026-11-10T09:00:00Z"));
});

test("the scheduler sends a post whose time has come", async () => {
  const queue = new FakeQueue();
  const tools = telegramTools(queue, () => Date.parse("2026-11-09T10:00:00Z"));
  await tools.execute("schedule", {
    channel: "telegram",
    text: "It is time",
    when: "in 45 minutes",
  });

  const sent: ScheduledPost[] = [];
  const scheduler = new PublishScheduler({
    queue,
    publisher: tools,
    now: () => Date.parse("2026-11-09T10:45:00Z"),
    runPost: async (post) => {
      sent.push(post);
      return { ok: true };
    },
  });
  await scheduler.tick();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "It is time");
  assert.equal(queue.posts[0].status, "posted");
  assert.ok(queue.posts[0].postedAt);
});

test("the scheduler leaves a post alone until its time", async () => {
  const queue = new FakeQueue();
  const tools = telegramTools(queue, () => Date.parse("2026-11-09T10:00:00Z"));
  await tools.execute("schedule", {
    channel: "telegram",
    text: "Not yet",
    when: "in 45 minutes",
  });

  let called = 0;
  const scheduler = new PublishScheduler({
    queue,
    publisher: tools,
    now: () => Date.parse("2026-11-09T10:30:00Z"),
    runPost: async () => {
      called += 1;
      return { ok: true };
    },
  });
  await scheduler.tick();

  assert.equal(called, 0);
  assert.equal(queue.posts[0].status, "pending");
});

test("the scheduler waits while the quiet hours run", async () => {
  const queue = new FakeQueue();
  const tools = telegramTools(queue, () => Date.parse("2026-11-09T10:00:00Z"));
  await tools.execute("schedule", {
    channel: "telegram",
    text: "Quiet",
    when: "in 45 minutes",
  });

  let called = 0;
  const scheduler = new PublishScheduler({
    queue,
    publisher: tools,
    now: () => Date.parse("2026-11-09T10:45:00Z"),
    quiet: () => true,
    runPost: async () => {
      called += 1;
      return { ok: true };
    },
  });
  await scheduler.tick();

  assert.equal(called, 0);
  assert.equal(queue.posts[0].status, "pending");
});

test("the scheduler waits while network access is off", async () => {
  const queue = new FakeQueue();
  const tools = telegramTools(queue, () => Date.parse("2026-11-09T10:00:00Z"));
  await tools.execute("schedule", {
    channel: "telegram",
    text: "Offline",
    when: "in 45 minutes",
  });

  let called = 0;
  const scheduler = new PublishScheduler({
    queue,
    publisher: tools,
    now: () => Date.parse("2026-11-09T10:45:00Z"),
    networkAllowed: () => false,
    runPost: async () => {
      called += 1;
      return { ok: true };
    },
  });
  await scheduler.tick();

  assert.equal(called, 0);
  assert.equal(queue.posts[0].status, "pending");
});

test("the scheduler waits when the channel has no room left", async () => {
  const queue = new FakeQueue();
  const file = historyFile();
  // Ten Telegram posts in the last hour: the cap for the hour is used up.
  fs.writeFileSync(
    file,
    JSON.stringify({
      telegram: Array.from({ length: 10 }, () => Date.parse("2026-11-09T10:40:00Z")),
      reddit: [],
      bluesky: [],
      mastodon: [],
    })
  );
  const tools = telegramTools(queue, () => Date.parse("2026-11-09T10:45:00Z"), file);
  queue.add({
    channel: "telegram",
    text: "No room",
    dueAt: Date.parse("2026-11-09T10:45:00Z"),
  });

  let called = 0;
  const scheduler = new PublishScheduler({
    queue,
    publisher: tools,
    now: () => Date.parse("2026-11-09T10:45:00Z"),
    runPost: async () => {
      called += 1;
      return { ok: true };
    },
  });
  await scheduler.tick();

  assert.equal(called, 0);
  assert.equal(queue.posts[0].status, "pending");
});

test("the scheduler gives up on a post when publishing is blocked", async () => {
  const queue = new FakeQueue();
  const tools = telegramTools(queue, () => Date.parse("2026-11-09T10:00:00Z"));
  await tools.execute("schedule", {
    channel: "telegram",
    text: "Blocked",
    when: "in 45 minutes",
  });

  const scheduler = new PublishScheduler({
    queue,
    publisher: tools,
    now: () => Date.parse("2026-11-09T10:45:00Z"),
    blocked: () => true,
    runPost: async () => ({ ok: true }),
  });
  await scheduler.tick();

  assert.equal(queue.posts[0].status, "failed");
  assert.match(queue.posts[0].error ?? "", /approval policy/);
});

test("a post that fails is tried again and then given up on", async () => {
  const queue = new FakeQueue();
  const tools = telegramTools(queue, () => Date.parse("2026-11-09T10:00:00Z"));
  await tools.execute("schedule", {
    channel: "telegram",
    text: "Flaky",
    when: "in 45 minutes",
  });

  let attempts = 0;
  const scheduler = new PublishScheduler({
    queue,
    publisher: tools,
    now: () => Date.parse("2026-11-09T10:45:00Z"),
    runPost: async () => {
      attempts += 1;
      return { ok: false, error: "The channel said no." };
    },
  });

  await scheduler.tick();
  assert.equal(attempts, 1);
  assert.equal(queue.posts[0].status, "pending");
  assert.equal(queue.posts[0].attempts, 1);

  await scheduler.tick();
  await scheduler.tick();
  assert.equal(attempts, 3);
  assert.equal(queue.posts[0].status, "failed");
  assert.match(queue.posts[0].error ?? "", /The channel said no\./);
});

test("the queue the app uses keeps the text of a post sealed", () => {
  storage.init();
  const post = publishQueue.add({
    channel: "telegram",
    text: "A secret announcement",
    dueAt: Date.now() + 60_000,
  });

  const db = new Database(path.join(dataRoot(), "openmonkey.db"), { readonly: true });
  try {
    const row = db.prepare("SELECT text FROM scheduled_posts WHERE id = ?").get(post.id) as {
      text: string;
    };
    assert.ok(row.text.startsWith("enc:v1:"));
    assert.equal(row.text.includes("A secret announcement"), false);
  } finally {
    db.close();
  }

  const read = publishQueue.list().find((item) => item.id === post.id);
  assert.equal(read?.text, "A secret announcement");
  publishQueue.remove(post.id);
  assert.equal(publishQueue.list().some((item) => item.id === post.id), false);
});
