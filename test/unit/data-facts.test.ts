import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countable,
  detectDelimiter,
  headingFacts,
  jsonFacts,
  looksTabular,
  measureText,
  numericColumns,
  splitTable,
  tableFacts,
} from "../../src/utils/data-facts";

const csv = ["name,price,qty", "apple,1.50,3", "pear,2,4", "plum,n/a,2"].join("\n");

test("a quoted field keeps its commas and its doubled quotes", () => {
  const rows = splitTable('id,note\n1,"a, b"\n2,"he said ""hi"""\n', ",");
  assert.deepEqual(rows, [
    ["id", "note"],
    ["1", "a, b"],
    ["2", 'he said "hi"'],
  ]);
});

test("a field may contain a newline while the row after it still parses", () => {
  const rows = splitTable('id,note\n1,"two\nlines"\n2,next\n', ",");
  assert.deepEqual(rows, [
    ["id", "note"],
    ["1", "two\nlines"],
    ["2", "next"],
  ]);
});

test("tabs win over commas only when there are at least as many of them", () => {
  assert.equal(detectDelimiter("a\tb\tc\n1\t2\t3"), "\t");
  assert.equal(detectDelimiter("a,b,c\n1,2,3"), ",");
  assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
});

test("one n/a does not turn a price column into text", () => {
  const [price] = numericColumns(["name", "price"], splitTable(csv, ",").slice(1));
  assert.equal(price.name, "price");
  assert.equal(price.values, 2, "the n/a cell is not counted as a value");
  assert.equal(price.min, 1.5);
  assert.equal(price.max, 2);
  assert.equal(price.sum, 3.5);
});

test("money signs, thousands separators and percents are still numbers", () => {
  const columns = numericColumns(["spent"], [[" $1,200.50 "], ["€300"], ["4.5%"]]);
  assert.equal(columns.length, 1);
  assert.equal(columns[0].sum, 1505);
});

test("the table report states the shape, then the arithmetic", () => {
  const facts = tableFacts(csv).join("\n");
  assert.match(facts, /columns \(3\): name, price, qty/);
  assert.match(facts, /data rows: 3/);
  assert.match(facts, /price: n=2 min=1\.5 max=2 mean=1\.75 sum=3\.5/);
  assert.match(facts, /qty: n=3 min=2 max=4 mean=3 sum=9/);
});

test("a row that does not match the header is counted, not guessed away", () => {
  const facts = tableFacts("a,b\n1,2\n3\n4,5,6").join("\n");
  assert.match(facts, /rows that do not match the header: 2 of 3 \(widest row has 3 fields\)/);
});

test("a table that stopped at the read cap says its row count is partial", () => {
  assert.match(tableFacts(csv, true).join("\n"), /data rows: 3 \(of the part read\)/);
});

test("a column of text is reported as text instead of a fake zero", () => {
  assert.match(tableFacts("name,city\nAnn,Rome\nBo,Oslo").join("\n"), /no numeric columns/);
});

test("a category column is a finding, not a column to skip", () => {
  const facts = tableFacts("shop,revenue\nnorth,10\nsouth,20\nnorth,30").join("\n");
  assert.match(facts, /shop: text, 2 distinct \(north 2, south 1\)/);
  assert.match(facts, /revenue: n=3 min=10 max=30 mean=20 sum=60/);
});

test("a wide table names the columns it could not show", () => {
  const wide = Array.from({ length: 20 }, (_, index) => `c${index}`).join(",");
  const values = Array.from({ length: 20 }, (_, index) => `${index + 1}`).join(",");
  const facts = tableFacts(`${wide}\n${values}\n${values}`).join("\n");
  assert.match(facts, /columns \(20\): c0, c1/);
  assert.match(facts, /… 4 more columns not shown/);
});

test("an array of objects is measured like a table", () => {
  const facts = jsonFacts(JSON.stringify([{ sku: "a", price: 10 }, { sku: "b", price: 30 }])).join("\n");
  assert.match(facts, /JSON array of 2 items/);
  assert.match(facts, /item keys: sku, price/);
  assert.match(facts, /price: n=2 min=10 max=30 mean=20 sum=40/);
});

test("an object reports its keys and the shape under each one", () => {
  const facts = jsonFacts('{"rows":[{"a":1},{"a":2}],"note":"hi"}').join("\n");
  assert.match(facts, /JSON object of 2 keys/);
  assert.match(facts, /rows: array of 2, e\.g\. object of 1 keys, e\.g\. a: number/);
  assert.match(facts, /note: string/);
});

test("broken JSON says so rather than inventing a shape", () => {
  assert.match(jsonFacts("{oops").join("\n"), /JSON that does not parse/);
});

test("headings keep their order and lose their hashes", () => {
  assert.equal(
    headingFacts("# One\nsome prose\n## Two\n### Three").join("\n"),
    "headings: One | Two | Three"
  );
  assert.equal(headingFacts("no headings here").join("\n"), "no markdown headings");
});

test("a comma-separated export earns table facts even without a .csv name", () => {
  assert.equal(looksTabular(csv), true);
  assert.equal(looksTabular("# Notes\n\nJust a sentence, with one comma.\nAnother line here"), false);
  assert.match(measureText(csv, ".txt").join("\n"), /columns \(3\)/);
});

test("the dispatcher picks a reader per kind of file and always admits a cap", () => {
  assert.match(measureText('{"a":1}', ".json").join("\n"), /JSON object of 1 keys/);
  assert.match(measureText("# Title\n\nbody text here", ".md").join("\n"), /headings: Title/);
  assert.match(measureText("just prose", ".txt").join("\n"), /text: 1 lines, 2 words/);
  assert.match(measureText(csv, ".csv", true).join("\n"), /larger than the read cap/);
});

test("numbers are grouped so a report reads them the way a person would", () => {
  assert.equal(countable(1234567.891), "1,234,567.89");
  assert.equal(countable(0.5), "0.5");
});
