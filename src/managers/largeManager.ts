// 大单异动监控：基于刷新间隔内的成交额增量
import { sendRateLimitMsg } from "../utils/msg";
import { formatAmount } from "../utils/stock";
import type { Stock } from "../types";

// 上次累计成交额缓存
const largeTipCache = new Map<string, number>();
const MIN_LARGE_AMOUNT = 5000000; // 区间成交额绝对阈值：500万
const LARGE_AMOUNT_PERCENT = 3; // 区间成交额占当日比例阈值：3%

// 根据成交额变化生成通知文案
function getLargeChangeMessage(prevAmount: number, stock: Stock): string {
  const curAmount = stock.amount ?? 0;
  if (curAmount <= 0 || prevAmount <= 0) return "";

  const delta = curAmount - prevAmount;
  if (delta <= MIN_LARGE_AMOUNT) return "";

  const ratio = (delta / curAmount) * 100;
  if (ratio <= LARGE_AMOUNT_PERCENT) return "";

  // 涨跌方向区分买卖意图
  const changePercent = parseFloat(stock.changePercent);
  if (changePercent > 0) {
    return `💰 ${stock.name} 大单买入${formatAmount(delta)}`;
  }
  if (changePercent < 0) {
    return `💸 ${stock.name} 大单卖出${formatAmount(delta)}`;
  }
  return `💵 ${stock.name} 大单成交${formatAmount(delta)}`;
}

// 检查并通知大单异动
export function checkLargeTip(stockInfos: Stock[]): void {
  for (const stock of stockInfos) {
    if (!stock) continue;
    const prevAmount = largeTipCache.get(stock.code);
    if (prevAmount !== undefined) {
      const message = getLargeChangeMessage(prevAmount, stock);
      if (message) sendRateLimitMsg(message);
    }
    largeTipCache.set(stock.code, stock.amount ?? 0);
  }
}
