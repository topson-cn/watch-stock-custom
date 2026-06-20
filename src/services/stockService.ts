// 股票数据服务，支持新浪/腾讯双源批量查询
import { get, getGbk } from "../utils/http";
import { buildTimeSlots } from "../utils/time";
import { isFund, getDecimals, safeNumber } from "../utils/stock";
import type { Stock, StockQuote, MinutePoint, DailyBar, DailyIndicator } from "../types";

// 解析新浪源单条数据
function parseSinaStockData(code: string, data: string): Stock | null {
  const parts = data.split(",");
  if (parts.length < 32) return null;

  const name = parts[0]?.trim() || "";
  const close = safeNumber(parts[2]);
  let current = safeNumber(parts[3]);
  const amount = safeNumber(parts[9]);

  if (!name || close <= 0 || !parts[30] || !parts[31]) return null;

  // 开盘前当前价为0，使用昨收价
  if (current <= 0) current = close;

  const changeValue = current - close;
  const changePercent = ((changeValue / close) * 100).toFixed(2);
  const isETF = isFund(code, name, current);
  const dec = getDecimals(isETF);

  return {
    name,
    code,
    current: current.toFixed(dec),
    changeValue: changeValue.toFixed(dec),
    changePercent,
    amount,
    isETF,
    dateTime: `${parts[30]} ${parts[31]}`,
    close,
    buy1Volume: Math.round(safeNumber(parts[10]) / 100),
    sell1Volume: Math.round(safeNumber(parts[20]) / 100),
    buy1Price: safeNumber(parts[6]),
    sell1Price: safeNumber(parts[7]),
  };
}

// 腾讯源完整行情解析（含市值、PE、PB 等详细指标）
function parseFullQuote(fields: string[], code: string): StockQuote {
  const isETF = isFund(code, fields[1] ?? "", safeNumber(fields[3]));
  const dec = getDecimals(isETF);

  // 20260409114906 -> 2026-04-09 11:49
  const r = fields[30] ?? "";
  const dateTime =
    r.length === 14
      ? `${r.slice(0, 4)}-${r.slice(4, 6)}-${r.slice(6, 8)} ${r.slice(8, 10)}:${r.slice(10, 12)}`
      : "";

  return {
    name: fields[1] ?? "",
    code,
    current: safeNumber(fields[3]).toFixed(dec),
    close: safeNumber(fields[4]).toFixed(dec),
    open: safeNumber(fields[5]).toFixed(dec),
    volume: safeNumber(fields[6]),
    changeValue: safeNumber(fields[31]).toFixed(dec),
    changePercent: safeNumber(fields[32]).toFixed(2),
    high: safeNumber(fields[33]).toFixed(dec),
    low: safeNumber(fields[34]).toFixed(dec),
    amount: safeNumber(fields[37]) * 10000,
    turnoverRatio: safeNumber(fields[38]).toFixed(2),
    pe: safeNumber(fields[39]),
    circulationMarket: safeNumber(fields[44]) * 100000000,
    totalMarket: safeNumber(fields[45]) * 100000000,
    pb: safeNumber(fields[46]),
    volumeRatio: safeNumber(fields[49]).toFixed(2),
    avgPrice: safeNumber(fields[51]).toFixed(dec),
    circulatingShares: safeNumber(fields[72]),
    totalShares: safeNumber(fields[73]),
    isETF,
    dateTime,
  };
}

// 腾讯源简版行情解析（无封单/时间字段）
function parseSimpleQuote(fields: string[], code: string): Stock {
  const isETF = isFund(code, fields[1] ?? "", safeNumber(fields[3]));
  const dec = getDecimals(isETF);

  return {
    name: fields[1] ?? "",
    code,
    current: safeNumber(fields[3]).toFixed(dec),
    changeValue: safeNumber(fields[4]).toFixed(dec),
    changePercent: safeNumber(fields[5]).toFixed(2),
    amount: safeNumber(fields[7]),
    isETF,
    dateTime: "",
  };
}

// 通用腾讯响应分行解析
function parseTencentLines<T>(
  text: string,
  codes: string[],
  parser: (fields: string[], code: string) => T,
): T[] {
  return text
    .split(";")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, index) => {
      const eqIdx = line.indexOf("=");
      if (eqIdx < 0) return null;
      let raw = line.slice(eqIdx + 1).trim();
      if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
      const code = codes[index];
      if (!code) return null;
      return parser(raw.split("~"), code);
    })
    .filter((v): v is T => v !== null);
}

