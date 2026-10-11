// Ghép và tính toán dữ liệu cổ phiếu cho các API của web.
import * as vc from "./vietcap.js";

export const STEEL = ["HPG", "HSG", "NKG", "GDA", "VGS", "POM", "TVN", "TIS", "TLH", "SMC"];
export const INDICES = { VNINDEX: "VN-Index", VN30: "VN30", HNXIndex: "HNX-Index", HNXUpcomIndex: "UPCOM-Index" };
export const RANGES = {
  "1d": ["ONE_MINUTE", 300],
  "1m": ["ONE_DAY", 22],
  "3m": ["ONE_DAY", 66],
  "6m": ["ONE_DAY", 130],
  "1y": ["ONE_DAY", 250],
  "3y": ["ONE_DAY", 750],
  "5y": ["ONE_DAY", 1250],
};
const SPARK_DAYS = 30;
// Chỉ tiêu KQKD của doanh nghiệp phi tài chính (cả 10 mã thép đều dùng bộ này)
const REVENUE = "isa3", GROSS_PROFIT = "isa5", NET_PROFIT_PARENT = "isa22";

const pct = (v) => (v == null ? null : v * 100);
const growth = (cur, prev) => (cur == null || prev == null || prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100);

export async function history(symbol, range) {
  const [timeframe, count] = RANGES[range];
  return vc.ohlc(symbol, timeframe, count);
}

async function spark(symbol) {
  try {
    return (await vc.ohlc(symbol, "ONE_DAY", SPARK_DAYS)).map((c) => c.close);
  } catch {
    return [];
  }
}

export async function indices() {
  const syms = Object.keys(INDICES);
  const [rows, sparks] = await Promise.all([vc.marketIndices(syms), Promise.all(syms.map(spark))]);
  return syms.map((s, i) => ({ ...(rows.find((r) => r.symbol === s) || { symbol: s }), name: INDICES[s], spark: sparks[i] }));
}

export async function watchlist() {
  const [board, sparks] = await Promise.all([vc.priceBoard(STEEL), Promise.all(STEEL.map(spark))]);
  return STEEL.flatMap((s, i) => {
    const row = board.find((r) => r.symbol === s);
    return row ? [{ ...row, marketCap: (row.price || 0) * (row.listedShare || 0), spark: sparks[i] }] : [];
  });
}

/** Tổng 4 quý gần nhất (offset=4 là 4 quý cùng kỳ năm trước). */
function ttm(quarters, field, offset = 0) {
  if (quarters.length < 4 + offset) return null;
  const w = quarters.slice(quarters.length - 4 - offset, quarters.length - offset);
  if (w.some((q) => q[field] == null)) return null;
  return w.reduce((a, q) => a + q[field], 0);
}

const latestTtmRatio = (rows) => rows.filter((r) => (r.quarter || 0) <= 4).at(-1) || {};

/** Chỉ số cơ bản tính trên TTM, dùng chung cho dashboard và bảng so sánh ngành. */
export async function fundamentals(symbol) {
  const [board, ov, rat, inc] = await Promise.all([
    vc.priceBoard(STEEL), vc.overview(symbol), vc.ratios(symbol), vc.statement(symbol, "income"),
  ]);
  const q = board.find((r) => r.symbol === symbol) || {};
  const r = latestTtmRatio(rat);
  const quarters = inc.quarters;
  const shares = q.listedShare || ov.issueShare;
  const price = q.price;
  const rev = ttm(quarters, REVENUE), revPrev = ttm(quarters, REVENUE, 4);
  const np = ttm(quarters, NET_PROFIT_PARENT), npPrev = ttm(quarters, NET_PROFIT_PARENT, 4);
  const eps = np != null && shares ? np / shares : null;
  const lastQ = quarters.at(-1);
  return {
    symbol,
    price,
    pct: q.pct,
    marketCap: price && shares ? price * shares : null,
    eps,
    pe: eps && eps > 0 ? price / eps : null,
    pb: r.pb || null, // API trả 0 khi vốn chủ sở hữu âm (ví dụ POM)
    roe: pct(r.roe),
    roa: pct(r.roa),
    grossMargin: pct(r.grossMargin),
    netMargin: pct(r.afterTaxProfitMargin),
    debtToEquity: r.debtPerEquity ?? null,
    currentRatio: r.currentRatio ?? null,
    evToEbitda: r.evToEbitda ?? null,
    revenueTTM: rev,
    netProfitTTM: np,
    revenueGrowth: growth(rev, revPrev),
    netProfitGrowth: growth(np, npPrev),
    ratioPeriod: r.yearReport ? `Q${r.quarter}/${r.yearReport}` : null,
    latestQuarter: lastQ ? `Q${lastQ.lengthReport}/${lastQ.yearReport}` : null,
  };
}

