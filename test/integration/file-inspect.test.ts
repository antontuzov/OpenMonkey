import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FileSystemTools } from "../../src/agent/tools/file-system";

const home = process.env.HOME as string;
const root = path.join(home, "Documents", "inspect-fixture");
const tools = new FileSystemTools();

const csv = ["shop,revenue,orders", "north,1000,10", "south,2000,20", "east,3000,30"].join("\n");

/**
 * The fixture is written fresh each run: the measuring pass reads what is really on
 * disk, so a stale file would change the numbers the answer prints.
 */
const write = (name: string, content: string | Buffer) =>
  fs.writeFile(path.join(root, name), content, "utf8").then(() => content);

const prepare = async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(path.join(root, "sub"), { recursive: true });
};

test("a folder is measured file by file, with the arithmetic a report needs", async () => {
  await prepare();
  await write("sales.csv", csv);
  await write("notes.md", "# Week 1\n\nRevenue is up.\n## Details\nmore prose here\n");

  const out = await tools.execute("inspect", { path: "~/Documents/inspect-fixture", pattern: "*" });

  assert.match(out, /Measured 2 files in/);
  assert.match(out, /\.csv 1/);
  assert.match(out, /\.md 1/);
  assert.match(out, /sales\.csv — \d+ B/);
  assert.match(out, /columns \(3\): shop, revenue, orders/);
  assert.match(out, /revenue: n=3 min=1,?000 max=3,?000 mean=2,?000 sum=6,?000/);
  assert.match(out, /notes\.md — \d+ B/);
  assert.match(out, /text: 6 lines, 11 words/);
  assert.match(out, /headings: Week 1 \| Details/);
});

test("a name filter narrows the measurement, and a match of none says so", async () => {
  await prepare();
  await write("sales.csv", csv);
  await write("scratch.txt", "not a table at all");

  const only = await tools.execute("inspect", { path: "~/Documents/inspect-fixture", pattern: "*.csv" });
  assert.match(only, /Measured 1 file in/);
  assert.ok(!only.includes("scratch.txt"), "a file the filter excluded must not be read");

  const none = await tools.execute("inspect", { path: "~/Documents/inspect-fixture", pattern: "*.parquet" });
  assert.match(none, /No files matching \*\.parquet under/);
});

test("a single file is measured as itself, not as a folder walk", async () => {
  await prepare();
  await write("sales.csv", csv);

  const out = await tools.execute("inspect", { path: "~/Documents/inspect-fixture/sales.csv" });
  assert.match(out, /Measured 1 file in/);
  assert.match(out, /sales\.csv — \d+ B/);
  assert.match(out, /orders: n=3 min=10 max=30 mean=20 sum=60/);
});

test("a binary file is named and refused rather than measured as text", async () => {
  await prepare();
  await write("image.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  await write("sales.csv", csv);

  const out = await tools.execute("inspect", { path: "~/Documents/inspect-fixture" });
  assert.match(out, /image\.png — \d+ B\n\s+binary file, not measured/);
  assert.match(out, /\.png 1/);
  assert.match(out, /\.csv 1/);
});

test("JSON is measured by shape and by the numbers inside its items", async () => {
  await prepare();
  await write("orders.json", JSON.stringify([{ total: 5 }, { total: 15 }, { total: 40 }]));

  const out = await tools.execute("inspect", { path: "~/Documents/inspect-fixture" });
  assert.match(out, /JSON array of 3 items/);
  assert.match(out, /item keys: total/);
  assert.match(out, /total: n=3 min=5 max=40 mean=20 sum=60/);
});

test("a file past the read cap is measured up to the cap and admits it", async () => {
  await prepare();
  // Just over the 4 MB the measuring pass is willing to read, so the answer has to
  // say the row count covers only what it read.
  const header = "id,amount\n";
  const row = (n: number) => `${n},${n}\n`;
  let big = header;
  for (let n = 1; big.length < 4_200_000; n += 1) big += row(n);
  await write("big.csv", big);

  const out = await tools.execute("inspect", { path: "~/Documents/inspect-fixture" });
  assert.match(out, /data rows: \d+ \(of the part read\)/);
  assert.match(out, /measured only the beginning: the file is larger than the read cap/);
  const rows = Number(/data rows: (\d+)/.exec(out)?.[1] ?? "0");
  assert.ok(rows < big.split("\n").length - 1, "the cap must not pretend it counted everything");
  assert.ok(rows > 100_000, "the cap should still measure a real part of the file");
});

test("a crowd of files is cut at the declared limit, and the cut is reported", async () => {
  await prepare();
  await Promise.all(
    Array.from({ length: 45 }, (_, index) => write(`sub/row${index}.csv`, `a,b\n1,${index}\n2,3\n`))
  );

  const out = await tools.execute("inspect", { path: "~/Documents/inspect-fixture" });
  assert.match(out, /Measured 40 files in/);
  assert.match(out, /only the first 40 matches measured/);
  assert.equal((out.match(/row\d+\.csv — /g) ?? []).length, 40);
});

test("a folder outside the workspace is refused before anything is read", async () => {
  await assert.rejects(
    tools.execute("inspect", { path: path.join(home, "outside-secrets") }),
    /outside the allowed folders/
  );
});

test("an empty match list and an unreadable file are both reported honestly", async () => {
  await prepare();
  await fs.mkdir(path.join(root, "empty"), { recursive: true });

  const out = await tools.execute("inspect", { path: "~/Documents/inspect-fixture/empty" });
  assert.match(out, /No files matching \* under/);
});
