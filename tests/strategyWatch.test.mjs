import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadStrategyModule() {
  const sourcePath = new URL("../src/utils/strategyWatch.ts", import.meta.url);
  const source = readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const modulePath = join(
    tmpdir(),
    `watch-stock-strategy-${Date.now()}-${Math.random()}.mjs`,
  );
  await writeFile(modulePath, compiled, "utf8");
  return import(pathToFileURL(modulePath).href);
}

function candidate(overrides) {
  return {
    code: "sh600000",
    name: "测试股份",
    current: 10,
    changePercent: 2.1,
    amount: 600000000,
    volumeRatio: 1.6,
    turnoverRatio: 3.2,
    sectorName: "未匹配",
    sectorChangePercent: 0.5,
    score: 70,
    tier: "可试",
    title: "买点试探",
    reasons: ["放量突破60日线"],
    risk: "不追高",
    ...overrides,
  };
}

test("buildStrategyWatchResults groups AI hardware candidates by keyword", async () => {
  const { buildStrategyWatchResults } = await loadStrategyModule();

  const results = buildStrategyWatchResults([
    candidate({ code: "sz002463", name: "沪电股份", sectorName: "通信" }),
  ]);

  const ai = results.find((item) => item.task.id === "ai-hardware-chain");
  assert.equal(ai.hits.length, 1);
  assert.equal(ai.hits[0].candidate.name, "沪电股份");
  assert.equal(ai.hits[0].action, "小仓试探观察");
  assert.ok(ai.hits[0].matched.includes("沪电"));
});

test("brokerage task is sentiment-only and does not request notifications", async () => {
  const { buildStrategyWatchResults } = await loadStrategyModule();

  const results = buildStrategyWatchResults([
    candidate({
      code: "sh600030",
      name: "中信证券",
      sectorName: "证券",
      tier: "优先",
    }),
  ]);

  const brokerage = results.find((item) => item.task.id === "brokerage-sentiment");
  assert.equal(brokerage.task.notify, false);
  assert.equal(brokerage.hits.length, 1);
  assert.equal(brokerage.hits[0].action, "情绪观察");
});

test("summarizeStrategyWatch reports empty state clearly", async () => {
  const { buildStrategyWatchResults, summarizeStrategyWatch } =
    await loadStrategyModule();

  const summary = summarizeStrategyWatch(buildStrategyWatchResults([]));

  assert.equal(summary, "当前推荐方向暂无模式内候选");
});