export async function stock(symbol) {
  const [board, ov, fund, holders] = await Promise.all([
    vc.priceBoard(STEEL), vc.overview(symbol), fundamentals(symbol), vc.shareholders(symbol),
  ]);
  const q = board.find((r) => r.symbol === symbol) || {};
  return {
    quote: q,
    fundamentals: fund,
    profile: {
      name: ov.viOrganName || q.name,
      shortName: ov.viOrganShortName,
      enName: ov.enOrganName,
      sector: ov.sectorVn,
      icbCode: ov.icbCodeLv4,
      listingDate: ov.listingDate,
      issueShare: ov.issueShare,
      freeFloatPct: pct(ov.freeFloatPercentage),
      foreignPct: pct(ov.foreignerPercentage),
      statePct: pct(ov.statePercentage),
      high52w: ov.highestPrice1Year,
      low52w: ov.lowestPrice1Year,
      avgVolume1m: ov.averageMatchVolume1Month,
      rating: ov.rating,
      targetPrice: ov.targetPrice,
      ratingAsOf: ov.ratingAsOf,
      profileHtml: ov.profile,
    },
    shareholders: [...holders]
      .sort((a, b) => (b.percentage || 0) - (a.percentage || 0))
      .slice(0, 10)
      .map((h) => ({ name: h.ownerName, quantity: h.quantity, pct: pct(h.percentage), type: h.ownerType, date: h.publicDate })),
  };
}

const periodLabel = (p, period) => (period === "year" ? String(p.yearReport) : `Q${p.lengthReport}/${p.yearReport}`);

export async function financials(symbol, section, period, limit = 8) {
  const [data, metrics] = await Promise.all([vc.statement(symbol, section), vc.statementMetrics(symbol)]);
  const periods = data[period === "year" ? "years" : "quarters"].slice(-limit);
  const rows = [];
  for (const m of metrics[vc.SECTIONS[section]] || []) {
    const values = periods.map((p) => p[m.field] ?? null);
    if (values.every((v) => v == null || v === 0)) continue;
    rows.push({ field: m.field, title: m.titleVi, level: m.level, values });
  }
  return { periods: periods.map((p) => periodLabel(p, period)), rows };
}

/** Chuỗi thời gian cho các biểu đồ kết quả kinh doanh và chỉ số. */
export async function ratioSeries(symbol, period) {
  const [rat, inc] = await Promise.all([vc.ratios(symbol), vc.statement(symbol, "income")]);
  const yearly = period === "year";
  const stmts = yearly ? inc.years.slice(-8) : inc.quarters.slice(-12);
  const key = (y, q) => `${y}-${q}`;
  const rmap = new Map(
    rat.filter((r) => (yearly ? r.quarter === 5 : (r.quarter || 0) <= 4)).map((r) => [key(r.yearReport, yearly ? 5 : r.quarter), r]),
  );
  const out = Object.fromEntries(
    ["labels", "revenue", "grossProfit", "netProfit", "grossMargin", "netMargin", "roe", "roa", "pe", "pb", "debtToEquity"].map((k) => [k, []]),
  );
  for (const p of stmts) {
    const r = rmap.get(key(p.yearReport, yearly ? 5 : p.lengthReport)) || {};
    const rev = p[REVENUE], gp = p[GROSS_PROFIT], np = p[NET_PROFIT_PARENT];
    out.labels.push(periodLabel(p, period));
    out.revenue.push(rev ?? null);
    out.grossProfit.push(gp ?? null);
    out.netProfit.push(np ?? null);
    out.grossMargin.push(rev && gp != null ? (gp / rev) * 100 : null);
    out.netMargin.push(rev && np != null ? (np / rev) * 100 : null);
    out.roe.push(pct(r.roe));
    out.roa.push(pct(r.roa));
    out.pe.push(r.pe ?? null);
    out.pb.push(r.pb ?? null);
    out.debtToEquity.push(r.debtPerEquity ?? null);
  }
  return out;
}
