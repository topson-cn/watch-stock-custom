import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadSignalModule() {
  const sourcePath = new URL("../src/utils/tradingSignal.ts", import.meta.url);
  const source = readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const modulePath = join(
    tmpdir(),
    `watch-stock-signal-${Date.now()}-${Math.random()}.mjs`,
  );
  await writeFile(modulePath, compiled, "utf8");
  return import(pathToFileURL(modulePath).href);
}

test("detectTradingSignals warns when a holding is below cost and weak today", async () => {
  const { detectTradingSignals } = await loadSignalModule();

  const signals = detectTradingSignals(
    [
      {
        name: "中国卫星",
        code: "sh600118",
        current: "75.86",
        close: "78.00",
        high: "77.20",
        low: "73.93",
        changePercent: "-2.74",
        volumeRatio: "1.80",
        amount: 3742359397,
      },
    ],
    [{ stockCode: "sh600118", shares: 400, costPrice: 84.405 }],
  );

  assert.equal(signals.length, 1);
  assert.equal(signals[0].title, "持仓走弱");
  assert.equal(signals[0].suggestion, "偏卖：先降仓或等反抽减仓");
  assert.match(signals[0].message, /浮亏 -10\.12%/);
});

test("detectTradingSignals reports strong watchlist momentum", async () => {
  const { detectTradingSignals } = await loadSignalModule();

  const signals = detectTradingSignals(
    [
      {
        name: "半导体ETF",
        code: "sh512480",
        current: "2.23",
        close: "2.11",
        high: "2.23",
        low: "2.08",
        changePercent: "5.89",
        volumeRatio: "2.10",
        amount: 1677771091,
      },
    ],
    [],
  );

  assert.equal(signals.length, 1);
  assert.equal(signals[0].action, "watch");
  assert.equal(signals[0].level, "info");
  assert.equal(signals[0].suggestion, "偏买：只适合回踩承接后小仓试错");
  assert.match(signals[0].message, /半导体ETF 2\.23，涨幅 5\.89%/);
});

test("detectTradingSignals suppresses watch signals when market and sector are weak", async () => {
  const { detectTradingSignals } = await loadSignalModule();

  const signals = detectTradingSignals(
    [
      {
        name: "强势个股",
        code: "sz300001",
        current: "20.00",
        close: "18.50",
        high: "20.10",
        low: "18.40",
        changePercent: "8.11",
        volumeRatio: "2.40",
        amount: 800000000,
      },
    ],
    [],
    {
      indexChangePercent: -1.2,
      sectorChangePercent: -2.4,
      sectorName: "半导体",
    },
  );

  assert.equal(signals.length, 0);
});

test("detectTradingSignals warns when a holding underperforms its sector", async () => {
  const { detectTradingSignals } = await loadSignalModule();

  const signals = detectTradingSignals(
    [
      {
        name: "中国卫星",
        code: "sh600118",
        current: "76.00",
        close: "78.00",
        high: "77.20",
        low: "75.80",
        changePercent: "-2.56",
        volumeRatio: "1.30",
        amount: 2200000000,
      },
    ],
    [{ stockCode: "sh600118", shares: 400, costPrice: 84.405 }],
    {
      indexChangePercent: 0.5,
      sectorChangePercent: 1.2,
      sectorName: "航空航天",
    },
  );

  assert.equal(signals[0].title, "跑输板块");
  assert.equal(signals[0].level, "warning");
  assert.equal(signals[0].suggestion, "偏卖：弱于板块，反抽不强优先减仓");
  assert.match(signals[0].message, /跑输航空航天 3\.76个百分点/);
});

test("detectTradingSignals warns when profitable holding gives back intraday gains", async () => {
  const { detectTradingSignals } = await loadSignalModule();

  const signals = detectTradingSignals(
    [
      {
        name: "沪电股份",
        code: "sz002463",
        current: "141.00",
        close: "139.00",
        high: "146.00",
        low: "138.50",
        changePercent: "1.44",
        volumeRatio: "1.70",
        amount: 4200000000,
      },
    ],
    [{ stockCode: "sz002463", shares: 100, costPrice: 128.77 }],
    {
      indexChangePercent: 0.4,
      sectorChangePercent: 2.1,
      sectorName: "电子",
    },
  );

  assert.equal(signals[0].title, "利润回吐");
  assert.equal(signals[0].level, "warning");
  assert.equal(signals[0].suggestion, "偏卖：分批保护利润");
  assert.match(signals[0].message, /浮盈 9\.50%/);
  assert.match(signals[0].message, /较日内高点回落 3\.42%/);
});

