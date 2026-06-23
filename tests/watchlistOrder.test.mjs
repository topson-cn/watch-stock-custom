import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadWatchlistModule() {
  const sourcePath = new URL("../src/utils/watchlist.ts", import.meta.url);
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    'import { isValidStockCode } from "./stock";',
    'function isValidStockCode(code) { return /^(sh|sz|bj)\\d{6}$/.test(code); }',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const modulePath = join(
    tmpdir(),
    `watch-stock-watchlist-${Date.now()}-${Math.random()}.mjs`,
  );
  await writeFile(modulePath, compiled, "utf8");
  return import(pathToFileURL(modulePath).href);
}

test("putStockFirst prepends a new bought stock", async () => {
  const { putStockFirst } = await loadWatchlistModule();

  const result = putStockFirst(["sh000001", "sz002185"], "sh600105");

  assert.deepEqual(result, ["sh600105", "sh000001", "sz002185"]);
});

test("putStockFirst moves an existing bought stock to first", async () => {
  const { putStockFirst } = await loadWatchlistModule();

  const result = putStockFirst(["sh000001", "sz002185", "sh600105"], "SH600105");

  assert.deepEqual(result, ["sh600105", "sh000001", "sz002185"]);
});

test("putStockFirst ignores invalid stock codes", async () => {
  const { putStockFirst } = await loadWatchlistModule();
  const source = ["sh000001", "sz002185"];

  assert.deepEqual(putStockFirst(source, "bad"), source);
});
