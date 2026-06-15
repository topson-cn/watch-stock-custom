import type { ClosedPositionMetrics, PositionMetrics } from "../types";

interface PositionMetricInput {
  shares: number;
  costPrice: number;
  currentPrice: number;
  previousClose: number;
}

interface ClosedPositionMetricInput {
  shares: number;
  costPrice: number;
  sellPrice: number;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundRate(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function calculatePositionMetrics(
  input: PositionMetricInput,
): PositionMetrics {
  const shares = Number.isFinite(input.shares) ? input.shares : 0;
  const costPrice = Number.isFinite(input.costPrice) ? input.costPrice : 0;
  const currentPrice = Number.isFinite(input.currentPrice)
    ? input.currentPrice
    : 0;
  const previousClose = Number.isFinite(input.previousClose)
    ? input.previousClose
    : 0;
  const costAmount = roundMoney(shares * costPrice);
  const marketValue = roundMoney(shares * currentPrice);
  const profit = roundMoney(marketValue - costAmount);
  const profitRate = costAmount > 0 ? roundRate(profit / costAmount) : 0;
  const todayProfit = roundMoney((currentPrice - previousClose) * shares);
  const todayProfitRate =
    previousClose > 0 ? roundRate((currentPrice - previousClose) / previousClose) : 0;

  return {
    costAmount,
    marketValue,
    profit,
    profitRate,
    todayProfit,
    todayProfitRate,
  };
}

export function calculateClosedPositionMetrics(
  input: ClosedPositionMetricInput,
): ClosedPositionMetrics {
  const shares = Number.isFinite(input.shares) ? input.shares : 0;
  const costPrice = Number.isFinite(input.costPrice) ? input.costPrice : 0;
  const sellPrice = Number.isFinite(input.sellPrice) ? input.sellPrice : 0;
  const costAmount = roundMoney(shares * costPrice);
  const closeAmount = roundMoney(shares * sellPrice);
  const realizedProfit = roundMoney(closeAmount - costAmount);
  const realizedProfitRate =
    costAmount > 0 ? roundRate(realizedProfit / costAmount) : 0;

  return {
    costAmount,
    closeAmount,
    realizedProfit,
    realizedProfitRate,
  };
}
