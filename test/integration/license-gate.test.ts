import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { PublishTools, type LicenseGate, type PublishDeps } from "../../src/agent/tools/publish";
import { licenseService } from "../../src/utils/license-service";
import type {
  PostDraft,
  PublisherChannel,
  PublisherSecret,
  ScheduledPost,
  ScheduledPostStatus,
} from "../../src/utils/types";
import type { PublisherSecrets } from "../../src/utils/publisher-secrets";
import type { PostDraftStore } from "../../src/utils/post-drafts";
import type { PublishQueue } from "../../src/utils/publish-queue";

const home = process.env.HOME as string;
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

/** A gate that says no, the way a Mac without a license says no. */
const freeGate: LicenseGate = {
  entitled: () => false,
  require: (feature: string) => {
    throw new Error(`${feature} needs a Pro license. OpenMonkey is free for chat, tools and memory.`);
  },
};

/** A gate that says yes, the way a Mac with a license says yes. */
const proGate: LicenseGate = {
  entitled: () => true,
  require: () => undefined,
};

class FakeDrafts implements PostDraftStore {
  drafts: PostDraft[] = [];

  available(): boolean {
    return true;
  }

  add(draft: {
    channel: PublisherChannel;
    text: string;
    title?: string;
    imageUrl?: string;
    note?: string;
  }): PostDraft {
    const now = Date.now();
    const created: PostDraft = {
      ...draft,
      id: `draft_${this.drafts.length + 1}`,
      createdAt: now,
      updatedAt: now,
    };
    this.drafts.push(created);
    return created;
  }

  list(): PostDraft[] {
    return [...this.drafts];
  }

  get(id: string): PostDraft | null {
    return this.drafts.find((draft) => draft.id === id) ?? null;
  }

  save(draft: PostDraft): void {
    const index = this.drafts.findIndex((item) => item.id === draft.id);
    if (index >= 0) this.drafts[index] = draft;
    else this.drafts.push(draft);
  }

  remove(id: string): void {
    this.drafts = this.drafts.filter((draft) => draft.id !== id);
  }
}

class FakeQueue implements PublishQueue {
  posts: ScheduledPost[] = [];

  available(): boolean {
    return true;
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
  return path.join(home, "Documents", `license-gate-history-${counter}.json`);
};

const makeTools = (overrides: Partial<PublishDeps> = {}): PublishTools =>
  new PublishTools({
    secrets: overrides.secrets ?? secretsWith({ telegram: { token: BOT_TOKEN } }),
    settings: () => ({ telegramChat: "-1001234567890", redditSubreddit: "openmonkey" }),
    fetchImpl: overrides.fetchImpl,
    now: overrides.now,
    historyFile: historyFile(),
    drafts: new FakeDrafts(),
    queue: new FakeQueue(),
    license: overrides.license,
  });

const telegramOk = (): Response =>
  new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

test("a post without a license never leaves the Mac", async () => {
  let asked = 0;
  const tools = makeTools({
    license: freeGate,
    fetchImpl: (async () => {
      asked += 1;
      return telegramOk();
    }) as unknown as typeof fetch,
  });

  await assert.rejects(
    tools.execute("post", { channel: "telegram", text: "Hello from the desk" }),
    /needs a Pro license/
  );
  assert.equal(asked, 0, "nothing was sent");
});

test("a draft without a license is not written down either", async () => {
  const drafts = new FakeDrafts();
  const tools = makeTools({ license: freeGate, drafts });

  await assert.rejects(
    tools.execute("draft", { channel: "telegram", text: "Tomorrow's notes" }),
    /needs a Pro license/
  );
  assert.equal(drafts.list().length, 0);
});

test("a post that is queued for later needs the license too", async () => {
  const tools = makeTools({ license: freeGate });
  await assert.rejects(
    tools.execute("schedule", { channel: "telegram", text: "Later", when: "in 45 minutes" }),
    /needs a Pro license/
  );
});

test("a post the user queues from the settings page needs the license too", () => {
  const queue = new FakeQueue();
  const tools = makeTools({ license: freeGate, queue });

  const result = tools.scheduleApproved({ channel: "telegram", text: "Later" }, "in 45 minutes");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /needs a Pro license/);
  assert.equal(queue.posts.length, 0);
});

test("with a license the post goes out exactly as before", async () => {
  const calls: string[] = [];
  const tools = makeTools({
    license: proGate,
    fetchImpl: (async (url: string | URL) => {
      calls.push(String(url));
      return telegramOk();
    }) as unknown as typeof fetch,
  });

  const out = await tools.execute("post", { channel: "telegram", text: "Hello from the desk" });
  assert.match(out, /Posted to Telegram/);
  assert.equal(calls.length, 1);
});

test("a fresh Mac is on trial, so publishing works before a license is bought", () => {
  const state = licenseService.state();
  assert.equal(state.tier, "pro");
  assert.equal(state.status, "trial");
  assert.ok((state.daysLeft ?? 0) > 0, "the trial has days left");
  assert.equal(licenseService.entitled(), true);
});
