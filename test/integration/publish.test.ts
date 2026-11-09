import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PublishTools, buildSecret, type PublishDeps } from "../../src/agent/tools/publish";
import type { PublisherChannel, PublisherSecret } from "../../src/utils/types";
import type { PublisherSecrets } from "../../src/utils/publisher-secrets";
import config from "../../src/utils/config";

const home = process.env.HOME as string;

const BOT_TOKEN = "123456789:AAHfiqksKZ8WmTn2a1b2c3d4e5f6g7h8i";

interface Call {
  url: string;
  init: RequestInit;
}

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

let historyCounter = 0;

/** Each test gets its own cap file, so one test's posts never block another's. */
const historyFile = (): string => {
  historyCounter += 1;
  return path.join(home, "Documents", `publish-history-${historyCounter}.json`);
};

const makeTools = (overrides: Partial<PublishDeps> = {}): PublishTools =>
  new PublishTools({
    secrets: overrides.secrets ?? secretsWith({}),
    settings:
      overrides.settings ?? (() => ({ telegramChat: "-1001234567890", redditSubreddit: "openmonkey" })),
    fetchImpl: overrides.fetchImpl,
    now: overrides.now,
    historyFile: overrides.historyFile ?? historyFile(),
  });

const jsonReply = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const telegramOk = (): Response =>
  jsonReply({ ok: true, result: { message_id: 42, chat: { title: "OpenMonkey News" } } });

const redditOk = (): Response =>
  jsonReply({ json: { errors: [], data: { id: "abc123", name: "t3_abc123" } } });

/** A picture as the channel would see it: bytes and a type. */
const imageReply = (type = "image/png", size = 8): Response =>
  new Response(new Uint8Array(size), { status: 200, headers: { "content-type": type } });

const BLUESKY_SESSION = {
  accessJwt: "jwt-123",
  did: "did:plc:openmonkey",
  handle: "openmonkey.bsky.social",
};

test("a Telegram post carries the text and the chat the user chose", async () => {
  const calls: Call[] = [];
  const tools = makeTools({
    secrets: secretsWith({ telegram: { token: BOT_TOKEN } }),
    fetchImpl: (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return telegramOk();
    }) as unknown as typeof fetch,
  });

  const out = await tools.execute("post", { channel: "telegram", text: "Hello from the desk" });
  assert.match(out, /Posted to Telegram OpenMonkey News \(message 42\)/);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes(`/bot${BOT_TOKEN}/sendMessage`), calls[0].url);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    chat_id: "-1001234567890",
    text: "Hello from the desk",
    disable_web_page_preview: true,
  });
});

test("a picture is posted as a photo with the text as its caption", async () => {
  const calls: Call[] = [];
  const tools = makeTools({
    secrets: secretsWith({ telegram: { token: BOT_TOKEN } }),
    fetchImpl: (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return telegramOk();
    }) as unknown as typeof fetch,
  });

  await tools.execute("post", {
    channel: "telegram",
    text: "New release",
    imageUrl: "https://images.example.org/cover.png",
  });
  assert.ok(calls[0].url.endsWith("/sendPhoto"), calls[0].url);
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.photo, "https://images.example.org/cover.png");
  assert.equal(body.caption, "New release");
});

test("Reddit asks for a token and then posts the title and the text", async () => {
  const calls: Call[] = [];
  const tools = makeTools({
    secrets: secretsWith({
      reddit: { clientId: "appid", clientSecret: "appsecret", username: "openmonkey", password: "hunter2" },
    }),
    fetchImpl: (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return calls.length === 1 ? jsonReply({ access_token: "token-123" }) : redditOk();
    }) as unknown as typeof fetch,
  });

  const out = await tools.execute("post", {
    channel: "reddit",
    title: "OpenMonkey 1.0",
    text: "The desktop agent is out.",
  });
  assert.match(out, /Posted to Reddit r\/openmonkey/);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.includes("reddit.com/api/v1/access_token"), calls[0].url);
  assert.match(String((calls[0].init.headers as Record<string, string>).authorization), /^Basic /);
  assert.match(String((calls[0].init.headers as Record<string, string>)["user-agent"]), /u\/openmonkey/);

  const submit = new URLSearchParams(String(calls[1].init.body));
  assert.equal(submit.get("sr"), "openmonkey");
  assert.equal(submit.get("title"), "OpenMonkey 1.0");
  assert.equal(submit.get("text"), "The desktop agent is out.");
  assert.equal(submit.get("kind"), "self");
});