// 批量获取股票行情（默认新浪源，集合竞价期间切换腾讯简版源）
export async function getStockList(
  codes: string[],
  isSina = true,
): Promise<Stock[]> {
  if (!codes?.length) return [];

  try {
    if (isSina) {
      const url = `https://hq.sinajs.cn/list=${codes.join(",")}`;
      const data = await getGbk(url);
      return data
        .split("\n")
        .map((line) => {
          const m = line.match(/var hq_str_([^=]+)="([^"]+)"/);
          if (m?.[1] && m[2] && codes.includes(m[1].toLowerCase())) {
            return parseSinaStockData(m[1].toLowerCase(), m[2]);
          }
          return null;
        })
        .filter((v): v is Stock => v !== null);
    }

    const url = `https://qt.gtimg.cn/?q=${codes.map((c) => `s_${c}`).join(",")}`;
    const data = await getGbk(url);
    return parseTencentLines(data, codes, parseSimpleQuote);
  } catch {
    return [];
  }
}

// 详细行情列表
export async function getStockQuoteList(
  codes: string[],
): Promise<StockQuote[]> {
  if (!codes?.length) return [];
  try {
    const url = `https://qt.gtimg.cn/?q=${codes.join(",")}`;
    const res = await getGbk(url);
    if (!res) return [];
    return parseTencentLines(res, codes, parseFullQuote);
  } catch {
    return [];
  }
}

