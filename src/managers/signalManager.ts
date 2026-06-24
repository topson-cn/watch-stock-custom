// 交易信号检查：供 Cron Tasks 或手动命令触发
import { config, INDUSTRY_CODE_LIST } from "../config";
import { getStockQuoteList } from "../services/stockService";
import { sendMsg } from "../utils/msg";
import { detectTradingSignals } from "../utils/tradingSignal";
import type { MarketContext, TradingSignal } from "../utils/tradingSignal";
import type { StockQuote } from "../types";

const SIGNAL_COOLDOWN_MS = 10 * 60 * 1000;
const lastSignalAt = new Map<string, number>();
const INDEX_CODE = "sh000001";
const SECTOR_CODES = INDUSTRY_CODE_LIST;
const STOCK_SECTOR_MAP: Record<string, { code: string; name: string }> = {
  sh600111: { code: "sh516150", name: "稀土" },
  sh603019: { code: "sh515980", name: "人工智能" },
  sz002475: { code: "sh515980", name: "人工智能" },
  sh603005: { code: "sh512480", name: "半导体" },
  sh600105: { code: "sh515880", name: "通信" },
  sh600584: { code: "sh512480", name: "半导体" },
  sz002185: { code: "sh512480", name: "半导体" },
  sh600118: { code: "sz159227", name: "航空航天" },
  sz002792: { code: "sz159227", name: "航空航天" },
  sh601138: { code: "sz159995", name: "芯片" },
  sz002463: { code: "sz159995", name: "芯片" },
  sz002384: { code: "sz159995", name: "芯片" },
};

function signalKey(signal: TradingSignal): string {
  return `${signal.action}:${signal.stockCode}:${signal.title}`;
}

function shouldNotify(signal: TradingSignal, now: number): boolean {
  const key = signalKey(signal);
  const lastAt = lastSignalAt.get(key) || 0;
  if (now - lastAt < SIGNAL_COOLDOWN_MS) return false;
  lastSignalAt.set(key, now);
  return true;
}

function toPercent(quote: StockQuote | undefined): number {
  const value = Number(quote?.changePercent);
  return Number.isFinite(value) ? value : 0;
}

function pickDefaultSector(quotes: Map<string, StockQuote>): {
  code: string;
  name: string;
} {
  const sectors = [
    { code: "sz159227", name: "航空航天" },
    { code: "sh512480", name: "半导体" },
    { code: "sz159995", name: "芯片" },
    { code: "sh515980", name: "人工智能" },
    { code: "sh516150", name: "稀土" },
    { code: "sh512400", name: "有色金属" },
    { code: "sh515880", name: "通信" },
  ];
  return sectors.reduce((best, item) =>
    toPercent(quotes.get(item.code)) > toPercent(quotes.get(best.code))
      ? item
      : best,
  );
}

function buildMarketContext(
  quote: StockQuote,
  quoteMap: Map<string, StockQuote>,
): MarketContext {
  const sector = STOCK_SECTOR_MAP[quote.code] || pickDefaultSector(quoteMap);
  return {
    indexChangePercent: toPercent(quoteMap.get(INDEX_CODE)),
    sectorChangePercent: toPercent(quoteMap.get(sector.code)),
    sectorName: sector.name,
  };
}

export async function checkTradingSignals(): Promise<void> {
  const stocks = config.getStocks();
  if (!stocks.length) return;

  const queryCodes = [...new Set([...stocks, INDEX_CODE, ...SECTOR_CODES])];
  const allQuotes = await getStockQuoteList(queryCodes);
  const quoteMap = new Map(allQuotes.map((quote) => [quote.code, quote]));
  const quotes = stocks
    .map((code) => quoteMap.get(code))
    .filter((quote): quote is StockQuote => quote !== undefined);
  if (!quotes.length) {
    sendMsg("交易信号检查失败：未获取到行情数据", { type: "warning" });
    return;
  }

  const positions = config.getPositions();
  const signals = quotes.flatMap((quote) =>
    detectTradingSignals([quote], positions, buildMarketContext(quote, quoteMap)),
  );
  const now = Date.now();

  for (const signal of signals) {
    if (!shouldNotify(signal, now)) continue;
    sendMsg(`${signal.title}｜建议：${signal.suggestion}｜${signal.message}`, {
      type: signal.level === "warning" ? "warning" : "info",
      showConfirm: signal.level === "warning",
    });
  }
}
