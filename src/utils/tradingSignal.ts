import type { Position, StockQuote } from "../types";

export type TradingSignalAction = "risk" | "watch";
export type TradingSignalLevel = "info" | "warning";

export interface MarketContext {
  indexChangePercent: number;
  sectorChangePercent: number;
  sectorName: string;
}

export interface TradingSignal {
  stockCode: string;
  name: string;
  level: TradingSignalLevel;
  action: TradingSignalAction;
  title: string;
  suggestion: string;
  message: string;
}

function toNumber(value: number | string | undefined): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmtPrice(value: number): string {
  return value.toFixed(2);
}

function fmtPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function fmtPoint(value: number): string {
  return `${value.toFixed(2)}个百分点`;
}

function fmtShares(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function tradingDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function isBoughtToday(buyDate: string | undefined, now: Date): boolean {
  if (!buyDate) return false;
  const parsed = new Date(buyDate);
  if (Number.isNaN(parsed.getTime())) return buyDate.slice(0, 10) === tradingDate(now);
  return tradingDate(parsed) === tradingDate(now);
}

function calculateSellableShares(position: Position, now: Date): {
  sellableShares: number;
  todayBoughtShares: number;
  todayBoughtCostAmount: number;
} {
  if (position.lots?.length) {
    return position.lots.reduce(
      (result, lot) => {
        const shares = toNumber(lot.shares);
        if (isBoughtToday(lot.buyDate, now)) {
          result.todayBoughtShares += shares;
          result.todayBoughtCostAmount += shares * toNumber(lot.costPrice);
        } else {
          result.sellableShares += shares;
        }
        return result;
      },
      { sellableShares: 0, todayBoughtShares: 0, todayBoughtCostAmount: 0 },
    );
  }

  if (isBoughtToday(position.buyDate, now)) {
    const todayBoughtShares = toNumber(position.shares);
    return {
      sellableShares: 0,
      todayBoughtShares,
      todayBoughtCostAmount: todayBoughtShares * toNumber(position.costPrice),
    };
  }

  return {
    sellableShares: toNumber(position.shares),
    todayBoughtShares: 0,
    todayBoughtCostAmount: 0,
  };
}

function isSectorStrong(marketContext?: MarketContext): boolean {
  if (!marketContext) return true;
  return (
    marketContext.indexChangePercent >= 0 &&
    marketContext.sectorChangePercent >= 2
  );
}

function findPosition(
  positions: Position[],
  stockCode: string,
): Position | undefined {
  return positions.find((p) => p.stockCode === stockCode);
}

export function detectTradingSignals(
  quotes: StockQuote[],
  positions: Position[],
  marketContext?: MarketContext,
  now: Date = new Date(),
): TradingSignal[] {
  const signals: TradingSignal[] = [];
  const marketWeak =
    (marketContext?.indexChangePercent ?? 0) < -0.8 &&
    (marketContext?.sectorChangePercent ?? 0) < -1.5;

  for (const quote of quotes) {
    const current = toNumber(quote.current);
    const changePercent = toNumber(quote.changePercent);
    const volumeRatio = toNumber(quote.volumeRatio);
    const high = toNumber(quote.high);
    const low = toNumber(quote.low);
    const avgPrice = toNumber(quote.avgPrice);
    const position = findPosition(positions, quote.code);

    if (position) {
      const costPrice = toNumber(position.costPrice);
      const profitRate = costPrice > 0 ? ((current - costPrice) / costPrice) * 100 : 0;
      const pullbackFromHigh = high > 0 ? ((high - current) / high) * 100 : 0;
      const reboundFromLow = low > 0 ? ((current - low) / low) * 100 : 0;
      const holdsAverage = avgPrice <= 0 || current >= avgPrice;
      const { sellableShares, todayBoughtShares, todayBoughtCostAmount } =
        calculateSellableShares(position, now);
      const sectorChangePercent = marketContext?.sectorChangePercent;
      const underperform =
        sectorChangePercent !== undefined
          ? sectorChangePercent - changePercent
          : 0;

      const todayBoughtCost =
        todayBoughtShares > 0 ? todayBoughtCostAmount / todayBoughtShares : 0;
      const todayBoughtProfitRate =
        todayBoughtCost > 0 ? ((current - todayBoughtCost) / todayBoughtCost) * 100 : 0;

      if (
        sellableShares > 0 &&
        todayBoughtShares > 0 &&
        todayBoughtProfitRate >= 0.8 &&
        reboundFromLow >= 1.2 &&
        pullbackFromHigh <= 2.8 &&
        holdsAverage &&
        (!marketContext || marketContext.sectorChangePercent >= -0.5)
      ) {
        signals.push({
          stockCode: quote.code,
          name: quote.name,
          level: "info",
          action: "watch",
          title: "做T高抛",
          suggestion: "可T：优先卖隔夜老仓，保留今日低吸仓",
          message: `${quote.name} ${fmtPrice(current)}，今日低吸成本 ${fmtPrice(todayBoughtCost)}，较低吸价反弹 ${fmtPercent(todayBoughtProfitRate)}，较低点反弹 ${fmtPercent(reboundFromLow)}，可卖 ${fmtShares(sellableShares)} 股，今日买入 ${fmtShares(todayBoughtShares)} 股不可卖`,
        });
        continue;
      }

      if (
        sellableShares > 0 &&
        profitRate >= 2.5 &&
        changePercent >= 3 &&
        changePercent <= 7 &&
        volumeRatio >= 1.3 &&
        pullbackFromHigh <= 1.8 &&
        holdsAverage
      ) {
        const tPlusOneNote =
          todayBoughtShares > 0
            ? `，今日买入 ${fmtShares(todayBoughtShares)} 股不可卖`
            : "";
        signals.push({
          stockCode: quote.code,
          name: quote.name,
          level: "info",
          action: "watch",
          title: "冲高做T",
          suggestion: "可T：只动隔夜可卖仓，分批高抛",
          message: `${quote.name} ${fmtPrice(current)}，浮盈 ${fmtPercent(profitRate)}，今日 ${fmtPercent(changePercent)}，量比 ${volumeRatio.toFixed(2)}，可卖 ${fmtShares(sellableShares)} 股${tPlusOneNote}`,
        });
        continue;
      }

      if (
        sellableShares > 0 &&
        changePercent <= -1.8 &&
        changePercent >= -5 &&
        reboundFromLow >= 1.5 &&
        holdsAverage &&
        marketContext &&
        marketContext.sectorChangePercent >= 0
      ) {
        const tPlusOneNote =
          todayBoughtShares > 0
            ? `，今日买入 ${fmtShares(todayBoughtShares)} 股不可卖`
            : "";
        signals.push({
          stockCode: quote.code,
          name: quote.name,
          level: "info",
          action: "watch",
          title: "回踩做T",
          suggestion: "可T：只低吸接回，不追高加仓",
          message: `${quote.name} ${fmtPrice(current)}，今日回调 ${fmtPercent(changePercent)}，较低点反弹 ${fmtPercent(reboundFromLow)}，${marketContext.sectorName}未走弱，可卖 ${fmtShares(sellableShares)} 股${tPlusOneNote}`,
        });
        continue;
      }

      if (profitRate >= 5 && pullbackFromHigh >= 2.5) {
        signals.push({
          stockCode: quote.code,
          name: quote.name,
          level: "warning",
          action: "risk",
          title: "利润回吐",
          suggestion: "偏卖：分批保护利润",
          message: `${quote.name} ${fmtPrice(current)}，浮盈 ${fmtPercent(profitRate)}，较日内高点回落 ${fmtPercent(pullbackFromHigh)}，注意保护利润`,
        });
        continue;
      }

      if (
        marketContext &&
        sectorChangePercent !== undefined &&
        sectorChangePercent > 0 &&
        underperform >= 3
      ) {
        signals.push({
          stockCode: quote.code,
          name: quote.name,
          level: "warning",
          action: "risk",
          title: "跑输板块",
          suggestion: "偏卖：弱于板块，反抽不强优先减仓",
          message: `${quote.name} ${fmtPrice(current)}，今日 ${fmtPercent(changePercent)}，跑输${marketContext.sectorName} ${fmtPoint(underperform)}，注意是否弱于主线`,
        });
        continue;
      }

      if (profitRate <= -8 && changePercent <= -2) {
        signals.push({
          stockCode: quote.code,
          name: quote.name,
          level: "warning",
          action: "risk",
          title: "持仓走弱",
          suggestion: "偏卖：先降仓或等反抽减仓",
          message: `${quote.name} ${fmtPrice(current)}，较成本 ${fmtPrice(costPrice)} 浮亏 ${fmtPercent(profitRate)}，今日 ${fmtPercent(changePercent)}，量比 ${volumeRatio.toFixed(2)}`,
        });
        continue;
      }
    }

    if (marketWeak) continue;

    if (!position && isSectorStrong(marketContext)) {
      const pullbackFromHigh = high > 0 ? ((high - current) / high) * 100 : 0;
      const reboundFromLow = low > 0 ? ((current - low) / low) * 100 : 0;
      const holdsAverage = avgPrice <= 0 || current >= avgPrice;

      if (
        changePercent >= 3 &&
        changePercent < 6 &&
        volumeRatio >= 1.2 &&
        pullbackFromHigh >= 1 &&
        pullbackFromHigh <= 3.5 &&
        holdsAverage
      ) {
        signals.push({
          stockCode: quote.code,
          name: quote.name,
          level: "info",
          action: "watch",
          title: "回踩承接",
          suggestion: "偏买：回踩不破均价可小仓试错",
          message: `${quote.name} ${fmtPrice(current)}，${marketContext?.sectorName ?? "板块"}强势，涨幅 ${fmtPercent(changePercent)}，较高点回落 ${fmtPercent(pullbackFromHigh)}，量比 ${volumeRatio.toFixed(2)}`,
        });
        continue;
      }

      if (
        changePercent <= -1.5 &&
        changePercent >= -4 &&
        volumeRatio >= 1.1 &&
        reboundFromLow >= 2 &&
        holdsAverage
      ) {
        signals.push({
          stockCode: quote.code,
          name: quote.name,
          level: "info",
          action: "watch",
          title: "低吸观察",
          suggestion: "偏买：板块强时可等企稳低吸",
          message: `${quote.name} ${fmtPrice(current)}，${marketContext?.sectorName ?? "板块"}强于大盘，个股回调 ${fmtPercent(changePercent)}，较低点反弹 ${fmtPercent(reboundFromLow)}，先等企稳`,
        });
        continue;
      }
    }

    if (!position && changePercent >= 5 && volumeRatio >= 1.5) {
      const extended = changePercent >= 6;
      signals.push({
        stockCode: quote.code,
        name: quote.name,
        level: "info",
        action: "watch",
        title: extended ? "高位异动" : "强势异动",
        suggestion: extended
          ? "观望：不追高，等分歧回踩"
          : "偏买：只适合回踩承接后小仓试错",
        message: extended
          ? `${quote.name} ${fmtPrice(current)}，涨幅 ${fmtPercent(changePercent)}，量比 ${volumeRatio.toFixed(2)}，不适合直接追高，等分歧承接`
          : `${quote.name} ${fmtPrice(current)}，涨幅 ${fmtPercent(changePercent)}，量比 ${volumeRatio.toFixed(2)}，可观察是否回踩承接`,
      });
    }
  }

  return signals;
}
