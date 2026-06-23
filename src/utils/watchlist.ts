import { isValidStockCode } from "./stock";

export function putStockFirst(stocks: string[], stockCode: string): string[] {
  const normalized = stockCode.toLowerCase();
  if (!isValidStockCode(normalized)) return stocks;

  return [
    normalized,
    ...stocks.filter((code) => code.toLowerCase() !== normalized),
  ];
}
