import "fake-indexeddb/auto";
import { run } from "../tests/engine-smoke.js";

const result = await run();
console.log(result);
if (result.split("\n").some((line) => line.startsWith("FAIL"))) process.exitCode = 1;
