import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

// Run the existing UI tests without installing Deno; keep the original tests intact.
const root = fileURLToPath(new URL("../", import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "mark-ui-tests-"));
const cases = [];
globalThis.Deno = { test: (name, fn) => cases.push({ name, fn }) };
let failed = 0;
try {
  await fs.mkdir(path.join(temp, "js"));
  await fs.mkdir(path.join(temp, "tests"));
  await fs.copyFile(path.join(root, "js/assistant-memory.js"), path.join(temp, "js/assistant-memory.js"));
  await fs.copyFile(path.join(root, "js/assistant-chats.js"), path.join(temp, "js/assistant-chats.js"));
  await fs.cp(path.join(root, "js/ui"), path.join(temp, "js/ui"), { recursive: true });
  await fs.writeFile(path.join(temp, "package.json"), '{"type":"module"}');
  const source = await fs.readFile(path.join(root, "tests/derive_test.js"), "utf8");
  await fs.writeFile(path.join(temp, "tests/derive_test.js"), source.replace(
    'import { assert, assertEquals } from "jsr:@std/assert@1";',
    'import { ok as assert, deepStrictEqual as assertEquals } from "node:assert";'));
  await import(pathToFileURL(path.join(temp, "tests/derive_test.js")));
  for (const { name, fn } of cases) {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
  }
  console.log(`${cases.length - failed}/${cases.length} existing UI tests passed`);
} finally {
  delete globalThis.Deno;
  await fs.rm(temp, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
