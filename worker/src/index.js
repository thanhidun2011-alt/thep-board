// Cloudflare Worker: API /api/* cho Thép Board. Các đường dẫn khác do Static Assets (frontend/) phục vụ.
import * as svc from "./services.js";
import * as cm from "./commodities.js";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Cho phép giao diện đặt ở domain khác (ví dụ GitHub Pages) gọi API
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const STOCK_RANGE = /^(1d|1m|3m|6m|1y|3y|5y)$/;
const CM_RANGE = /^(1m|3m|6m|1y|3y|5y)$/;

function param(url, name, def, pattern) {
  const v = url.searchParams.get(name) ?? def;
  if (!pattern.test(v)) throw new HttpError(422, `Tham số ${name} không hợp lệ: ${v}`);
  return v;
}

function steel(symbol) {
  const s = symbol.toUpperCase();
  if (!svc.STEEL.includes(s)) throw new HttpError(404, `Mã ${s} không thuộc danh sách theo dõi`);
  return s;
}

// [pattern, handler, max-age giây cho trình duyệt]
const ROUTES = [
  [/^\/api\/config$/, () => ({ steel: svc.STEEL, indices: svc.INDICES, ranges: Object.keys(svc.RANGES) }), 3600],
  [/^\/api\/indices$/, () => svc.indices(), 15],
  [/^\/api\/watchlist$/, () => svc.watchlist(), 15],
  [/^\/api\/history\/([\w]+)$/, (url, [sym]) => {
    const s = sym in svc.INDICES ? sym : steel(sym);
    return svc.history(s, param(url, "range", "6m", STOCK_RANGE));
  }, 30],
  [/^\/api\/stock\/(\w+)$/, (url, [sym]) => svc.stock(steel(sym)), 30],
  [/^\/api\/stock\/(\w+)\/financials$/, (url, [sym]) => svc.financials(
    steel(sym), param(url, "section", "income", /^(income|balance|cashflow)$/), param(url, "period", "year", /^(year|quarter)$/),
  ), 600],
  [/^\/api\/stock\/(\w+)\/series$/, (url, [sym]) => svc.ratioSeries(steel(sym), param(url, "period", "quarter", /^(year|quarter)$/)), 600],
  [/^\/api\/fundamentals\/(\w+)$/, (url, [sym]) => svc.fundamentals(steel(sym)), 60],
  [/^\/api\/commodities$/, () => cm.list(), 3600],
  [/^\/api\/commodities\/([\w-]+)$/, (url, [id]) => {
    if (!(id in cm.COMMODITIES)) throw new HttpError(404, `Không có hàng hóa ${id}`);
    return cm.detail(id, param(url, "range", "1y", CM_RANGE));
  }, 300],
];

function json(data, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
      ...CORS,
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "GET") return json({ detail: "Method not allowed" }, 405);
    for (const [pattern, handler, maxAge] of ROUTES) {
      const m = url.pathname.match(pattern);
      if (!m) continue;
      try {
        return json(await handler(url, m.slice(1)), 200, maxAge);
      } catch (e) {
        const status = e.status || 500;
        if (status >= 500) console.error(url.pathname, e);
        return json({ detail: e.message || "Lỗi máy chủ" }, status);
      }
    }
    return json({ detail: "Không tìm thấy API" }, 404);
  },
};
