import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { WebBrowserTools } from "../../src/agent/tools/web-browser";
import config from "../../src/utils/config";

const home = process.env.HOME as string;

const openverseBody = (results: unknown[]) => JSON.stringify({ result_count: results.length, results });

const commonsBody = (pages: Record<string, unknown>) => JSON.stringify({ query: { pages } });

const commonsPage = (index: number, title: string, url: string, license: string, artist: string) => ({
  [`p${index}`]: {
    index,
    title,
    descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
    imageinfo: [
      {
        url: `${url}?utm_source=commons.wikimedia.org&utm_campaign=imageinfo`,
        width: 3023,
        height: 2848,
        extmetadata: { Artist: { value: artist }, LicenseShortName: { value: license } },
      },
    ],
  },
});

const openverseHit = {
  title: "Snow leopard on a ridge",
  url: "https://live.example.org/photos/leopard.jpg",
  foreign_landing_url: "https://example.org/photos/leopard",
  creator: "Tanzania Park Service",
  license: "by",
  license_version: "2.0",
  width: 1600,
  height: 900,
};

/**
 * Every fetch is answered from this table, so the suite proves the parsing and the
 * guards without depending on what a search API returns today.
 */
const withFetch = async (
  handler: (url: string) => { body: string | Buffer; status?: number; contentType?: string },
  run: (asked: string[]) => Promise<void>
): Promise<void> => {
  const asked: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    asked.push(url);
    const reply = handler(url);
    return new Response(reply.body as BodyInit, {
      status: reply.status ?? 200,
      headers: { "content-type": reply.contentType ?? "application/json" },
    });
  }) as unknown as typeof fetch;
  try {
    await run(asked);
  } finally {
    globalThis.fetch = original;
  }
};

test("an image search names the licence, the credit and where the picture came from", async () => {
  await withFetch(
    () => ({ body: openverseBody([openverseHit]) }),
    async (asked) => {
      const out = await new WebBrowserTools().execute("image_search", { query: "snow leopard", count: 5 });
      assert.match(out, /Snow leopard on a ridge/);
      assert.match(out, /1600x900/);
      assert.match(out, /by 2\.0/);
      assert.match(out, /Tanzania Park Service/);
      assert.ok(out.includes(openverseHit.url), out);
      assert.ok(out.includes(openverseHit.foreign_landing_url), out);
      assert.match(asked[0], /api\.openverse\.org\/v1\/images/);
      assert.match(asked[0], /page_size=5/);
    }
  );
});

test("when Openverse is down the search still answers from Wikimedia Commons", async () => {
  await withFetch(
    (url) =>
      url.includes("api.openverse.org")
        ? { body: "Server Error (500)", status: 500, contentType: "text/html" }
        : { body: commonsBody(commonsPage(1, "File:Snow leopard portrait.jpg", "https://up.example.org/a.jpg", "CC BY-SA 2.0", "<a href=\"https://f.example.org\">Tim Vritaka</a>")) },
    async (asked) => {
      const out = await new WebBrowserTools().execute("image_search", { query: "snow leopard" });
      assert.match(out, /Wikimedia Commons/);
      assert.match(out, /Snow leopard portrait\.jpg/);
      assert.match(out, /3023x2848/);
      assert.match(out, /CC BY-SA 2\.0/);
      assert.match(out, /Tim Vritaka/);
      // The tracking query the API adds is not part of the file's address.
      assert.ok(out.includes("https://up.example.org/a.jpg\n"), out);
      assert.equal(asked.some((url) => url.includes("commons.wikimedia.org")), true);
    }
  );
});

test("an entry with no fetchable picture is dropped", async () => {
  await withFetch(
    (url) =>
      url.includes("api.openverse.org")
        ? { body: openverseBody([{ title: "no url" }, { ...openverseHit, url: "ftp://example.org/x" }]) }
        : { body: commonsBody({}) },
    async () => {
      const out = await new WebBrowserTools().execute("image_search", { query: "nothing usable" });
      assert.match(out, /found nothing/);
      assert.match(out, /Openverse: nothing licensed/);
      assert.match(out, /Wikimedia Commons: nothing licensed/);
    }
  );
});

test("a broken source is named instead of looking like an empty result", async () => {
  await withFetch(
    () => ({ body: "<html>blocked</html>", contentType: "text/html" }),
    async () => {
      const out = await new WebBrowserTools().execute("image_search", { query: "cats" });
      assert.match(out, /Openverse: the answer is not JSON/);
      assert.match(out, /Wikimedia Commons: the answer is not JSON/);
    }
  );
});

test("the daily anonymous cap is reported rather than retried away", async () => {
  await withFetch(
    () => ({ body: "quota", status: 429 }),
    async () => {
      const out = await new WebBrowserTools().execute("image_search", { query: "cats" });
      assert.match(out, /capped for this network/);
    }
  );
});

test("saving an image writes the bytes it was given and fixes the extension", async () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const folder = path.join(home, "Documents", "web-images-test");
  const file = path.join(folder, "leopard");

  await withFetch(
    (url) =>
      url.endsWith("/robots.txt")
        ? { body: "", contentType: "text/plain" }
        : { body: png, contentType: "image/png" },
    async () => {
      const out = await new WebBrowserTools().execute("save_image", { url: openverseHit.url, path: file });
      assert.match(out, /image\/png/);
      assert.ok(out.includes(`${file}.png`), out);
      assert.deepEqual(await fs.readFile(`${file}.png`), png);
      assert.equal(await fs.stat(file).then(() => true, () => false), false);
    }
  );
  await fs.rm(folder, { recursive: true, force: true });
});

test("a page that serves html is refused before anything is written", async () => {
  const file = path.join(home, "Documents", "web-images-refused", "not-an-image.png");
  await withFetch(
    (url) =>
      url.endsWith("/robots.txt")
        ? { body: "", contentType: "text/plain" }
        : { body: "<html>nope</html>", contentType: "text/html" },
    async () => {
      await assert.rejects(
        new WebBrowserTools().execute("save_image", { url: "https://example.org/tracker", path: file }),
        /not an image this app can save/
      );
      assert.equal(await fs.stat(file).then(() => true, () => false), false);
    }
  );
  await fs.rm(path.join(home, "Documents", "web-images-refused"), { recursive: true, force: true });
});

test("saving outside the allowed folders is refused without downloading", async () => {
  await withFetch(
    () => ({ body: "nothing", contentType: "image/png" }),
    async (asked) => {
      await assert.rejects(
        new WebBrowserTools().execute("save_image", { url: openverseHit.url, path: path.join(home, "outside", "x.png") }),
        /outside the allowed folders/
      );
      assert.deepEqual(asked, []);
    }
  );
});

test("with the network switch off an image search asks for nothing", async () => {
  const privacy = config.get("privacy");
  config.set("privacy", { ...privacy, networkAllowed: false });
  try {
    await withFetch(
      () => ({ body: openverseBody([openverseHit]) }),
      async (asked) => {
        await assert.rejects(new WebBrowserTools().execute("image_search", { query: "cats" }), /Network access is off/);
        assert.deepEqual(asked, []);
      }
    );
  } finally {
    config.set("privacy", privacy);
  }
});
