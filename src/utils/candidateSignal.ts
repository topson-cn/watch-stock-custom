import { INDUSTRY_CODES } from "../config";
import type { BuildCandidate, DailyIndicator, Position, StockQuote } from "../types";

interface CandidateMarketContext {
  sectorName: string;
  sectorChangePercent: number;
}

interface DropSnapshot {
  changePercent: number;
  turnoverRatio: number;
  timestamp: number;
}

const dropSnapshots = new Map<string, DropSnapshot>();
const SNAPSHOT_TTL = 15 * 60 * 1000;

const SECTOR_RULES: Array<{ name: string; keywords: string[] }> = [
  { name: "人工智能", keywords: ["工业富联", "寒武", "浪潮", "中科曙光", "海光", "昆仑", "拓维", "大族"] },
  { name: "半导体", keywords: ["长电", "通富", "华天", "北方华创", "中微", "兆易", "韦尔", "士兰", "德明利", "闻泰", "晶方"] },
  { name: "芯片", keywords: ["芯原", "晶方", "华虹", "闻泰", "紫光", "德明利"] },
  { name: "通信", keywords: ["中兴", "通宇", "光迅", "新易盛", "中际", "天孚", "亨通", "烽火", "沪电", "深南", "生益", "胜宏", "沃格"] },
  { name: "航空航天", keywords: ["中国卫星", "航天", "北斗", "中航", "洪都"] },
  { name: "金融", keywords: ["东方财富", "同花顺", "指南针", "恒生", "财富趋势"] },
  { name: "证券", keywords: ["证券", "中信建投", "东方证券", "华泰证券", "国泰君安"] },
  { name: "银行", keywords: ["银行", "招商", "平安银行", "宁波银行"] },
  { name: "有色金属", keywords: ["黄金", "紫金", "山东黄金", "中金黄金", "赤峰黄金", "洛阳钼业", "云南铜业", "江西铜业", "铜陵有色", "中国铝业", "云铝", "西部矿业", "驰宏", "锡业"] },
  { name: "稀土", keywords: ["北方稀土", "包钢", "厦门钨业", "盛和", "广晟", "中国稀土", "五矿稀土"] },
  { name: "电网设备", keywords: ["特变", "平高", "许继", "中国西电", "思源", "国电南瑞", "东方电缆", "金盘"] },
  { name: "新能源", keywords: ["阳光", "科士达", "科陆", "科华", "德业", "远东", "林洋", "固德威", "上能", "盛弘", "横店东磁", "露笑"] },
  { name: "机器人", keywords: ["机器人", "埃斯顿", "汇川", "鸣志", "拓斯达", "中大力德", "秦川", "柯力"] },
];

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatMoney(value: number): string {
  if (value >= 1e8) return `${(value / 1e8).toFixed(1)}亿`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(0)}万`;
  return value.toFixed(0);
}

function sectorQuoteByName(name: string, quoteMap: Map<string, StockQuote>): StockQuote | null {
  const config = INDUSTRY_CODES.find((item) => item.name === name);
  return config ? quoteMap.get(config.code) || null : null;
}

function pickSector(quote: StockQuote, quoteMap: Map<string, StockQuote>): CandidateMarketContext {
  const rule = SECTOR_RULES.find((item) =>
    item.keywords.some((keyword) => quote.name.includes(keyword)),
  );
  const matched = rule ? sectorQuoteByName(rule.name, quoteMap) : null;
  if (matched) {
    return {
      sectorName: rule!.name,
      sectorChangePercent: toNumber(matched.changePercent),
    };
  }

  const ranked = INDUSTRY_CODES.map((item) => {
    const q = quoteMap.get(item.code);
    return q
      ? { name: item.name, changePercent: toNumber(q.changePercent) }
      : null;
  })
    .filter((item): item is { name: string; changePercent: number } => item !== null)
    .sort((a, b) => b.changePercent - a.changePercent);

  return {
    sectorName: ranked[0]?.name || "未匹配",
    sectorChangePercent: ranked[0]?.changePercent || 0,
  };
}

export function isMainBoardStock(code: string): boolean {
  return code.startsWith("sh60") || code.startsWith("sz00");
}

export function buildCandidateMarketContext(
  quote: StockQuote,
  quoteMap: Map<string, StockQuote>,
): CandidateMarketContext {
  return pickSector(quote, quoteMap);
}

function detectShrinkingDrop(quote: StockQuote): boolean {
  const now = Date.now();
  const changePercent = toNumber(quote.changePercent);
  const turnoverRatio = toNumber(quote.turnoverRatio);
  const previous = dropSnapshots.get(quote.code);
  dropSnapshots.set(quote.code, { changePercent, turnoverRatio, timestamp: now });
  if (!previous || now - previous.timestamp > SNAPSHOT_TTL) return false;

  const dropExpanded = changePercent <= previous.changePercent - 1.0 && changePercent < 0;
  const turnoverNotExpanded = turnoverRatio <= previous.turnoverRatio + 0.35;
  return dropExpanded && turnoverNotExpanded && quote.amount >= 200000000;
}

export function buildStockCandidate(
  quote: StockQuote,
  positions: Position[],
  quoteMap: Map<string, StockQuote>,
  daily: DailyIndicator | null,
): BuildCandidate | null {
  if (!isMainBoardStock(quote.code) || quote.isETF || /ST|退/.test(quote.name)) return null;
  if (positions.some((position) => position.stockCode === quote.code)) return null;

  const current = toNumber(quote.current);
  const changePercent = toNumber(quote.changePercent);
  const volumeRatio = toNumber(quote.volumeRatio);
  const turnoverRatio = toNumber(quote.turnoverRatio);
  const open = toNumber(quote.open);
  const high = toNumber(quote.high);
  const low = toNumber(quote.low);
  const avgPrice = toNumber(quote.avgPrice);
  const prevClose = toNumber(quote.close);
  const sector = buildCandidateMarketContext(quote, quoteMap);
  const shrinkingDrop = detectShrinkingDrop(quote);

  if (current <= 0 || quote.amount < 150000000) return null;
  if (changePercent >= 9.8 || changePercent <= -6) return null;

  const volumeBreak60 =
    !!daily &&
    current > daily.ma60 &&
    daily.prev.close <= daily.prevMa60 &&
    quote.amount > daily.amount5 * 1.25 &&
    changePercent > -1 &&
    changePercent < 8.8;
  const macdConfirm = !!daily?.macdGoldZero && changePercent > -1.5 && changePercent < 8.8;
  const nearMa60 =
    !!daily && current >= daily.ma60 * 0.98 && current <= daily.ma60 * 1.08;
  const pullbackHold =
    shrinkingDrop &&
    sector.sectorChangePercent >= -0.3 &&
    volumeRatio <= 1.35 &&
    turnoverRatio <= 8;
  const strongTurnover =
    sector.sectorChangePercent >= 1.2 &&
    quote.amount >= 1000000000 &&
    changePercent >= 4 &&
    changePercent < 9.5 &&
    volumeRatio >= 1.15 &&
    volumeRatio <= 5.5 &&
    turnoverRatio <= 15 &&
    (high <= 0 || current >= high * 0.985);
  const divergenceTurnStrong =
    sector.sectorChangePercent >= 0.8 &&
    quote.amount >= 700000000 &&
    changePercent >= 1.5 &&
    changePercent < 8.8 &&
    avgPrice > 0 &&
    current >= avgPrice &&
    open > 0 &&
    current >= open &&
    prevClose > 0 &&
    low <= Math.max(prevClose, open) * 0.995;

  let score = 0;
  const reasons: string[] = [];

  if (volumeBreak60) {
    score += 34;
    reasons.push(`放量突破60日线，成交额约${formatMoney(quote.amount)}，适合小仓试探`);
  }
  if (macdConfirm) {
    score += 30;
    reasons.push("MACD在零轴上方首次金叉，偏趋势确认");
  }
  if (pullbackHold) {
    score += 26;
    reasons.push("盘中跌幅扩大但换手未同步放大，按洗盘/承接观察");
  }
  if (strongTurnover) {
    score += 28;
    reasons.push("前排强势换手后维持高位，适合高风险小仓观察");
  }
  if (divergenceTurnStrong) {
    score += 24;
    reasons.push("分歧后重新站回均价/开盘价，按分歧转强观察");
  }
  if (sector.sectorChangePercent >= 1.2) {
    score += 18;
    reasons.push(`${sector.sectorName}板块强度${formatPercent(sector.sectorChangePercent)}，有板块效应`);
  } else if (sector.sectorChangePercent >= 0) {
    score += 8;
    reasons.push(`${sector.sectorName}板块不弱，暂不逆势`);
  }
  if (quote.amount >= 1000000000) {
    score += 12;
    reasons.push("成交额过10亿，流动性足够短线进出");
  } else if (quote.amount >= 500000000) {
    score += 7;
    reasons.push("成交额过5亿，流动性尚可");
  }
  if (nearMa60) {
    score += 8;
    reasons.push("价格贴近60日线，便于设置机械风控");
  }
  if (changePercent > 0 && changePercent <= 4.5) {
    score += 8;
    reasons.push("涨幅未过热，避免高开猛冲追涨");
  } else if (changePercent > 4.5 && changePercent < 9.5 && (strongTurnover || divergenceTurnStrong)) {
    score += 4;
    reasons.push("位置偏高，只按前排强势确认处理，不当低吸买点");
  } else if (changePercent < 0 && changePercent >= -3) {
    score += 6;
    reasons.push("回踩幅度可控，重点看承接而不是补跌");
  }
  if (volumeRatio >= 1.1 && volumeRatio <= 2.8) {
    score += 6;
    reasons.push(`量比${volumeRatio.toFixed(2)}，放量但未明显失控`);
  }

  const hasPrimarySignal = volumeBreak60 || macdConfirm || pullbackHold || strongTurnover || divergenceTurnStrong;
  if (!hasPrimarySignal || score < 42) return null;

  let tier = "观察";
  if (score >= 78) tier = "优先";
  else if (score >= 62) tier = "可试";

  const title = volumeBreak60
    ? "买点试探"
    : macdConfirm
      ? "趋势确认"
      : strongTurnover
        ? "强势换手"
        : divergenceTurnStrong
          ? "分歧转强"
          : "洗盘识别";

  const risk = daily
    ? strongTurnover || divergenceTurnStrong
      ? `位置偏高，只看前排换手承接；若跌回均价/开盘价或放量跌破${daily.ma60.toFixed(2)}附近，放弃/机械止损。`
      : `不追无承接急拉；若跌回60日线下方或放量跌破${daily.ma60.toFixed(2)}附近，放弃/机械止损。`
    : "缺少日线指标，只作为盘中观察；若板块转弱、跌回均价或放量下杀，放弃。";

  return {
    code: quote.code,
    name: quote.name,
    current,
    changePercent,
    amount: quote.amount,
    volumeRatio,
    turnoverRatio,
    sectorName: sector.sectorName,
    sectorChangePercent: sector.sectorChangePercent,
    score,
    tier,
    title,
    reasons: reasons.slice(0, 5),
    risk,
  };
}
