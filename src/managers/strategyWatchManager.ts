import { scanBuildCandidates } from "../services/candidateScan";
import {
  buildStrategyWatchResults,
  summarizeStrategyWatch,
} from "../utils/strategyWatch";
import { sendMsg } from "../utils/msg";
import { config } from "../config";
import { isStableTradeTime, isTradingTime } from "../utils/time";
import type { StrategyWatchResult } from "../types";

const STRATEGY_REFRESH_MS = 3 * 60 * 1000;
const SNAPSHOT_MINUTES = [5, 15, 30];
const MAX_HIT_RECORDS = 160;

let lastRunAt = 0;
let lastNotifyKey = "";
let strategyWatchTimer: NodeJS.Timeout | null = null;

function tradeDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function hitRecordId(date: string, hit: ReturnType<typeof flattenNotifyHits>[number]): string {
  return [date, hit.taskName, hit.code, hit.title].join(":");
}

async function updateStrategyHitRecords(
  hits: ReturnType<typeof flattenNotifyHits>,
  now = new Date(),
): Promise<void> {
  if (!hits.length) return;
  const date = tradeDate(now);
  const nowIso = now.toISOString();
  const records = [...config.getStrategyHitRecords()];
  const byId = new Map(records.map((record) => [record.id, record]));

  for (const hit of hits) {
    const current = Number(hit.current);
    if (!Number.isFinite(current) || current <= 0) continue;
    const id = hitRecordId(date, hit);
    let record = byId.get(id);
    if (!record) {
      record = {
        id,
        tradeDate: date,
        taskName: hit.taskName,
        code: hit.code,
        name: hit.name,
        title: hit.title,
        triggerAt: nowIso,
        triggerPrice: current,
        latestAt: nowIso,
        latestPrice: current,
        latestProfitRate: 0,
        snapshots: [],
      };
      records.push(record);
      byId.set(id, record);
    }

    record.latestAt = nowIso;
    record.latestPrice = current;
    record.latestProfitRate = ((current - record.triggerPrice) / record.triggerPrice) * 100;

    const elapsedMinutes = (now.getTime() - new Date(record.triggerAt).getTime()) / 60000;
    for (const minutes of SNAPSHOT_MINUTES) {
      if (elapsedMinutes >= minutes && !record.snapshots.some((snapshot) => snapshot.minutes === minutes)) {
        record.snapshots.push({
          minutes,
          price: current,
          profitRate: record.latestProfitRate,
          capturedAt: nowIso,
        });
      }
    }
  }

  await config.saveStrategyHitRecords(records.slice(-MAX_HIT_RECORDS));
}

function flattenNotifyHits(results: StrategyWatchResult[]) {
  return results
    .flatMap((result) => {
      if (!result.task.notify) return [];
      const front = result.hits[0];
      return front
        ? [
            {
              taskPriority: result.task.priority,
              taskName: result.task.name,
              code: front.candidate.code,
              name: front.candidate.name,
              title: front.candidate.title,
              score: front.candidate.score,
              current: front.candidate.current,
            },
          ]
        : [];
    })
    .sort((a, b) => a.taskPriority - b.taskPriority || b.score - a.score);
}

function runScheduledStrategyWatch(): void {
  const now = new Date();
  if (!isTradingTime(now) || !isStableTradeTime(now)) return;
  void checkStrategyWatch();
}

export function startStrategyWatchTimer(): void {
  if (strategyWatchTimer) clearInterval(strategyWatchTimer);
  runScheduledStrategyWatch();
  strategyWatchTimer = setInterval(
    runScheduledStrategyWatch,
    STRATEGY_REFRESH_MS,
  );
}

export function stopStrategyWatchTimer(): void {
  if (!strategyWatchTimer) return;
  clearInterval(strategyWatchTimer);
  strategyWatchTimer = null;
}

export async function checkStrategyWatch(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastRunAt < STRATEGY_REFRESH_MS) return;
  lastRunAt = now;

  const candidates = await scanBuildCandidates(80);
  const results = buildStrategyWatchResults(candidates);
  const hits = flattenNotifyHits(results);
  await updateStrategyHitRecords(hits);
  if (!hits.length) {
    lastNotifyKey = "";
    return;
  }

  const notifyKey = hits
    .slice(0, 8)
    .map((hit) => `${hit.taskName}:${hit.code}`)
    .join("|");
  if (notifyKey === lastNotifyKey) return;
  lastNotifyKey = notifyKey;

  const top = hits
    .slice(0, 3)
    .map((hit) => `${hit.taskName}-${hit.name}(${hit.title})`)
    .join("、");
  sendMsg(`策略盯盘命中：${top}。概要：${summarizeStrategyWatch(results)}`, {
    type: "info",
  });
}
