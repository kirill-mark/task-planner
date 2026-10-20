import assert from "node:assert/strict";
import { test } from "node:test";
import { createNativeExporter } from "../js/file-export.js";

const name = "mark-2026-10-05.csv";
const content = '\ufeffНазвание;Описание\r\n"Задача";"текст"';
function setup(overrides = {}) {
  const calls = [];
  const filesystem = {
    async writeFile(options) { calls.push(["write", options]); return { uri: "file:///synthetic-cache/export.csv" }; },
    async rmdir(options) { calls.push(["cleanup", options]); },
    ...overrides.filesystem,
  };
  const share = { async share(options) { calls.push(["share", options]); }, ...overrides.share };
  return { calls, run: createNativeExporter({ filesystem, share, cacheDirectory: "CACHE", utf8: "utf8", uniqueId: () => "synthetic-id" }) };
}

test("native export preserves Cyrillic/BOM and shares a local file", async () => {
  const { calls, run } = setup();
  assert.deepEqual(await run({ name, text: content }), { kind: "shared" });
  assert.deepEqual(calls, [
    ["write", { path: `mark-exports/synthetic-id/${name}`, data: content, directory: "CACHE", encoding: "utf8", recursive: true }],
    ["share", { title: "Экспорт MARK", files: ["file:///synthetic-cache/export.csv"] }],
    ["cleanup", { path: "mark-exports/synthetic-id", directory: "CACHE", recursive: true }],
  ]);
});

test("JSON export uses the same native file path", async () => {
  const { calls, run } = setup();
  await run({ name: "mark-2026-10-05.json", text: '{"title":"Задача"}' });
  assert.match(calls[0][1].path, /\.json$/);
  assert.equal(calls[0][1].data, '{"title":"Задача"}');
});

test("filename cannot escape the export folder", async () => {
  const { calls, run } = setup();
  for (const bad of ["../../data.json", "mark-2026-10-05.html", "mark-2026-10-05.json/secret", "private.json"]) {
    await assert.rejects(run({ name: bad, text: "synthetic" }), /filename/);
  }
  assert.deepEqual(calls, []);
});

test("cancelled share clears temporary files and is not reported as success", async () => {
  const { calls, run } = setup({ share: { async share() { throw new Error("Share canceled"); } } });
  assert.deepEqual(await run({ name, text: content }), { kind: "cancelled" });
  assert.equal(calls.at(-1)[0], "cleanup");
});

test("write failure never opens share and still attempts cleanup", async () => {
  const { calls, run } = setup({ filesystem: { async writeFile() { throw new Error("disk full"); } } });
  await assert.rejects(run({ name, text: content }), /disk full/);
  assert.deepEqual(calls.map(x => x[0]), ["cleanup"]);
});

test("share failure clears temporary files and reaches caller", async () => {
  const { calls, run } = setup({ share: { async share() { throw new Error("share unavailable"); } } });
  await assert.rejects(run({ name, text: content }), /share unavailable/);
  assert.equal(calls.at(-1)[0], "cleanup");
});

test("cleanup failure does not incorrectly report a failed export", async () => {
  const { run } = setup({ filesystem: { async rmdir() { throw new Error("file already removed"); } } });
  assert.deepEqual(await run({ name, text: content }), { kind: "shared" });
});

test("double tap does not create two share sheets", async () => {
  let done;
  const { calls, run } = setup({ share: { async share() { return new Promise(resolve => { done = resolve; }); } } });
  const pending = run({ name, text: content });
  await Promise.resolve();
  assert.deepEqual(await run({ name, text: content }), { kind: "busy" });
  assert.equal(calls.filter(x => x[0] === "write").length, 1);
  done();
  await pending;
  const next = run({ name, text: content });
  await Promise.resolve();
  done();
  assert.deepEqual(await next, { kind: "shared" });
});