test("a post that asks for upvotes is refused before it leaves the Mac", async () => {
  let asked = 0;
  const tools = makeTools({
    secrets: secretsWith({
      reddit: { clientId: "appid", clientSecret: "appsecret", username: "openmonkey", password: "hunter2" },
    }),
    fetchImpl: (async () => {
      asked += 1;
      return jsonReply({});
    }) as unknown as typeof fetch,
  });

  await assert.rejects(
    tools.execute("post", {
      channel: "reddit",
      title: "OpenMonkey 1.0",
      text: "It is out. Please upvote this post!",
    }),
    /forbid asking for votes/
  );
  assert.equal(asked, 0);
});

test("a post without a token or without a target names what is missing", async () => {
  const withoutToken = makeTools({ secrets: secretsWith({}) });
  await assert.rejects(
    withoutToken.execute("post", { channel: "telegram", text: "hi" }),
    /No telegram token is saved/
  );
  await assert.rejects(
    withoutToken.execute("post", { channel: "bluesky", text: "hi" }),
    /No bluesky app password is saved/
  );
  await assert.rejects(
    withoutToken.execute("post", { channel: "mastodon", text: "hi" }),
    /No mastodon access token is saved/
  );

  const withoutTarget = makeTools({
    secrets: secretsWith({ telegram: { token: BOT_TOKEN } }),
    settings: () => ({ telegramChat: "", redditSubreddit: "openmonkey" }),
  });
  await assert.rejects(
    withoutTarget.execute("post", { channel: "telegram", text: "hi" }),
    /No telegram target is set/
  );
});

test("the hourly cap stops a channel that would look like a bot", async () => {
  const calls: Call[] = [];
  let clock = 1_700_000_000_000;
  const tools = makeTools({
    secrets: secretsWith({
      reddit: { clientId: "appid", clientSecret: "appsecret", username: "openmonkey", password: "hunter2" },
    }),
    now: () => clock,
    fetchImpl: (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return calls.length % 2 === 1 ? jsonReply({ access_token: "token-123" }) : redditOk();
    }) as unknown as typeof fetch,
  });

  const post = () => tools.execute("post", { channel: "reddit", title: "A post", text: "Body" });
  await post();
  clock += 16 * 60_000;
  await post();
  clock += 16 * 60_000;
  await assert.rejects(post(), /allows 2 posts an hour/);
});

test("two posts in a row are refused until the gap has passed", async () => {
  const tools = makeTools({
    secrets: secretsWith({
      reddit: { clientId: "appid", clientSecret: "appsecret", username: "openmonkey", password: "hunter2" },
    }),
    fetchImpl: (async () => jsonReply({ access_token: "token-123" })) as unknown as typeof fetch,
  });
  await tools.execute("post", { channel: "reddit", title: "A post", text: "Body" });
  await assert.rejects(
    tools.execute("post", { channel: "reddit", title: "Another post", text: "Body" }),
    /too recent/
  );
});

test("with the network switch off a post asks for nothing", async () => {
  let asked = 0;
  const privacy = config.get("privacy");
  config.set("privacy", { ...privacy, networkAllowed: false });
  try {
    const tools = makeTools({
      secrets: secretsWith({ telegram: { token: BOT_TOKEN } }),
      fetchImpl: (async () => {
        asked += 1;
        return telegramOk();
      }) as unknown as typeof fetch,
    });
    await assert.rejects(
      tools.execute("post", { channel: "telegram", text: "hi" }),
      /Network access is off/
    );
    assert.equal(asked, 0);
  } finally {
    config.set("privacy", privacy);
  }
});

test("the channel list never shows the token it holds", async () => {
  const tools = makeTools({ secrets: secretsWith({ telegram: { token: BOT_TOKEN } }) });
  const out = await tools.execute("list_channels", {});
  assert.ok(!out.includes(BOT_TOKEN), out);
  assert.match(out, /telegram: ready/);
  assert.match(out, /reddit: not configured/);
});

test("the check tells the user which account the token belongs to", async () => {
  const tools = makeTools({
    secrets: secretsWith({ telegram: { token: BOT_TOKEN } }),
    fetchImpl: (async () => jsonReply({ ok: true, result: { username: "openmonkey_bot" } })) as unknown as typeof fetch,
  });
  const out = await tools.check("telegram");
  assert.match(out, /@openmonkey_bot/);
  assert.ok(!out.includes(BOT_TOKEN), out);
});