test("detectTradingSignals reports T sell setup only for overnight sellable shares", async () => {
  const { detectTradingSignals } = await loadSignalModule();

  const signals = detectTradingSignals(
    [
      {
        name: "中国卫星",
        code: "sh600118",
        current: "88.60",
        close: "84.00",
        high: "89.40",
        low: "84.80",
        avgPrice: "87.90",
        changePercent: "5.48",
        volumeRatio: "1.90",
        amount: 4200000000,
      },
    ],
    [
      {
        stockCode: "sh600118",
        shares: 400,
        costPrice: 84.405,
        lots: [
          { shares: 200, costPrice: 84.48, buyDate: "2026-06-08" },
          { shares: 200, costPrice: 84.33, buyDate: "2026-06-15" },
        ],
      },
    ],
    {
      indexChangePercent: 0.4,
      sectorChangePercent: 2.6,
      sectorName: "航空航天",
    },
    new Date("2026-06-15T10:30:00+08:00"),
  );

  assert.equal(signals[0].title, "冲高做T");
  assert.equal(signals[0].suggestion, "可T：只动隔夜可卖仓，分批高抛");
  assert.match(signals[0].message, /可卖 200 股/);
  assert.match(signals[0].message, /今日买入 200 股不可卖/);
});

test("detectTradingSignals skips T setup when all shares are bought today", async () => {
  const { detectTradingSignals } = await loadSignalModule();

  const signals = detectTradingSignals(
    [
      {
        name: "通宇通讯",
        code: "sz002792",
        current: "39.80",
        close: "37.80",
        high: "40.10",
        low: "38.20",
        avgPrice: "39.20",
        changePercent: "5.29",
        volumeRatio: "1.80",
        amount: 1600000000,
      },
    ],
    [
      {
        stockCode: "sz002792",
        shares: 500,
        costPrice: 37.818,
        buyDate: "2026-06-15",
      },
    ],
    {
      indexChangePercent: 0.4,
      sectorChangePercent: 2.6,
      sectorName: "航空航天",
    },
    new Date("2026-06-15T10:30:00+08:00"),
  );

  assert.equal(signals.length, 0);
});

test("detectTradingSignals downgrades extended watchlist moves", async () => {
  const { detectTradingSignals } = await loadSignalModule();

  const signals = detectTradingSignals(
    [
      {
        name: "新易盛",
        code: "sz300502",
        current: "540.49",
        close: "506.46",
        high: "540.88",
        low: "490.13",
        changePercent: "6.72",
        volumeRatio: "2.30",
        amount: 31803945193,
      },
    ],
    [],
    {
      indexChangePercent: 1.1,
      sectorChangePercent: 4.2,
      sectorName: "CPO",
    },
  );

  assert.equal(signals[0].title, "高位异动");
  assert.equal(signals[0].suggestion, "观望：不追高，等分歧回踩");
  assert.match(signals[0].message, /不适合直接追高/);
});

test("detectTradingSignals reports watchlist pullback support as buy setup", async () => {
  const { detectTradingSignals } = await loadSignalModule();

  const signals = detectTradingSignals(
    [
      {
        name: "沪电股份",
        code: "sz002463",
        current: "132.20",
        close: "125.20",
        high: "134.00",
        low: "130.80",
        avgPrice: "131.90",
        changePercent: "5.59",
        volumeRatio: "1.80",
        amount: 12861198025,
      },
    ],
    [],
    {
      indexChangePercent: 0.8,
      sectorChangePercent: 4.2,
      sectorName: "芯片",
    },
  );

  assert.equal(signals[0].title, "回踩承接");
  assert.equal(signals[0].suggestion, "偏买：回踩不破均价可小仓试错");
  assert.match(signals[0].message, /回落 1\.34%/);
});

test("detectTradingSignals reports watchlist dip buy when sector is strong", async () => {
  const { detectTradingSignals } = await loadSignalModule();

  const signals = detectTradingSignals(
    [
      {
        name: "东山精密",
        code: "sz002384",
        current: "211.50",
        close: "216.00",
        high: "217.20",
        low: "205.80",
        avgPrice: "210.80",
        changePercent: "-2.08",
        volumeRatio: "1.35",
        amount: 3600000000,
      },
    ],
    [],
    {
      indexChangePercent: 0.6,
      sectorChangePercent: 3.8,
      sectorName: "芯片",
    },
  );

  assert.equal(signals[0].title, "低吸观察");
  assert.equal(signals[0].suggestion, "偏买：板块强时可等企稳低吸");
  assert.match(signals[0].message, /芯片强于大盘/);
});
