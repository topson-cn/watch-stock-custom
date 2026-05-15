// 大单异动监控：基于最近多次刷新的成交额变化
import { sendRateLimitMsg } from "../utils/msg";
import { formatAmount } from "../utils/stock";
import type { Stock, PriceType } from "../types";

// 单次行情快照，仅保留大单分析所需字段
interface LargeSnapshot {
  amount: number; // 累计成交额
  current: number; // 当前价
  timestamp: number; // 行情时间戳（秒）
  priceType: PriceType; // 价格类型
}

// 将行情时间字符串解析为时间戳，无效时返回0
function toTimestamp(text: string): number {
  if (!text) return 0;
  const t = new Date(text).getTime();
  return isNaN(t) ? 0 : Math.floor(t / 1000);
}

// 保留最近 N 次行情快照，用于对比近期均值识别异动
const HISTORY_SIZE = 7;
const largeTipCache = new Map<string, LargeSnapshot[]>();
const MIN_LARGE_AMOUNT = 5000000; // 区间成交额绝对阈值：500万

// 根据快照历史生成大单异动通知文案
function getLargeChangeMessage(history: LargeSnapshot[], stock: Stock): string {
  if (history.length < HISTORY_SIZE) return "";
  // 处理时间异常
  if (
    history[6].timestamp - history[0].timestamp > 40 ||
    history[6].timestamp - history[0].timestamp < 20
  )
    return "";
  const lastAmount = history[6].amount;
  // 未达到绝对金额门槛则不视为大单
  if (lastAmount < MIN_LARGE_AMOUNT * 1.6) return "";

  // 计算前6个数据成交额平均值，作为近期正常成交基准
  let sumAmount = 0;
  for (let i = 0; i < 6; i++) {
    sumAmount += history[i].amount;
  }

  // 均量差值
  const deltaAmount = lastAmount - sumAmount / 6;
  // 放量倍率
  const ratio = deltaAmount / sumAmount / 6;
  // 价格变化方向：最近一次间隔内的涨跌判断买卖意图
  const priceDiff = history[6].current - history[5].current;
  // 排除缩量/放量<1.6倍
  if (deltaAmount < MIN_LARGE_AMOUNT || ratio < 1.6 || priceDiff === 0)
    return "";

  const emoji = priceDiff > 0 ? "💰" : "💸";
  const direction = priceDiff > 0 ? "买入" : "卖出";
  const size = ratio > 3 ? "超大" : "大";
  return `${emoji} ${stock.name} ${size}单${direction}${formatAmount(deltaAmount)}`;
}

// 检查并通知大单异动
export function checkLargeTip(stockInfos: Stock[]): void {
  for (const stock of stockInfos) {
    if (!stock || stock.priceType !== "none" || stock.amount <= 0) continue;
    const current = parseFloat(stock.current);
    if (isNaN(current) || current <= 0) continue;
    const timestamp = toTimestamp(stock.dateTime);
    if (timestamp === 0) continue;
    const history = largeTipCache.get(stock.code) ?? [];
    history.push({
      amount: stock.amount,
      current,
      timestamp,
      priceType: stock.priceType,
    });
    if (history.length > HISTORY_SIZE) history.shift();
    largeTipCache.set(stock.code, history);
    if (history.length < HISTORY_SIZE) continue;
    const message = getLargeChangeMessage(history, stock);
    if (message) sendRateLimitMsg(message);
  }
}
