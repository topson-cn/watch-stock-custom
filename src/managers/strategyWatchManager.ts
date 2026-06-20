import { scanBuildCandidates } from "../services/candidateScan";
import {
  buildStrategyWatchResults,
  summarizeStrategyWatch,
} from "../utils/strategyWatch";
import { sendMsg } from "../utils/msg";
import type { StrategyWatchResult } from "../types";

const STRATEGY_REFRESH_MS = 3 * 60 * 1000;

let lastRunAt = 0;
let lastNotifyKey = "";

function flattenNotifyHits(results: StrategyWatchResult[]) {
  return results
    .flatMap((result) =>
      result.task.notify
        ? result.hits.map((hit) => ({
            taskName: result.task.name,
            code: hit.candidate.code,
            name: hit.candidate.name,
            title: hit.candidate.title,
            score: hit.candidate.score,
          }))
        : [],
    )
    .sort((a, b) => b.score - a.score);
}

export async function checkStrategyWatch(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastRunAt < STRATEGY_REFRESH_MS) return;
  lastRunAt = now;

  const candidates = await scanBuildCandidates(10);
  const results = buildStrategyWatchResults(candidates);
  const hits = flattenNotifyHits(results);
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