test("a channel that refuses the post names the reason", async () => {
  const tools = makeTools({
    secrets: secretsWith({ telegram: { token: BOT_TOKEN } }),
    fetchImpl: (async () => jsonReply({ ok: false, description: "chat not found" })) as unknown as typeof fetch,
  });
  await assert.rejects(
    tools.execute("post", { channel: "telegram", text: "hi" }),
    /Telegram refused the message: chat not found/
  );
});

test("the length limits of each channel are enforced", async () => {
  const tools = makeTools({ secrets: secretsWith({ telegram: { token: BOT_TOKEN } }) });
  await assert.rejects(
    tools.execute("post", { channel: "telegram", text: "x".repeat(1_100), imageUrl: "https://x/y.png" }),
    /photo caption holds 1024 characters/
  );

  const reddit = makeTools({
    secrets: secretsWith({
      reddit: { clientId: "appid", clientSecret: "appsecret", username: "openmonkey", password: "hunter2" },
    }),
  });
  await assert.rejects(
    reddit.execute("post", { channel: "reddit", text: "Body" }),
    /needs a title/
  );
  await assert.rejects(
    reddit.execute("post", { channel: "reddit", title: "A post", text: "Body", imageUrl: "https://x/y.png" }),
    /cannot carry an image/
  );
});

test("the saved credentials hold only what the channel needs", async () => {
  const telegram = buildSecret("telegram", { token: `  ${BOT_TOKEN}  `, password: "ignored" });
  assert.deepEqual(telegram, { token: BOT_TOKEN });

  const reddit = buildSecret("reddit", {
    clientId: "appid",
    clientSecret: "appsecret",
    username: "openmonkey",
    password: "hunter2",
    token: "ignored",
  });
  assert.deepEqual(reddit, {
    clientId: "appid",
    clientSecret: "appsecret",
    username: "openmonkey",
    password: "hunter2",
  });

  assert.throws(() => buildSecret("telegram", { token: "not-a-token" }), /Telegram bot token/);
  assert.throws(() => buildSecret("reddit", { clientId: "appid" }), /needs the script app id/);

  const bluesky = buildSecret("bluesky", {
    identifier: "  openmonkey.bsky.social  ",
    password: "app-pass-123",
    token: "ignored",
  });
  assert.deepEqual(bluesky, { identifier: "openmonkey.bsky.social", password: "app-pass-123" });

  const mastodon = buildSecret("mastodon", { accessToken: "  token-abc  ", password: "ignored" });
  assert.deepEqual(mastodon, { accessToken: "token-abc" });

  assert.throws(() => buildSecret("bluesky", { identifier: "openmonkey.bsky.social" }), /app password itself/);
  assert.throws(() => buildSecret("bluesky", { identifier: "not a handle", password: "x" }), /does not look like/);
  assert.throws(() => buildSecret("mastodon", {}), /Mastodon access token is required/);
  assert.throws(() => buildSecret("mastodon" as PublisherChannel, {}), /Mastodon access token/);
  assert.throws(() => buildSecret("vimeo" as PublisherChannel, {}), /Unknown publishing channel/);
});

test("a Bluesky post signs in and writes the record", async () => {
  const calls: Call[] = [];
  const tools = makeTools({
    secrets: secretsWith({
      bluesky: { identifier: "openmonkey.bsky.social", password: "app-pass-123" },
    }),
    settings: () => ({
      telegramChat: "",
      redditSubreddit: "",
      blueskyHandle: "openmonkey.bsky.social",
    }),
    fetchImpl: (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).includes("createSession")) return jsonReply(BLUESKY_SESSION);
      return jsonReply({ uri: "at://did:plc:openmonkey/app.bsky.feed.post/1", cid: "cid-1" });
    }) as unknown as typeof fetch,
  });

  const out = await tools.execute("post", { channel: "bluesky", text: "Hello from the desk" });
  assert.match(out, /Posted to Bluesky @openmonkey\.bsky\.social/);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.includes("com.atproto.server.createSession"), calls[0].url);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    identifier: "openmonkey.bsky.social",
    password: "app-pass-123",
  });

  assert.ok(calls[1].url.includes("com.atproto.repo.createRecord"), calls[1].url);
  assert.match(String((calls[1].init.headers as Record<string, string>).authorization), /^Bearer jwt-123$/);
  const body = JSON.parse(String(calls[1].init.body));
  assert.equal(body.repo, "did:plc:openmonkey");
  assert.equal(body.collection, "app.bsky.feed.post");
  assert.equal(body.record.$type, "app.bsky.feed.post");
  assert.equal(body.record.text, "Hello from the desk");
  assert.ok(body.record.createdAt, "the record says when it was made");
});

