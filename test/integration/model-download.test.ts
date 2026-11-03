import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { ModelDownloader } from "../../src/models/model-downloader";
import { BONSAI_4B, type GgufModelEntry } from "../../src/models/catalog";
import type { ModelDownloadStatus } from "../../src/utils/types";

/**
 * A stand-in for the release with the same shape and a few kilobytes of body, served
 * from loopback: the resume, the digest and the space rule are what is being proven,
 * and none of them need 572 MB of weights or a request that leaves this Mac.
 */
const body = Buffer.concat([Buffer.from("GGUF"), Buffer.alloc(4096, 7)]);
const digest = createHash("sha256").update(body).digest("hex");

let server: http.Server;
let url = "";
const ranges: (string | undefined)[] = [];

before(async () => {
  server = http.createServer((req, res) => {
    ranges.push(req.headers.range);
    const match = /bytes=(\d+)-/.exec(req.headers.range ?? "");
    if (match) {
      const from = Number(match[1]);
      res.writeHead(206, {
        "content-range": `bytes ${from}-${body.length - 1}/${body.length}`,
        "content-length": String(body.length - from),
      });
      res.end(body.subarray(from));
      return;
    }
    res.writeHead(200, { "content-length": String(body.length) });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as net.AddressInfo;
  url = `http://127.0.0.1:${address.port}/Bonsai-4B.gguf`;
});

after(() => {
  server.close();
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmonkey-download-"));
const entry = (overrides: Partial<GgufModelEntry> = {}): GgufModelEntry => ({
  ...BONSAI_4B,
  bytes: body.length,
  sha256: digest,
  url,
  ...overrides,
});

const statuses: ModelDownloadStatus[] = [];

/** A downloader pointed at a temp folder, with the volume's free space handed to it. */
function harness(dest: string, freeBytes: () => number | null = () => null, overrides: Partial<GgufModelEntry> = {}) {
  const downloader = new ModelDownloader((status) => statuses.push(status), {
    entry: entry(overrides),
    dest,
    freeBytes,
  });
  return downloader;
}

let folder = 0;
const nextDir = () => path.join(root, `case-${folder++}`);

test("a download lands the file and its pinned digest", async () => {
  const dir = nextDir();
  const dest = path.join(dir, "Bonsai-4B.gguf");
  const status = await harness(dest).download();

  assert.equal(status.phase, "done");
  assert.equal(status.verified, true);
  assert.equal(status.bytesReceived, body.length);
  assert.equal(fs.readFileSync(dest).toString("hex"), body.toString("hex"));
});

test("a half-finished download asks only for the bytes it is missing", async () => {
  const dir = nextDir();
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, "Bonsai-4B.gguf");
  const kept = 1000;
  fs.writeFileSync(`${dest}.part`, body.subarray(0, kept));

  ranges.length = 0;
  const status = await harness(dest).download();

  assert.equal(status.phase, "done");
  assert.deepEqual(ranges, [`bytes=${kept}-`]);
  assert.equal(fs.readFileSync(dest).toString("hex"), body.toString("hex"));
});

test("a file that fails the digest is never put in place", async () => {
  const dir = nextDir();
  const dest = path.join(dir, "Bonsai-4B.gguf");
  const status = await harness(dest, () => null, { sha256: "0".repeat(64) }).download();

  assert.equal(status.phase, "error");
  assert.match(status.error ?? "", /SHA-256/);
  assert.equal(fs.existsSync(dest), false);
  assert.equal(fs.existsSync(`${dest}.part`), false);
});

test("a volume without room is refused before a byte is asked for", async () => {
  const dir = nextDir();
  const dest = path.join(dir, "Bonsai-4B.gguf");
  ranges.length = 0;

  const status = await harness(dest, () => 1_000).download();

  assert.equal(status.phase, "error");
  assert.match(status.error ?? "", /Not enough free space/);
  assert.equal(ranges.length, 0);
  assert.equal(fs.existsSync(dest), false);
  assert.equal(fs.existsSync(`${dest}.part`), false);
});

test("the status names what the download needs and what the volume holds", () => {
  const dir = nextDir();
  const downloader = harness(path.join(dir, "Bonsai-4B.gguf"), () => 5_000_000_000);
  const status = downloader.current;

  assert.equal(status.availableBytes, 5_000_000_000);
  // The whole file plus the room kept clear so the volume cannot fill mid-download.
  assert.equal(status.requiredBytes, body.length + 64_000_000);
});

test("a GGUF the user already has is put in place, and the original stays", async () => {
  const dir = nextDir();
  fs.mkdirSync(dir, { recursive: true });
  const source = path.join(dir, "somewhere-else.gguf");
  const dest = path.join(dir, "models", "Bonsai-4B.gguf");
  fs.writeFileSync(source, body);

  const status = await harness(dest).importFrom(source);

  assert.equal(status.phase, "done");
  assert.equal(status.verified, true);
  assert.equal(fs.existsSync(source), true);
  assert.equal(fs.readFileSync(dest).toString("hex"), body.toString("hex"));
});

test("a file that is not a GGUF is refused before anything is copied", async () => {
  const dir = nextDir();
  fs.mkdirSync(dir, { recursive: true });
  const source = path.join(dir, "notes.txt");
  const dest = path.join(dir, "Bonsai-4B.gguf");
  fs.writeFileSync(source, "these are not the weights you are looking for");

  const status = await harness(dest).importFrom(source);

  assert.equal(status.phase, "error");
  assert.match(status.error ?? "", /not a GGUF/);
  assert.equal(fs.existsSync(dest), false);
});

test("a valid model that is not the pinned release says so instead of claiming a check", async () => {
  const dir = nextDir();
  fs.mkdirSync(dir, { recursive: true });
  const source = path.join(dir, "other-quant.gguf");
  const dest = path.join(dir, "Bonsai-4B.gguf");
  fs.writeFileSync(source, body);

  const status = await harness(dest, () => null, { sha256: "f".repeat(64) }).importFrom(source);

  assert.equal(status.phase, "done");
  assert.equal(status.verified, false);
  assert.match(status.error ?? "", /not the pinned release/);
  assert.equal(fs.existsSync(dest), true);
});

test("an import is refused when the volume cannot hold the file", async () => {
  const dir = nextDir();
  fs.mkdirSync(dir, { recursive: true });
  const source = path.join(dir, "model.gguf");
  const dest = path.join(dir, "nested", "Bonsai-4B.gguf");
  fs.writeFileSync(source, body);

  const status = await harness(dest, () => 10).importFrom(source);

  assert.equal(status.phase, "error");
  assert.match(status.error ?? "", /Not enough free space/);
  assert.equal(fs.existsSync(dest), false);
});

test("every phase the user sees is reported as it happens", async () => {
  const dir = nextDir();
  statuses.length = 0;
  await harness(path.join(dir, "Bonsai-4B.gguf")).download();

  const phases = statuses.map((status) => status.phase);
  assert.ok(phases.includes("downloading"), "the card needs a progress phase");
  assert.ok(phases.includes("verifying"), "the card needs to show the digest running");
  assert.equal(phases.at(-1), "done");
});
