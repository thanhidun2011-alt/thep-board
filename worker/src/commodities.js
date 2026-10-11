// Giá hàng hóa từ nguồn miễn phí, không cần API key (đều là endpoint không chính thức):
// - Yahoo Finance chart API: hợp đồng tương lai CME/NYMEX/ICE.
// - Sina Finance: hợp đồng tương lai liên tục sàn Trung Quốc (DCE, SHFE, INE, ZCE), trả về JSONP.
import { cached } from "./cache.js";
import { fetchJson, UA, UpstreamError } from "./vietcap.js";

// Thứ tự trong mỗi nhóm (category) là thứ tự màu --cat-1..8 trên biểu đồ so sánh. Mỗi nhóm tối đa 8 mặt hàng.
export const COMMODITIES = {
  "iron-ore-dce": { name: "Quặng sắt", market: "DCE Đại Liên", unit: "CNY/tấn", source: ["sina", "I0"], group: "Nguyên liệu" },
  "iron-ore-62": { name: "Quặng sắt 62% Fe CFR TQ", market: "CME/SGX (TSI)", unit: "USD/tấn", source: ["yahoo", "TIO=F"], group: "Nguyên liệu" },
  "coking-coal": { name: "Than luyện cốc", market: "DCE Đại Liên", unit: "CNY/tấn", source: ["sina", "JM0"], group: "Nguyên liệu" },
  coke: { name: "Than cốc", market: "DCE Đại Liên", unit: "CNY/tấn", source: ["sina", "J0"], group: "Nguyên liệu" },
  "scrap-us": { name: "Thép phế liệu (Busheling)", market: "CME · Mỹ Midwest", unit: "USD/tấn dài", source: ["yahoo", "BUS=F"], group: "Nguyên liệu" },
  "hrc-shfe": { name: "Thép cuộn cán nóng HRC", market: "SHFE Thượng Hải", unit: "CNY/tấn", source: ["sina", "HC0"], group: "Thành phẩm" },
  "hrc-us": { name: "Thép cuộn cán nóng HRC", market: "CME · Mỹ Midwest", unit: "USD/tấn ngắn", source: ["yahoo", "HRC=F"], group: "Thành phẩm" },
  "rebar-shfe": { name: "Thép cây", market: "SHFE Thượng Hải", unit: "CNY/tấn", source: ["sina", "RB0"], group: "Thành phẩm" },
  wti: { name: "Dầu thô WTI", market: "NYMEX · Mỹ", unit: "USD/thùng", source: ["yahoo", "CL=F"], group: "Năng lượng" },
  brent: { name: "Dầu thô Brent", market: "ICE · Biển Bắc", unit: "USD/thùng", source: ["yahoo", "BZ=F"], group: "Năng lượng" },
  "crude-ine": { name: "Dầu thô Thượng Hải", market: "INE Thượng Hải", unit: "CNY/thùng", source: ["sina", "SC0"], group: "Năng lượng" },
  natgas: { name: "Khí tự nhiên Henry Hub", market: "NYMEX · Mỹ", unit: "USD/MMBtu", source: ["yahoo", "NG=F"], group: "Năng lượng" },
  "sugar-11": { name: "Đường thô số 11", market: "ICE · Mỹ", unit: "US cent/pound", source: ["yahoo", "SB=F"], group: "Nông sản" },
  "sugar-zce": { name: "Đường trắng", market: "ZCE Trịnh Châu", unit: "CNY/tấn", source: ["sina", "SR0"], group: "Nông sản" },
  "rubber-shfe": { name: "Cao su RSS3", market: "SHFE Thượng Hải", unit: "CNY/tấn", source: ["sina", "RU0"], group: "Nông sản" },
  "rubber-tsr20": { name: "Cao su TSR20", market: "INE Thượng Hải", unit: "CNY/tấn", source: ["sina", "NR0"], group: "Nông sản" },
};
const CATEGORY = { "Nguyên liệu": "steel", "Thành phẩm": "steel", "Năng lượng": "energy", "Nông sản": "energy" };
export const RANGES = { "1m": 31, "3m": 92, "6m": 183, "1y": 366, "3y": 1096, "5y": 1827 };
const STALE_DAYS = 10;
const DAY = 86400;

/** '2026-10-09' -> epoch giây lúc 00:00 UTC, thống nhất với nến ngày của Vietcap. */
const dayTs = (d) => Date.parse(d + "T00:00:00Z") / 1000;