test("a Bluesky picture is uploaded first and the post points at it", async () => {
  const calls: Call[] = [];
  const tools = makeTools({
    secrets: secretsWith({
      bluesky: { identifier: "openmonkey.bsky.social", password: "app-pass-123" },
    }),
    settings: () => ({
      telegramChat: "",
      redditSubreddit: "",
      blueskyHandle: "openmonkey.bsky.social",
    }),
    fetchImpl: (async (url: string | URL, init?: RequestInit) => {
      const address = String(url);
      calls.push({ url: address, init: init ?? {} });
      if (address.includes("createSession")) return jsonReply(BLUESKY_SESSION);
      if (address.includes("uploadBlob")) return jsonReply({ blob: { $type: "blob", ref: "ref-1" } });
      if (address.startsWith("https://images.example.org")) return imageReply("image/png", 32);
      return jsonReply({ uri: "at://did:plc:openmonkey/app.bsky.feed.post/2" });
    }) as unknown as typeof fetch,
  });

  await tools.execute("post", {
    channel: "bluesky",
    text: "New release",
    imageUrl: "https://images.example.org/cover.png",
  });

  const upload = calls.find((call) => call.url.includes("uploadBlob"));
  assert.ok(upload, "the picture was uploaded");
  assert.equal(upload.init.headers && (upload.init.headers as Record<string, string>)["content-type"], "image/png");

  const record = calls.find((call) => call.url.includes("createRecord"));
  assert.ok(record, "the record was written");
  const body = JSON.parse(String(record.init.body));
  assert.equal(body.record.embed.$type, "app.bsky.embed.images");
  assert.equal(body.record.embed.images[0].image.ref, "ref-1");
});

test("a Bluesky sign-in for another account is refused", async () => {
  const tools = makeTools({
    secrets: secretsWith({
      bluesky: { identifier: "openmonkey.bsky.social", password: "app-pass-123" },
    }),
    settings: () => ({
      telegramChat: "",
      redditSubreddit: "",
      blueskyHandle: "someone-else.bsky.social",
    }),
    fetchImpl: (async () => jsonReply(BLUESKY_SESSION)) as unknown as typeof fetch,
  });

  await assert.rejects(
    tools.execute("post", { channel: "bluesky", text: "Hello" }),
    /belongs to @openmonkey\.bsky\.social, not to @someone-else\.bsky\.social/
  );
});

test("a Bluesky post holds 300 characters a reader can see", async () => {
  const tools = makeTools({
    secrets: secretsWith({
      bluesky: { identifier: "openmonkey.bsky.social", password: "app-pass-123" },
    }),
    settings: () => ({
      telegramChat: "",
      redditSubreddit: "",
      blueskyHandle: "openmonkey.bsky.social",
    }),
    fetchImpl: (async () => jsonReply(BLUESKY_SESSION)) as unknown as typeof fetch,
  });

  // An emoji is two code points but one character to a reader.
  const emoji = "😀".repeat(301);
  await assert.rejects(
    tools.execute("post", { channel: "bluesky", text: emoji }),
    /A Bluesky post holds 300 characters; this one has 301/
  );
});

test("a Mastodon post uploads the picture and then the status", async () => {
  const calls: Call[] = [];
  const tools = makeTools({
    secrets: secretsWith({ mastodon: { accessToken: "token-abc" } }),
    settings: () => ({
      telegramChat: "",
      redditSubreddit: "",
      mastodonInstance: "https://mastodon.social",
    }),
    fetchImpl: (async (url: string | URL, init?: RequestInit) => {
      const address = String(url);
      calls.push({ url: address, init: init ?? {} });
      if (address.includes("/api/v2/media")) return jsonReply({ id: "media-1" });
      if (address.startsWith("https://images.example.org")) return imageReply("image/jpeg", 64);
      return jsonReply({ url: "https://mastodon.social/@openmonkey/1", account: { acct: "openmonkey" } });
    }) as unknown as typeof fetch,
  });

  const out = await tools.execute("post", {
    channel: "mastodon",
    text: "Hello from the desk",
    imageUrl: "https://images.example.org/cover.jpg",
  });
  assert.match(out, /Posted to Mastodon openmonkey/);

  const media = calls.find((call) => call.url.includes("/api/v2/media"));
  assert.ok(media, "the picture was uploaded");
  assert.match(String((media.init.headers as Record<string, string>).authorization), /^Bearer token-abc$/);

  const status = calls.find((call) => call.url.includes("/api/v1/statuses"));
  assert.ok(status, "the status was written");
  const body = JSON.parse(String(status.init.body));
  assert.equal(body.status, "Hello from the desk");
  assert.deepEqual(body.media_ids, ["media-1"]);
});