// 分时数据（按完整时间槽填充，无数据点占位 null）
export async function getStockMinute(code: string): Promise<MinutePoint[]> {
  try {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${code}`;
    const text = await get(url);
    const res = JSON.parse(text);
    const stockData = res?.data?.[code];
    const d: string | undefined = stockData?.data?.date;
    if (!d) return [];

    const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const slots = buildTimeSlots(date);

    const dataMap = new Map<string, MinutePoint>();
    const list: string[] = stockData?.data?.data ?? [];
    for (const itemStr of list) {
      const item = itemStr.split(" ");
      if (item.length !== 4 || !item[0]) continue;
      const time = `${date} ${item[0].slice(0, 2)}:${item[0].slice(2, 4)}`;
      dataMap.set(time, {
        time,
        price: safeNumber(item[1]),
        volume: safeNumber(item[2]),
        amount: safeNumber(item[3]),
      });
    }

    return slots.map(
      (time) =>
        dataMap.get(time) ?? { time, price: null, volume: null, amount: null },
    );
  } catch {
    return [];
  }
}


interface EastmoneyMarketItem {
  f2?: number;
  f3?: number;
  f4?: number;
  f5?: number;
  f6?: number;
  f8?: number;
  f10?: number;
  f12?: string;
  f13?: number;
  f14?: string;
  f15?: number;
  f16?: number;
  f17?: number;
  f18?: number;
  f20?: number;
  f21?: number;
  f23?: number;
}

interface EastmoneyMarketResponse {
  data?: {
    diff?: EastmoneyMarketItem[];
  };
}

interface EastmoneyKlineResponse {
  data?: {
    klines?: string[];
  };
}

function parseEastmoneyMarketQuote(item: EastmoneyMarketItem): StockQuote | null {
  const rawCode = item.f12 || "";
  const market = item.f13;
  const code = market === 1 ? `sh${rawCode}` : market === 0 ? `sz${rawCode}` : "";
  const current = safeNumber(item.f2);
  const close = safeNumber(item.f18);
  const name = item.f14 || "";
  if (!code || !name || current <= 0 || close <= 0) return null;
  const isETF = isFund(code, name, current);
  const dec = getDecimals(isETF);
  const changeValue = safeNumber(item.f4);
  const changePercent = safeNumber(item.f3);

  return {
    name,
    code,
    current: current.toFixed(dec),
    close: close.toFixed(dec),
    open: safeNumber(item.f17).toFixed(dec),
    volume: safeNumber(item.f5),
    changeValue: changeValue.toFixed(dec),
    changePercent: changePercent.toFixed(2),
    high: safeNumber(item.f15).toFixed(dec),
    low: safeNumber(item.f16).toFixed(dec),
    amount: safeNumber(item.f6),
    turnoverRatio: safeNumber(item.f8).toFixed(2),
    pe: safeNumber(item.f23),
    circulationMarket: safeNumber(item.f21),
    totalMarket: safeNumber(item.f20),
    pb: 0,
    volumeRatio: safeNumber(item.f10).toFixed(2),
    avgPrice: current.toFixed(dec),
    circulatingShares: 0,
    totalShares: 0,
    isETF,
    dateTime: "",
  };
}

function getEastmoneySecid(code: string): string | null {
  if (code.startsWith("sh")) return `1.${code.slice(2)}`;
  if (code.startsWith("sz")) return `0.${code.slice(2)}`;
  return null;
}

function avg(values: number[]): number {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return 0;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

function ema(value: number, period: number, previous: number | null): number {
  if (previous === null) return value;
  const k = 2 / (period + 1);
  return value * k + previous * (1 - k);
}

function parseDailyBar(raw: string): DailyBar | null {
  const parts = raw.split(",");
  if (parts.length < 11) return null;
  const bar: DailyBar = {
    date: parts[0] || "",
    open: safeNumber(parts[1]),
    close: safeNumber(parts[2]),
    high: safeNumber(parts[3]),
    low: safeNumber(parts[4]),
    volume: safeNumber(parts[5]),
    amount: safeNumber(parts[6]),
    changePercent: safeNumber(parts[8]),
    turnoverRatio: safeNumber(parts[10]),
  };
  return bar.date && bar.close > 0 ? bar : null;
}

function buildDailyIndicator(bars: DailyBar[]): DailyIndicator | null {
  if (bars.length < 70) return null;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  if (!last || !prev) return null;

  const closes = bars.map((bar) => bar.close);
  const amounts = bars.map((bar) => bar.amount);
  const ma60 = avg(closes.slice(-60));
  const prevMa60 = avg(closes.slice(-61, -1));
  const amount5 = avg(amounts.slice(-6, -1));

  let ema12: number | null = null;
  let ema26: number | null = null;
  let dea: number | null = null;
  const macd = closes.map((close) => {
    ema12 = ema(close, 12, ema12);
    ema26 = ema(close, 26, ema26);
    const dif = ema12 - ema26;
    dea = ema(dif, 9, dea);
    return { dif, dea };
  });
  const lastMacd = macd[macd.length - 1];
  const prevMacd = macd[macd.length - 2];
  const recentGold = macd
    .slice(Math.max(1, macd.length - 22), macd.length - 2)
    .some((item, index, list) => {
      const before = index === 0 ? macd[macd.length - 23] : list[index - 1];
      return !!before && item.dif > item.dea && before.dif <= before.dea;
    });

  return {
    last,
    prev,
    ma60,
    prevMa60,
    amount5,
    macdGoldZero:
      !!lastMacd &&
      !!prevMacd &&
      lastMacd.dif > lastMacd.dea &&
      prevMacd.dif <= prevMacd.dea &&
      lastMacd.dif > 0 &&
      lastMacd.dea > 0 &&
      !recentGold,
  };
}

export async function getDailyIndicator(
  code: string,
): Promise<DailyIndicator | null> {
  const secid = getEastmoneySecid(code);
  if (!secid) return null;
  try {
    const url =
      "https://push2his.eastmoney.com/api/qt/stock/kline/get" +
      `?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=140`;
    const text = await get(url);
    const res = JSON.parse(text) as EastmoneyKlineResponse;
    const bars = (res.data?.klines || [])
      .map(parseDailyBar)
      .filter((bar): bar is DailyBar => bar !== null);
    return buildDailyIndicator(bars);
  } catch {
    return null;
  }
}


// 获取沪深主板全市场行情（排除科创板、创业板、北交所，供建仓候选池使用）
export async function getMainBoardMarketQuoteList(): Promise<StockQuote[]> {
  try {
    const fields = [
      "f2",
      "f3",
      "f4",
      "f5",
      "f6",
      "f8",
      "f10",
      "f12",
      "f13",
      "f14",
      "f15",
      "f16",
      "f17",
      "f18",
      "f20",
      "f21",
      "f23",
    ].join(",");
    const url =
      "https://push2.eastmoney.com/api/qt/clist/get" +
      `?pn=1&pz=5000&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f6&fs=m:1+t:2,m:0+t:6&fields=${fields}`;
    const text = await get(url);
    const res = JSON.parse(text) as EastmoneyMarketResponse;
    return (res.data?.diff || [])
      .map(parseEastmoneyMarketQuote)
      .filter((quote): quote is StockQuote => quote !== null);
  } catch {
    return [];
  }
}