const yahooDaily = cached("yahoo", 1800, async (ticker) => {
  const j = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5y&interval=1d`,
    { headers: { "User-Agent": UA } },
    "Yahoo Finance",
  );
  const res = j?.chart?.result?.[0];
  if (!res) return [];
  const offset = res.meta?.gmtoffset || 0;
  const q = res.indicators.quote[0];
  const byDay = new Map(); // trùng ngày thì giữ bản ghi sau cùng
  (res.timestamp || []).forEach((ts, i) => {
    const c = q.close[i];
    if (c == null) return;
    const day = new Date((ts + offset) * 1000).toISOString().slice(0, 10);
    byDay.set(day, {
      time: dayTs(day), open: q.open[i] ?? c, high: q.high[i] ?? c, low: q.low[i] ?? c, close: c, volume: q.volume[i] || 0,
    });
  });
  return [...byDay.values()].sort((a, b) => a.time - b.time);
});

const sinaDaily = cached("sina", 1800, async (symbol) => {
  let r;
  try {
    r = await fetch(
      `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_x=/InnerFuturesNewService.getDailyKLine?symbol=${symbol}`,
      { headers: { "User-Agent": UA, Referer: "https://finance.sina.com.cn/" } },
    );
  } catch (e) {
    throw new UpstreamError(`Lỗi nguồn dữ liệu Sina Finance: ${e.message}`);
  }
  if (!r.ok) throw new UpstreamError(`Lỗi nguồn dữ liệu Sina Finance: HTTP ${r.status}`);
  const text = await r.text();
  const body = text.slice(text.indexOf("(") + 1, text.lastIndexOf(")"));
  const rows = body.trim() ? JSON.parse(body) : [];
  return rows
    .filter((x) => x.c && Number(x.c) > 0)
    .map((x) => ({ time: dayTs(x.d), open: +x.o, high: +x.h, low: +x.l, close: +x.c, volume: +(x.v || 0) }));
});

export function meta(id) {
  const { source, ...m } = COMMODITIES[id];
  return {
    id, ...m, category: CATEGORY[m.group],
    provider: source[0] === "sina" ? "Sina Finance" : "Yahoo Finance", ticker: source[1],
  };
}

export const list = () => Object.keys(COMMODITIES).map(meta);

/** % thay đổi từ giá đóng cửa gần nhất trước mốc thời gian đến giá cuối. */
function changeSince(candles, cutoff) {
  let base = null;
  for (let i = candles.length - 1; i >= 0; i--) if (candles[i].time <= cutoff) { base = candles[i]; break; }
  if (!base || !base.close) return null;
  return ((candles.at(-1).close - base.close) / base.close) * 100;
}

/** Tóm tắt + nến của 1 mặt hàng trong khung `range` (mốc tính từ hôm nay để mọi series cùng khung thời gian). */
export async function detail(id, range) {
  const [kind, code] = COMMODITIES[id].source;
  const data = await (kind === "sina" ? sinaDaily(code) : yahooDaily(code));
  const m = meta(id);
  if (!data.length) return { ...m, error: "Không có dữ liệu", history: [] };
  const now = Date.now() / 1000;
  const last = data.at(-1), prev = data.at(-2);
  const lastT = last.time;
  const yearStart = Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000;
  const year = data.filter((c) => c.time >= lastT - 365 * DAY);
  return {
    ...m,
    price: last.close,
    date: lastT,
    // Nguồn ngừng cập nhật (ví dụ BUS=F trên Yahoo dừng từ 12/2025) -> frontend hiện cảnh báo
    stale: now - lastT > STALE_DAYS * DAY,
    change: prev ? last.close - prev.close : null,
    pct: prev && prev.close ? ((last.close - prev.close) / prev.close) * 100 : null,
    w1: changeSince(data, lastT - 7 * DAY),
    m1: changeSince(data, lastT - 30 * DAY),
    m3: changeSince(data, lastT - 91 * DAY),
    ytd: lastT >= yearStart ? changeSince(data, yearStart - 1) : null,
    y1: changeSince(data, lastT - 365 * DAY),
    high52w: Math.max(...year.map((c) => c.high)),
    low52w: Math.min(...year.map((c) => c.low)),
    spark: data.filter((c) => c.time >= lastT - 92 * DAY).map((c) => c.close),
    history: data.filter((c) => c.time >= now - RANGES[range] * DAY),
  };
}