test("a Mastodon post needs an https instance", async () => {
  const tools = makeTools({
    secrets: secretsWith({ mastodon: { accessToken: "token-abc" } }),
    settings: () => ({
      telegramChat: "",
      redditSubreddit: "",
      mastodonInstance: "http://mastodon.social",
    }),
    fetchImpl: (async () => {
      throw new Error("the instance should never be called");
    }) as unknown as typeof fetch,
  });

  await assert.rejects(
    tools.execute("post", { channel: "mastodon", text: "Hello" }),
    /not an https address/
  );
});

test("a Mastodon post holds 500 characters", async () => {
  const tools = makeTools({
    secrets: secretsWith({ mastodon: { accessToken: "token-abc" } }),
    settings: () => ({
      telegramChat: "",
      redditSubreddit: "",
      mastodonInstance: "https://mastodon.social",
    }),
    fetchImpl: (async () => jsonReply({})) as unknown as typeof fetch,
  });

  await assert.rejects(
    tools.execute("post", { channel: "mastodon", text: "x".repeat(501) }),
    /A Mastodon post holds 500 characters; this one has 501/
  );
});

test("a picture from the local network is never fetched", async () => {
  const tools = makeTools({
    secrets: secretsWith({ mastodon: { accessToken: "token-abc" } }),
    settings: () => ({
      telegramChat: "",
      redditSubreddit: "",
      mastodonInstance: "https://mastodon.social",
    }),
    fetchImpl: (async () => {
      throw new Error("the picture should never be fetched");
    }) as unknown as typeof fetch,
  });

  await assert.rejects(
    tools.execute("post", {
      channel: "mastodon",
      text: "Hello",
      imageUrl: "http://127.0.0.1:8080/secret.png",
    }),
    /private address/
  );
  await assert.rejects(
    tools.execute("post", {
      channel: "mastodon",
      text: "Hello",
      imageUrl: "file:///etc/passwd",
    }),
    /only http\(s\) is allowed/
  );
});

test("the check names the Bluesky and the Mastodon account", async () => {
  const bluesky = makeTools({
    secrets: secretsWith({
      bluesky: { identifier: "openmonkey.bsky.social", password: "app-pass-123" },
    }),
    settings: () => ({
      telegramChat: "",
      redditSubreddit: "",
      blueskyHandle: "openmonkey.bsky.social",
    }),
    fetchImpl: (async () => jsonReply(BLUESKY_SESSION)) as unknown as typeof fetch,
  });
  const blueskyOut = await bluesky.check("bluesky");
  assert.match(blueskyOut, /@openmonkey\.bsky\.social/);
  assert.ok(!blueskyOut.includes("app-pass-123"), blueskyOut);

  const mastodon = makeTools({
    secrets: secretsWith({ mastodon: { accessToken: "token-abc" } }),
    settings: () => ({
      telegramChat: "",
      redditSubreddit: "",
      mastodonInstance: "https://mastodon.social",
    }),
    fetchImpl: (async () => jsonReply({ acct: "openmonkey" })) as unknown as typeof fetch,
  });
  const mastodonOut = await mastodon.check("mastodon");
  assert.match(mastodonOut, /@openmonkey on https:\/\/mastodon\.social/);
  assert.ok(!mastodonOut.includes("token-abc"), mastodonOut);
});

test("the cap file records the posts that were made", async () => {
  const file = historyFile();
  const tools = makeTools({
    secrets: secretsWith({ telegram: { token: BOT_TOKEN } }),
    historyFile: file,
    fetchImpl: (async () => telegramOk()) as unknown as typeof fetch,
  });
  await tools.execute("post", { channel: "telegram", text: "hi" });
  const saved = JSON.parse(await fs.readFile(file, "utf8")) as { telegram: number[] };
  assert.equal(saved.telegram.length, 1);
  await fs.rm(file, { force: true });
});
