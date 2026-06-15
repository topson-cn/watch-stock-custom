import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadPositionModule() {
  const sourcePath = new URL("../src/utils/position.ts", import.meta.url);
  const source = readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const modulePath = join(
    tmpdir(),
    `watch-stock-position-${Date.now()}-${Math.random()}.mjs`,
  );
  await writeFile(modulePath, compiled, "utf8");
  return import(pathToFileURL(modulePath).href);
}

test("calculatePositionMetrics returns market value and profit", async () => {
  const { calculatePositionMetrics } = await loadPositionModule();

  const result = calculatePositionMetrics({
    shares: 1000,
    costPrice: 25.3,
    currentPrice: 28.2,
    previousClose: 27.6,
  });

  assert.equal(result.costAmount, 25300);
  assert.equal(result.marketValue, 28200);
  assert.equal(result.profit, 2900);
  assert.equal(result.profitRate, 0.1146);
  assert.equal(result.todayProfit, 600);
  assert.equal(result.todayProfitRate, 0.0217);
});

test("calculatePositionMetrics handles zero cost defensively", async () => {
  const { calculatePositionMetrics } = await loadPositionModule();

  const result = calculatePositionMetrics({
    shares: 500,
    costPrice: 0,
    currentPrice: 10,
    previousClose: 8,
  });

  assert.equal(result.costAmount, 0);
  assert.equal(result.marketValue, 5000);
  assert.equal(result.profit, 5000);
  assert.equal(result.profitRate, 0);
  assert.equal(result.todayProfit, 1000);
  assert.equal(result.todayProfitRate, 0.25);
});

test("calculateClosedPositionMetrics returns realized profit", async () => {
  const { calculateClosedPositionMetrics } = await loadPositionModule();

  const result = calculateClosedPositionMetrics({
    shares: 400,
    costPrice: 84.405,
    sellPrice: 90.12,
  });

  assert.equal(result.costAmount, 33762);
  assert.equal(result.closeAmount, 36048);
  assert.equal(result.realizedProfit, 2286);
  assert.equal(result.realizedProfitRate, 0.0677);
});
