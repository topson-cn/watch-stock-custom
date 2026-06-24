import { config, INDUSTRY_CODE_LIST } from "../config";
import {
  getDailyIndicator,
  getMainBoardMarketQuoteList,
  getStockQuoteList,
} from "./stockService";
import { buildStockCandidate, isMainBoardStock } from "../utils/candidateSignal";
import type { BuildCandidate } from "../types";

const CANDIDATE_DAILY_SCAN_LIMIT = 180;
const CANDIDATE_MIN_PRICE = 15;
const CANDIDATE_MAX_PRICE = 150;
const CANDIDATE_MAX_CHASE_CHANGE = 4;

function priceBandScore(current: number): number {
  return current >= CANDIDATE_MIN_PRICE && current <= CANDIDATE_MAX_PRICE ? 10 : 0;
}

function changeBandScore(changePercent: number): number {
  if (changePercent >= 2 && changePercent <= 3) return 14;
  if (changePercent >= 1 && changePercent < 2) return 8;
  if (changePercent > 3 && changePercent < CANDIDATE_MAX_CHASE_CHANGE) return 3;
  if (changePercent >= 0 && changePercent < 1) return 2;
  return 0;
}

export async function scanBuildCandidates(limit = 10): Promise<BuildCandidate[]> {
  const [marketQuotes, industryQuotes] = await Promise.all([
    getMainBoardMarketQuoteList(),
    getStockQuoteList(INDUSTRY_CODE_LIST),
  ]);
  const quoteMap = new Map(
    [...marketQuotes, ...industryQuotes].map((quote) => [quote.code, quote]),
  );
  const positions = config.getPositions();
  const positionCodes = new Set(positions.map((position) => position.stockCode));
  const stockQuotes = marketQuotes
    .filter((quote) => isMainBoardStock(quote.code))
    .filter((quote) => !positionCodes.has(quote.code))
    .filter((quote) => !quote.isETF && !/ST|退/.test(quote.name))
    .filter((quote) => quote.amount >= 150000000)
    .filter((quote) => {
      const current = Number(quote.current);
      const changePercent = Number(quote.changePercent);
      return (
        current >= CANDIDATE_MIN_PRICE &&
        current <= CANDIDATE_MAX_PRICE &&
        changePercent > -6 &&
        changePercent < CANDIDATE_MAX_CHASE_CHANGE
      );
    });

  const dailyScanQuotes = [...stockQuotes]
    .sort((a, b) => {
      const aScore =
        Math.log10(Math.max(a.amount, 1)) +
        Number(a.volumeRatio) * 1.8 +
        priceBandScore(Number(a.current)) +
        changeBandScore(Number(a.changePercent));
      const bScore =
        Math.log10(Math.max(b.amount, 1)) +
        Number(b.volumeRatio) * 1.8 +
        priceBandScore(Number(b.current)) +
        changeBandScore(Number(b.changePercent));
      return bScore - aScore;
    })
    .slice(0, CANDIDATE_DAILY_SCAN_LIMIT);
  const dailyEntries = await Promise.all(
    dailyScanQuotes.map(
      async (quote) => [quote.code, await getDailyIndicator(quote.code)] as const,
    ),
  );
  const dailyMap = new Map(dailyEntries);

  return stockQuotes
    .map((quote) =>
      buildStockCandidate(
        quote,
        positions,
        quoteMap,
        dailyMap.get(quote.code) || null,
      ),
    )
    .filter((item): item is BuildCandidate => item !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
