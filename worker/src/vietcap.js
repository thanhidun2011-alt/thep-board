// Lấy dữ liệu trực tiếp từ API công khai của Vietcap (VCI).
import { cached } from "./cache.js";

const TRADING = "https://trading.vietcap.com.vn/api";
const IQ = "https://iq.vietcap.com.vn/api/iq-insight-service/v1";
export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  Accept: "application/json, text/plain, */*",
  Referer: "https://trading.vietcap.com.vn/",
  Origin: "https://trading.vietcap.com.vn",
};

export const SECTIONS = { income: "INCOME_STATEMENT", balance: "BALANCE_SHEET", cashflow: "CASH_FLOW" };

export class UpstreamError extends Error {
  status = 502;
}

export async function fetchJson(url, init = {}, label = "Vietcap") {
  let r;
  try {
    r = await fetch(url, init);
  } catch (e) {
    throw new UpstreamError(`Lỗi nguồn dữ liệu ${label}: ${e.message}`);
  }
  if (!r.ok) throw new UpstreamError(`Lỗi nguồn dữ liệu ${label}: HTTP ${r.status}`);
  return r.json();
}

const get = (url) => fetchJson(url, { headers: HEADERS });
const post = (url, body) =>
  fetchJson(url, { method: "POST", headers: { ...HEADERS, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const iq = async (path) => (await get(IQ + path))?.data;

const byPeriod = (lenKey) => (a, b) => a.yearReport - b.yearReport || (a[lenKey] || 0) - (b[lenKey] || 0);

/** Nến OHLCV. timeframe: ONE_MINUTE | ONE_HOUR | ONE_DAY. Giá cổ phiếu tính bằng VND. Mỗi request chỉ 1 mã. */
export const ohlc = cached("ohlc", 60, async (symbol, timeframe, count) => {
  const data = await post(`${TRADING}/chart/OHLCChart/gap-chart`, {
    timeFrame: timeframe, symbols: [symbol], to: Math.floor(Date.now() / 1000), countBack: count,
  });
  if (!data?.length) return [];
  const d = data[0];
  return d.t.map((t, i) => ({ time: Number(t), open: d.o[i], high: d.h[i], low: d.l[i], close: d.c[i], volume: d.v[i] }));
});

export const priceBoard = cached("board", 20, async (symbols) => {
  const items = await post(`${TRADING}/price/symbols/getList`, { symbols });
  return items.map(({ listingInfo: li, matchPrice: mp = {} }) => {
    mp ||= {};
    const ref = mp.referencePrice || li.refPrice;
    const price = mp.matchPrice || ref;
    return {
      symbol: li.symbol,
      board: li.board,
      name: li.organName,
      shortName: li.organShortName,
      price,
      ref,
      ceiling: mp.ceilingPrice || li.ceiling,
      floor: mp.floorPrice || li.floor,
      open: mp.openPrice,
      high: mp.highest,
      low: mp.lowest,
      change: price && ref ? price - ref : 0,
      pct: price && ref ? ((price - ref) / ref) * 100 : 0,
      volume: mp.accumulatedVolume || 0,
      value: (mp.accumulatedValue || 0) * 1e6, // API trả về triệu đồng
      foreignBuy: mp.foreignBuyValue || 0,
      foreignSell: mp.foreignSellValue || 0,
      listedShare: li.listedShare,
      tradingDate: li.tradingDate,
    };
  });
});

export const marketIndices = cached("indices", 20, async (symbols) => {
  const items = await post(`${TRADING}/price/marketIndex/getList`, { symbols });
  return items.map((d) => ({
    symbol: d.symbol,
    price: d.price,
    ref: d.refPrice,
    change: d.change || 0,
    pct: d.changePercent || 0,
    volume: d.totalShares,
    value: (d.totalValue || 0) * 1e6,
    up: d.totalStockIncrease,
    down: d.totalStockDecline,
    flat: d.totalStockNoChange,
    ceiling: d.totalStockCeiling,
    floor: d.totalStockFloor,
  }));
});

export const overview = cached("overview", 3600, async (symbol) => (await iq(`/company/${symbol}`)) || {});

/** Chỉ số tài chính theo kỳ; quarter 1-4 là TTM theo quý, quarter 5 là cả năm. */
export const ratios = cached("ratios", 3600, async (symbol) =>
  ((await iq(`/company/${symbol}/statistics-financial`)) || []).sort(byPeriod("quarter")));

/** BCTC: {years, quarters}, mỗi kỳ là object field -> giá trị VND. */
export const statement = cached("statement", 3600, async (symbol, section) => {
  const d = (await iq(`/company/${symbol}/financial-statement?section=${SECTIONS[section]}`)) || {};
  return { years: (d.years || []).sort(byPeriod("lengthReport")), quarters: (d.quarters || []).sort(byPeriod("lengthReport")) };
});

/** Danh mục chỉ tiêu BCTC (tên tiếng Việt, cấp, field) theo từng section. */
export const statementMetrics = cached("metrics", 86400, async (symbol) =>
  (await iq(`/company/${symbol}/financial-statement/metrics`)) || {});

export const shareholders = cached("holders", 3600, async (symbol) =>
  (await iq(`/company/${symbol}/shareholder`)) || []);
