import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import Database from "better-sqlite3";
import { PublishTools, type PublishDeps } from "../../src/agent/tools/publish";
import { postDrafts as realDrafts, type PostDraftStore } from "../../src/utils/post-drafts";
import { publishQueue, type PublishQueue } from "../../src/utils/publish-queue";
import storage from "../../src/utils/storage";
import { dataRoot } from "../../src/utils/config";
import type {
  PostDraft,
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

/** The drafts in memory, so a test never depends on what another one left behind. */
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

/** The queue in memory, so a test never depends on what another one left behind. */
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

const makeTools = (overrides: Partial<PublishDeps> = {}): PublishTools =>
  new PublishTools({
    secrets: overrides.secrets ?? secretsWith({}),
    settings:
      overrides.settings ?? (() => ({ telegramChat: "-1001234567890", redditSubreddit: "openmonkey" })),
    fetchImpl: overrides.fetchImpl,
    now: overrides.now,
    drafts: overrides.drafts ?? new FakeDrafts(),
    queue: overrides.queue ?? new FakeQueue(),
  });

const telegramOk = (): Response =>
  new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

test("the agent writes a post down instead of sending it", async () => {
  const drafts = new FakeDrafts();
  const calls: string[] = [];
  const tools = makeTools({
    drafts,
    fetchImpl: (async (url: string | URL) => {
      calls.push(String(url));
      return telegramOk();
    }) as unknown as typeof fetch,
  });

  const out = await tools.execute("draft", {
    channel: "telegram",
    text: "Tomorrow's build notes",
    note: "The follow-up to Monday's post",
  });

  assert.match(out, /Draft saved for telegram/);
  assert.match(out, /Nothing has gone out/);
  assert.deepEqual(calls, [], "nothing was sent");
  assert.equal(drafts.list().length, 1);
  assert.equal(drafts.list()[0].text, "Tomorrow's build notes");
  assert.equal(drafts.list()[0].note, "The follow-up to Monday's post");
});

test("a draft that asks for upvotes is refused before it is written down", async () => {
  const drafts = new FakeDrafts();
  const tools = makeTools({ drafts });

  await assert.rejects(
    tools.execute("draft", {
      channel: "reddit",
      title: "OpenMonkey 1.0",
      text: "It is out. Please upvote this post!",
    }),
    /forbid asking for votes/
  );
  assert.equal(drafts.list().length, 0);
});

test("a draft that will not fit is written down, and says so", async () => {
  const drafts = new FakeDrafts();
  const tools = makeTools({ drafts });

  const out = await tools.execute("draft", { channel: "bluesky", text: "x".repeat(301) });

  assert.match(out, /It will not go out as it stands/);
  assert.match(out, /A Bluesky post holds 300 characters/);
  assert.equal(drafts.list().length, 1);
});

test("the agent can see the drafts it wrote", async () => {
  const drafts = new FakeDrafts();
  const tools = makeTools({ drafts });

  await tools.execute("draft", { channel: "telegram", text: "One draft" });
  await tools.execute("draft", { channel: "bluesky", text: "Another draft" });

  const out = await tools.execute("list_drafts", {});
  assert.match(out, /Post drafts:/);
  assert.match(out, /telegram/);
  assert.match(out, /bluesky/);
});

test("a draft without text is refused", async () => {
  const drafts = new FakeDrafts();
  const tools = makeTools({ drafts });

  await assert.rejects(tools.execute("draft", { channel: "telegram", text: "  " }), /no text/);
  await assert.rejects(tools.execute("draft", { channel: "vimeo", text: "hi" }), /Unknown publishing channel/);
  assert.equal(drafts.list().length, 0);
});

test("the wording the user wrote is the wording that goes out", async () => {
  storage.init();
  const draft = realDrafts.add({ channel: "telegram", text: "The first wording" });
  realDrafts.save({ ...draft, text: "The wording the user chose", updatedAt: Date.now() });

  const edited = realDrafts.get(draft.id);
  assert.equal(edited?.text, "The wording the user chose");

  const bodies: string[] = [];
  const tools = makeTools({
    secrets: secretsWith({ telegram: { token: BOT_TOKEN } }),
    fetchImpl: (async (_url: string | URL, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return telegramOk();
    }) as unknown as typeof fetch,
  });
  await tools.execute("post", { channel: "telegram", text: edited!.text });

  assert.equal(JSON.parse(bodies[0]).text, "The wording the user chose");
  realDrafts.remove(draft.id);
});

test("the text of a draft is sealed on disk", () => {
  storage.init();
  const draft = realDrafts.add({ channel: "telegram", text: "A secret announcement" });

  const db = new Database(path.join(dataRoot(), "openmonkey.db"), { readonly: true });
  try {
    const row = db.prepare("SELECT text FROM post_drafts WHERE id = ?").get(draft.id) as { text: string };
    assert.ok(row.text.startsWith("enc:v1:"));
    assert.equal(row.text.includes("A secret announcement"), false);
  } finally {
    db.close();
  }

  assert.equal(realDrafts.get(draft.id)?.text, "A secret announcement");
  realDrafts.remove(draft.id);
  assert.equal(realDrafts.get(draft.id), null);
});

test("a draft is queued for later under the same rules as an immediate post", () => {
  const queue = new FakeQueue();
  const tools = makeTools({ secrets: secretsWith({}), queue });

  const refused = tools.scheduleApproved({ channel: "telegram", text: "Later" }, "in 45 minutes");
  assert.equal(refused.ok, false);
  assert.match(refused.error ?? "", /No telegram token is saved/);
  assert.equal(queue.posts.length, 0);

  const ready = makeTools({ secrets: secretsWith({ telegram: { token: BOT_TOKEN } }), queue });
  const accepted = ready.scheduleApproved({ channel: "telegram", text: "Later" }, "in 45 minutes");
  assert.equal(accepted.ok, true);
  assert.equal(queue.posts.length, 1);
  assert.equal(queue.posts[0].text, "Later");
  assert.equal(queue.posts[0].status, "pending");
});

test("a draft that asks for votes cannot be queued", () => {
  const queue = new FakeQueue();
  const tools = makeTools({
    secrets: secretsWith({
      reddit: { clientId: "id", clientSecret: "secret", username: "user", password: "pass" },
    }),
    queue,
  });

  const result = tools.scheduleApproved(
    { channel: "reddit", title: "A post", text: "Please upvote this" },
    "in 45 minutes"
  );
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /forbid asking for votes/);
  assert.equal(queue.posts.length, 0);
});

test("a time in the past cannot be queued", () => {
  const queue = new FakeQueue();
  const tools = makeTools({ secrets: secretsWith({ telegram: { token: BOT_TOKEN } }), queue });

  const result = tools.scheduleApproved({ channel: "telegram", text: "Later" }, "whenever");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /could not be read/);
  assert.equal(queue.posts.length, 0);
});

test("the queue the app uses holds a draft that was scheduled", () => {
  storage.init();
  const draft = realDrafts.add({ channel: "telegram", text: "Queued from a draft" });
  publishQueue.add({
    channel: draft.channel,
    text: draft.text,
    dueAt: Date.now() + 60_000,
  });

  const queued = publishQueue.list(["pending"]).find((post) => post.text === "Queued from a draft");
  assert.ok(queued, "the post is in the queue");
  realDrafts.remove(draft.id);
});
