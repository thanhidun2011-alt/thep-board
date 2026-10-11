const STEEL = ["HPG", "HSG", "NKG", "GDA", "VGS", "POM", "TVN", "TIS", "TLH", "SMC"];
const TABS = ["overview", "financials", "peers", "profile"];
const REFRESH_MS = 30_000;

const state = {
  symbol: "HPG",
  tab: "overview",
  priceRange: "6m",
  idxSymbol: "VNINDEX",
  idxRange: "3m",
  seriesPeriod: "quarter",
  finSection: "income",
  finPeriod: "year",
  peerSort: { key: "marketCap", dir: -1 },
  peerMetric: "pe",
  watch: [],
  indices: [],
  stock: null,
  peers: null,
};

const $ = (id) => document.getElementById(id);

async function api(path) {
  const r = await fetch(`${window.API_BASE || ""}/api/${path}`);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.detail || `Lỗi ${r.status}`);
  }
  return r.json();
}

function goto(symbol, tab = state.tab) {
  location.hash = `#/${symbol}${tab && tab !== "overview" ? "/" + tab : ""}`;
}

// ---------------- Sidebar trái: chỉ số & watchlist ----------------
const RANGE_LABEL = { "1d": "1D", "1m": "1M", "3m": "3M", "6m": "6M", "1y": "1Y", "3y": "3Y", "5y": "5Y" };

function renderRanges(el, ranges, active, onPick) {
  el.innerHTML = ranges.map((r) => `<button data-r="${r}" class="${r === active ? "active" : ""}">${RANGE_LABEL[r]}</button>`).join("");
  el.onclick = (e) => {
    const r = e.target.dataset.r;
    if (r) onPick(r);
  };
}

let idxChart;
function showIdxOhlc(bar) {
  const last = idxChart?.data?.at(-1);
  const b = bar || last;
  if (!b) return ($("idxOhlc").innerHTML = "");
  $("idxOhlc").innerHTML = `O <b>${fmt.index(b.open)}</b> H <b>${fmt.index(b.high)}</b> L <b>${fmt.index(b.low)}</b> C <b>${fmt.index(b.close)}</b>`;
}

async function loadIndexChart() {
  const idx = state.indices.find((i) => i.symbol === state.idxSymbol);
  $("idxTitle").textContent = idx?.name || state.idxSymbol;
  renderRanges($("idxRanges"), ["1d", "1m", "3m", "6m", "1y"], state.idxRange, (r) => { state.idxRange = r; loadIndexChart(); });
  idxChart ??= new PriceChart($("idxChart"), { compact: true, onCrosshair: showIdxOhlc });
  try {
    const data = await api(`history/${state.idxSymbol}?range=${state.idxRange}`);
    idxChart.setData(data, { isIndex: true, intraday: state.idxRange === "1d" });
    showIdxOhlc();
  } catch (e) {
    $("idxOhlc").innerHTML = `<span class="down">${esc(e.message)}</span>`;
  }
}

function renderIndices() {
  $("idxList").innerHTML = state.indices.map((i) => `
    <div class="qrow ${i.symbol === state.idxSymbol ? "active" : ""}" data-idx="${i.symbol}">
      <div><div class="sym">${esc(i.name)}</div><div class="nm num">${fmt.vol(i.volume)} CP · ${fmt.bn(i.value)} tỷ</div></div>
      ${sparkline(i.spark)}
      <div><div class="px num">${fmt.index(i.price)}</div><div class="chg num ${signClass(i.change)}">${fmt.change(i.change, true)} / ${fmt.pct(i.pct)}</div></div>
    </div>`).join("");
  $("idxList").onclick = (e) => {
    const row = e.target.closest("[data-idx]");
    if (!row) return;
    state.idxSymbol = row.dataset.idx;
    renderIndices();
    loadIndexChart();
  };
}

function renderWatchlist() {
  $("watchlist").innerHTML = state.watch.map((s) => {
    const cls = priceClass(s.price, s.ref, s.ceiling, s.floor);
    return `
    <div class="qrow ${s.symbol === state.symbol ? "active" : ""}" data-sym="${s.symbol}" title="${esc(s.name)}">
      <div><div class="sym"><span class="${cls}">${s.symbol}</span>${cafefLink(s.symbol, s.board, s.name)}</div><div class="nm">${esc(s.shortName || s.name)}</div></div>
      ${sparkline(s.spark)}
      <div><div class="px num ${cls}">${fmt.price(s.price)}</div><div class="chg num ${cls}">${fmt.change(s.change)} / ${fmt.pct(s.pct)}</div></div>
    </div>`;
  }).join("");
  $("watchlist").onclick = (e) => {
    const row = e.target.closest("[data-sym]");
    if (row) goto(row.dataset.sym);
  };
}

// ---------------- Cột phải: tổng quan ngành ----------------
function renderSector() {
  const w = state.watch;
  if (!w.length) return;
  const cap = w.reduce((a, s) => a + (s.marketCap || 0), 0);
  const wPct = w.reduce((a, s) => a + (s.marketCap || 0) * (s.pct || 0), 0) / (cap || 1);
  const value = w.reduce((a, s) => a + (s.value || 0), 0);
  const up = w.filter((s) => s.change > 0).length, down = w.filter((s) => s.change < 0).length, flat = w.length - up - down;
  $("sectorDate").textContent = fmt.date(w[0].tradingDate);
  const sorted = [...w].sort((a, b) => b.pct - a.pct);
  const maxAbs = Math.max(...w.map((s) => Math.abs(s.pct)), 1);
  $("sectorCard").innerHTML = `
    <div class="sector-hero"><span class="big num ${signClass(wPct)}">${fmt.pct(wPct)}</span><span class="muted">bình quân theo vốn hoá</span></div>
    <div class="muted" style="margin-top:2px">Vốn hoá <b style="color:var(--text)">${fmt.bn(cap)}</b> tỷ · GTGD <b style="color:var(--text)">${fmt.bn(value)}</b> tỷ</div>
    <div class="breadth" role="img" aria-label="${up} tăng, ${flat} đứng giá, ${down} giảm">
      <div style="flex:${up};background:var(--up)"></div><div style="flex:${flat};background:var(--ref)"></div><div style="flex:${down};background:var(--down)"></div>
    </div>
    <div class="breadth-lbl"><span class="up">▲ ${up} tăng</span><span class="ref">■ ${flat} đứng</span><span class="down">▼ ${down} giảm</span></div>
    <div class="sub-h">Biến động giá</div>
    ${sorted.map((s) => moverRow(s.symbol, s.pct, maxAbs, fmt.pct(s.pct))).join("")}`;
  $("sectorCard").onclick = moverClick;

  // Làm tròn về 0,1 tỷ trước khi xét dấu để không hiện "+0,0" / "-0,0"
  const net = w.map((s) => ({ symbol: s.symbol, v: Math.round(((s.foreignBuy || 0) - (s.foreignSell || 0)) / 1e8) * 1e8 })).sort((a, b) => b.v - a.v);
  const maxNet = Math.max(...net.map((n) => Math.abs(n.v)), 1);
  const total = net.reduce((a, n) => a + n.v, 0);
  const signed = (v) => (v > 0 ? "+" : "") + fmt.bn(v, 1);
  $("foreignCard").innerHTML = `
    <div class="muted">Tổng ròng ngành: <b class="${signClass(total)}">${signed(total)}</b> tỷ</div>
    <div style="margin-top:6px">${net.map((n) => moverRow(n.symbol, n.v, maxNet, signed(n.v))).join("")}</div>`;
  $("foreignCard").onclick = moverClick;
}

function moverRow(symbol, v, maxAbs, label) {
  const width = (Math.abs(v) / maxAbs) * 50;
  const style = v >= 0 ? `left:50%;width:${width}%;background:var(--up)` : `right:50%;width:${width}%;background:var(--down)`;
  return `<div class="mover" data-sym="${symbol}"><b>${symbol}</b><div class="track"><span class="fn-axis"></span><div style="${style}"></div></div><span class="v num ${signClass(v)}">${label}</span></div>`;
}

function moverClick(e) {
  const row = e.target.closest("[data-sym]");
  if (row) goto(row.dataset.sym);
}

function renderBreadth() {
  const rows = state.indices.filter((i) => i.symbol !== "VN30" && i.up != null);
  $("breadthCard").innerHTML = rows.map((i) => {
    const total = (i.up || 0) + (i.down || 0) + (i.flat || 0) || 1;
    return `<div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between"><b>${esc(i.name)}</b><span class="muted num">${total} mã</span></div>
      <div class="breadth" style="margin:6px 0 4px" role="img" aria-label="${i.up} tăng, ${i.flat} đứng, ${i.down} giảm">
        <div style="flex:${i.up};background:var(--up)"></div><div style="flex:${i.flat};background:var(--ref)"></div><div style="flex:${i.down};background:var(--down)"></div>
      </div>
      <div class="breadth-lbl num"><span class="up">▲ ${i.up} <span class="ceil">(${i.ceiling} trần)</span></span><span class="ref">■ ${i.flat}</span><span class="down">▼ ${i.down} <span class="floor">(${i.floor} sàn)</span></span></div>
    </div>`;
  }).join("");
}

async function loadMarket() {
  try {
    const [indices, watch] = await Promise.all([api("indices"), api("watchlist")]);
    const first = !state.indices.length;
    state.indices = indices;
    state.watch = watch;
    renderIndices();
    renderWatchlist();
    renderSector();
    renderBreadth();
    if (first) loadIndexChart();
    const live = watch.find((s) => s.symbol === state.symbol);
    if (live && state.stock) {
      state.stock.quote = { ...state.stock.quote, ...live };
      renderHead();
    }
  } catch (e) {
    $("watchlist").innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

// ---------------- Dashboard doanh nghiệp ----------------
let priceChart;
function showPriceOhlc(bar) {
  const b = bar || priceChart?.data?.at(-1);
  if (!b) return ($("priceOhlc").innerHTML = "");
  $("priceOhlc").innerHTML = `O ${fmt.price(b.open)} · H ${fmt.price(b.high)} · L ${fmt.price(b.low)} · C <b>${fmt.price(b.close)}</b> · KL ${fmt.vol(b.volume)}`;
}

async function loadPriceChart() {
  renderRanges($("priceRanges"), ["1d", "1m", "3m", "6m", "1y", "3y", "5y"], state.priceRange, (r) => { state.priceRange = r; loadPriceChart(); });
  priceChart ??= new PriceChart($("priceChart"), { ma: true, onCrosshair: showPriceOhlc });
  try {
    const data = await api(`history/${state.symbol}?range=${state.priceRange}`);
    priceChart.setData(data, { intraday: state.priceRange === "1d" });
    showPriceOhlc();
  } catch (e) {
    $("priceOhlc").innerHTML = `<span class="down">${esc(e.message)}</span>`;
  }
}

function renderHead() {
  const { quote: q, profile: p } = state.stock;
  const cls = priceClass(q.price, q.ref, q.ceiling, q.floor);
  if (state.page === "stock") document.title = `${q.symbol} ${fmt.price(q.price)} (${fmt.pct(q.pct)}) · Thép Board`;
  $("stockHead").innerHTML = `
    <div class="sh-id">
      <div class="sh-sym"><h1>${q.symbol}</h1><span class="badge">${BOARD_LABEL[q.board] || q.board}</span>
        <a class="cafef-btn" href="${cafefUrl(q.symbol, q.board, p.name)}" target="_blank" rel="noopener">CafeF ↗</a></div>
      <div class="sh-name">${esc(p.name)}</div>
    </div>
    <div class="sh-price">
      <span class="big ${cls}">${fmt.price(q.price)}</span>
      <span class="chg num ${cls}">${fmt.change(q.change)} (${fmt.pct(q.pct)})</span>
    </div>
    <div class="sh-stats num">
      <div><span>Tham chiếu</span><b class="ref">${fmt.price(q.ref)}</b></div>
      <div><span>Mở cửa</span><b>${fmt.price(q.open)}</b></div>
      <div><span>KL khớp</span><b>${fmt.vol(q.volume)}</b></div>
      <div><span>Ngày</span><b>${fmt.date(q.tradingDate)}</b></div>
      <div><span>Trần</span><b class="ceil">${fmt.price(q.ceiling)}</b></div>
      <div><span>Cao nhất</span><b>${fmt.price(q.high)}</b></div>
      <div><span>GTGD</span><b>${fmt.bn(q.value, 1)} tỷ</b></div>
      <div><span>52 tuần</span><b>${fmt.price(p.low52w)} – ${fmt.price(p.high52w)}</b></div>
      <div><span>Sàn</span><b class="floor">${fmt.price(q.floor)}</b></div>
      <div><span>Thấp nhất</span><b>${fmt.price(q.low)}</b></div>
      <div><span>NN mua</span><b>${fmt.bn(q.foreignBuy, 1)} tỷ</b></div>
      <div><span>NN bán</span><b>${fmt.bn(q.foreignSell, 1)} tỷ</b></div>
    </div>`;
}

function renderKpis() {
  const f = state.stock.fundamentals;
  const med = state.peers?.median || {};
  const medNote = (k, format) => (med[k] != null ? `Trung vị ngành ${format(med[k])}` : "&nbsp;");
  const tiles = [
    ["Vốn hoá (tỷ đồng)", fmt.bn(f.marketCap), medNote("marketCap", (v) => fmt.bn(v))],
    ["P/E", fmt.ratio(f.pe), medNote("pe", fmt.ratio)],
    ["P/B", fmt.ratio(f.pb), medNote("pb", fmt.ratio)],
    ["EPS 4 quý (đồng)", fmt.num(f.eps), medNote("eps", (v) => fmt.num(v))],
    ["ROE", fmt.pct(f.roe, 1, false), medNote("roe", (v) => fmt.pct(v, 1, false))],
    ["ROA", fmt.pct(f.roa, 1, false), medNote("roa", (v) => fmt.pct(v, 1, false))],
    ["Biên lợi nhuận gộp", fmt.pct(f.grossMargin, 1, false), medNote("grossMargin", (v) => fmt.pct(v, 1, false))],
    ["Nợ vay / VCSH", fmt.ratio(f.debtToEquity), medNote("debtToEquity", fmt.ratio)],
  ];
  $("kpis").innerHTML = tiles.map(([l, v, n]) => `<div class="kpi"><div class="lbl">${l}</div><div class="val">${v}</div><div class="note">${n}</div></div>`).join("");
}

async function loadStock() {
  $("stockHead").style.opacity = 0.5;
  try {
    state.stock = await api(`stock/${state.symbol}`);
    renderHead();
    renderKpis();
  } catch (e) {
    $("stockHead").innerHTML = `<div class="err">Không tải được ${state.symbol}: ${esc(e.message)}</div>`;
  }
  $("stockHead").style.opacity = 1;
}

// ---------------- Tabs ----------------
function seg(name, options, active) {
  return `<div class="seg" data-seg="${name}">${options.map(([v, l]) => `<button data-v="${v}" class="${v === active ? "active" : ""}">${l}</button>`).join("")}</div>`;
}

async function renderTab() {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  const body = $("tabBody");
  body.classList.add("loading");
  try {
    await { overview: tabOverview, financials: tabFinancials, peers: tabPeers, profile: tabProfile }[state.tab]();
  } catch (e) {
    body.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
  body.classList.remove("loading");
}

async function tabOverview() {
  const s = await api(`stock/${state.symbol}/series?period=${state.seriesPeriod}`);
  const bn = (arr) => arr.map((v) => (v == null ? null : v / 1e9));
  const pctFmt = (v) => fmt.pct(v, 1, false);
  $("tabBody").innerHTML = `
    <div class="controls">${seg("seriesPeriod", [["quarter", "Theo quý"], ["year", "Theo năm"]], state.seriesPeriod)}
      <span class="note-line">Tỷ đồng · ROE/ROA, P/E, P/B theo TTM${state.seriesPeriod === "year" ? " cuối năm" : ""}</span></div>
    <div class="grid2">
      ${box("cRev", "Doanh thu thuần & LNST công ty mẹ", "Tỷ đồng")}
      ${box("cMargin", "Biên lợi nhuận", "% doanh thu thuần")}
      ${box("cRoe", "ROE & ROA", "%")}
      ${box("cDebt", "Nợ vay / Vốn chủ sở hữu", "Lần")}
      ${box("cPe", "P/E", "Lần")}
      ${box("cPb", "P/B", "Lần")}
    </div>`;
  const c1 = cssVar("--series-1"), c2 = cssVar("--series-2");
  barChart("cRev", s.labels, [
    { label: "Doanh thu thuần", data: bn(s.revenue), color: c1 },
    { label: "LNST cty mẹ", data: bn(s.netProfit), color: c2 },
  ], { yFormat: (v) => fmt.num(v) });
  lineChart("cMargin", s.labels, [
    { label: "Biên LN gộp", data: s.grossMargin, color: c1 },
    { label: "Biên LN ròng", data: s.netMargin, color: c2 },
  ], { yFormat: pctFmt });
  lineChart("cRoe", s.labels, [
    { label: "ROE", data: s.roe, color: c1 },
    { label: "ROA", data: s.roa, color: c2 },
  ], { yFormat: pctFmt });
  barChart("cDebt", s.labels, [{ label: "Nợ vay/VCSH", data: s.debtToEquity, color: c1 }], { yFormat: (v) => fmt.ratio(v), legend: false });
  lineChart("cPe", s.labels, [{ label: "P/E", data: s.pe, color: c1 }], { yFormat: (v) => fmt.ratio(v, 1), legend: false });
  lineChart("cPb", s.labels, [{ label: "P/B", data: s.pb, color: c1 }], { yFormat: (v) => fmt.ratio(v, 2), legend: false });
}

function box(id, title, sub) {
  return `<div class="chart-box"><h4>${title}</h4><div class="sub">${sub}</div><div class="cv"><canvas id="${id}"></canvas></div></div>`;
}

const EPS_FIELDS = new Set(["isa23", "isa24"]);

async function tabFinancials() {
  const d = await api(`stock/${state.symbol}/financials?section=${state.finSection}&period=${state.finPeriod}`);
  $("tabBody").innerHTML = `
    <div class="controls">
      ${seg("finSection", [["income", "Kết quả kinh doanh"], ["balance", "Cân đối kế toán"], ["cashflow", "Lưu chuyển tiền tệ"]], state.finSection)}
      ${seg("finPeriod", [["year", "Năm"], ["quarter", "Quý"]], state.finPeriod)}
      <span class="note-line">Đơn vị: tỷ đồng (EPS: đồng)</span>
    </div>
    <div class="tbl-wrap" style="max-height:620px">
      <table class="tbl">
        <thead><tr><th>Chỉ tiêu</th>${d.periods.map((p) => `<th>${p}</th>`).join("")}</tr></thead>
        <tbody>${d.rows.map((r) => `<tr class="lv${Math.min(r.level, 4)}">
          <td class="title-cell" title="${esc(r.title)}">${esc(r.title)}</td>
          ${r.values.map((v) => `<td class="${v < 0 ? "down" : ""}">${EPS_FIELDS.has(r.field) ? fmt.num(v) : fmt.bn(v, 1)}</td>`).join("")}
        </tr>`).join("")}</tbody>
      </table>
    </div>`;
}

const PEER_COLS = [
  ["price", "Giá", (v) => fmt.price(v)],
  ["pct", "+/- %", (v) => fmt.pct(v), true],
  ["marketCap", "Vốn hoá (tỷ)", (v) => fmt.bn(v)],
  ["pe", "P/E", (v) => fmt.ratio(v)],
  ["pb", "P/B", (v) => fmt.ratio(v)],
  ["eps", "EPS (đ)", (v) => fmt.num(v)],
  ["roe", "ROE %", (v) => fmt.num(v, 1)],
  ["roa", "ROA %", (v) => fmt.num(v, 1)],
  ["grossMargin", "Biên gộp %", (v) => fmt.num(v, 1)],
  ["netMargin", "Biên ròng %", (v) => fmt.num(v, 1)],
  ["debtToEquity", "Nợ vay/VCSH", (v) => fmt.ratio(v)],
  ["revenueGrowth", "Tăng DT %", (v) => fmt.pct(v, 1), true],
  ["netProfitGrowth", "Tăng LN %", (v) => fmt.pct(v, 1), true],
];
const PEER_CHART_METRICS = PEER_COLS.filter(([k]) => !["price", "pct"].includes(k));

const PEER_METRICS = ["marketCap", "pe", "pb", "eps", "roe", "roa", "grossMargin", "netMargin", "debtToEquity", "revenueGrowth", "netProfitGrowth"];

function median(values) {
  const v = values.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// Mỗi mã là một request riêng để Worker xử lý ít dữ liệu mỗi lần (giới hạn CPU của gói miễn phí)
let peersPromise;
async function ensurePeers() {
  peersPromise ??= Promise.all(STEEL.map((s) => api(`fundamentals/${s}`).catch(() => ({ symbol: s }))))
    .then((rows) => {
      state.peers = { rows, median: Object.fromEntries(PEER_METRICS.map((m) => [m, median(rows.map((r) => r[m]))])) };
      return state.peers;
    });
  return peersPromise;
}

async function tabPeers() {
  const peers = await ensurePeers();
  const median = peers.median;
  // Tên và sàn lấy từ watchlist (bảng giá)
  const rows = peers.rows.map((r) => {
    const w = state.watch.find((x) => x.symbol === r.symbol) || {};
    return { ...r, name: w.name, board: w.board };
  });
  const { key, dir } = state.peerSort;
  const sorted = [...rows].sort((a, b) => ((a[key] ?? -Infinity) > (b[key] ?? -Infinity) ? 1 : -1) * dir);
  const cell = (r, [k, , f, signed]) => `<td class="${signed ? signClass(r[k]) : ""}">${f(r[k])}</td>`;
  const metric = PEER_CHART_METRICS.find(([k]) => k === state.peerMetric);
  $("tabBody").innerHTML = `
    <div class="controls">
      <span class="muted">So sánh ${rows.length} mã thép · chỉ số TTM (4 quý gần nhất) · tăng trưởng so với cùng kỳ năm trước</span>
    </div>
    <div class="tbl-wrap">
      <table class="tbl" id="peerTbl">
        <thead><tr><th>Mã</th>${PEER_COLS.map(([k, l]) => `<th class="sortable ${k === key ? "sorted" + (dir > 0 ? " asc" : "") : ""}" data-k="${k}">${l}</th>`).join("")}</tr></thead>
        <tbody>
          ${sorted.map((r) => `<tr class="${r.symbol === state.symbol ? "current" : ""}" data-sym="${r.symbol}">
            <td title="${esc(r.name)} · ${BOARD_LABEL[r.board] || ""}"><div class="peer-sym"><a class="go" href="#/${r.symbol}/peers">${r.symbol}</a>${cafefLink(r.symbol, r.board, r.name)}</div></td>
            ${PEER_COLS.map((c) => cell(r, c)).join("")}</tr>`).join("")}
          <tr class="median"><td>Trung vị ngành</td>${PEER_COLS.map(([k, , f]) => `<td>${median[k] != null ? f(median[k]) : ""}</td>`).join("")}</tr>
        </tbody>
      </table>
    </div>
    <div class="chart-box" style="margin-top:14px">
      <div class="controls" style="margin-bottom:4px">
        <h4 style="margin:0">So sánh chỉ số</h4>
        <select id="peerMetric" aria-label="Chọn chỉ số so sánh">${PEER_CHART_METRICS.map(([k, l]) => `<option value="${k}" ${k === state.peerMetric ? "selected" : ""}>${l}</option>`).join("")}</select>
        <span class="note-line">${state.symbol} được tô màu nhấn · vạch dọc là trung vị ngành</span>
      </div>
      <div class="cv" style="height:320px"><canvas id="cPeer"></canvas></div>
    </div>`;
  const chartRows = rows.filter((r) => r[metric[0]] != null).sort((a, b) => b[metric[0]] - a[metric[0]]);
  peerBarChart("cPeer", chartRows.map((r) => r.symbol), chartRows.map((r) => r[metric[0]]),
    chartRows.findIndex((r) => r.symbol === state.symbol), metric[2], median[metric[0]]);

  $("peerTbl").querySelector("thead").onclick = (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    state.peerSort = { key: k, dir: state.peerSort.key === k ? -state.peerSort.dir : -1 };
    tabPeers();
  };
  $("peerTbl").querySelector("tbody").onclick = (e) => {
    if (e.target.closest("a")) return;
    const row = e.target.closest("[data-sym]");
    if (row) goto(row.dataset.sym, "peers");
  };
  $("peerMetric").onchange = (e) => { state.peerMetric = e.target.value; tabPeers(); };
}

async function tabProfile() {
  const { profile: p, shareholders: sh, quote: q } = state.stock;
  const maxPct = Math.max(...sh.map((h) => h.pct || 0), 1);
  const rating = { BUY: "Mua", SELL: "Bán", HOLD: "Nắm giữ", OUTPERFORM: "Khả quan", UNDERPERFORM: "Kém khả quan" }[p.rating] || p.rating;
  $("tabBody").innerHTML = `
    <div class="facts">
      <div><span>Tên tiếng Anh</span><b>${esc(p.enName)}</b></div>
      <div><span>Ngành (ICB ${esc(p.icbCode)})</span><b>Sắt thép · ${esc(p.sector)}</b></div>
      <div><span>Sàn niêm yết</span><b>${BOARD_LABEL[q.board] || q.board} · từ ${fmt.date(p.listingDate)}</b></div>
      <div><span>Cổ phiếu lưu hành</span><b class="num">${fmt.num(p.issueShare)}</b></div>
      <div><span>Free float</span><b>${fmt.pct(p.freeFloatPct, 1, false)}</b></div>
      <div><span>Sở hữu nước ngoài / Nhà nước</span><b>${fmt.pct(p.foreignPct, 1, false)} / ${fmt.pct(p.statePct, 1, false)}</b></div>
      <div><span>KLGD bình quân 1 tháng</span><b class="num">${fmt.vol(p.avgVolume1m)}</b></div>
      ${p.rating ? `<div><span>Khuyến nghị Vietcap (${esc(p.ratingAsOf)})</span><b>${esc(rating)} · giá mục tiêu ${fmt.price(p.targetPrice)}</b></div>` : ""}
      <div><span>Trang công ty trên CafeF</span><b><a class="cafef-btn" href="${cafefUrl(q.symbol, q.board, p.name)}" target="_blank" rel="noopener">Mở CafeF ↗</a></b></div>
    </div>
    <h4 style="margin:0 0 6px">Giới thiệu</h4>
    <p class="profile-text">${esc(htmlToText(p.profileHtml)) || "Chưa có thông tin."}</p>
    <h4 style="margin:0 0 4px">Cổ đông lớn</h4>
    ${sh.map((h) => `<div class="holder"><span class="nm" title="${esc(h.name)}">${esc(h.name)}</span>
      <div class="track"><div class="fill" style="width:${((h.pct || 0) / maxPct) * 100}%"></div></div>
      <b class="num" style="text-align:right">${fmt.pct(h.pct, 2, false)}</b></div>`).join("") || '<div class="muted">Chưa có dữ liệu</div>'}`;
}

// ---------------- Search ----------------
function setupSearch() {
  const input = $("searchInput"), box = $("searchResults");
  const norm = (s) => slugify(s).replace(/-/g, " ");
  let hl = 0, matches = [];
  const render = () => {
    const q = norm(input.value);
    matches = state.watch.filter((s) => !q || s.symbol.toLowerCase().includes(q) || norm(s.name).includes(q) || norm(s.shortName).includes(q));
    hl = Math.min(hl, Math.max(matches.length - 1, 0));
    box.innerHTML = matches.map((s, i) => `<a href="#/${s.symbol}" class="${i === hl ? "hl" : ""}"><b>${s.symbol}</b><span class="muted">${esc(s.name)}</span></a>`).join("")
      || '<div class="skeleton">Chỉ theo dõi 10 mã ngành thép</div>';
    box.classList.add("open");
  };
  input.addEventListener("input", () => { hl = 0; render(); });
  input.addEventListener("focus", render);
  input.addEventListener("blur", () => setTimeout(() => box.classList.remove("open"), 150));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { hl = Math.min(hl + 1, matches.length - 1); render(); e.preventDefault(); }
    if (e.key === "ArrowUp") { hl = Math.max(hl - 1, 0); render(); e.preventDefault(); }
    if (e.key === "Enter" && matches[hl]) { goto(matches[hl].symbol); input.value = ""; input.blur(); }
    if (e.key === "Escape") input.blur();
  });
  box.addEventListener("mousedown", (e) => { const a = e.target.closest("a"); if (a) { input.value = ""; } });
}

// ---------------- Theme ----------------
function setupTheme() {
  const btn = $("themeBtn");
  const paint = () => (btn.textContent = document.documentElement.dataset.theme === "light" ? "☾" : "☀");
  paint();
  btn.onclick = () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (e) {}
    paint();
    priceChart?.applyTheme();
    idxChart?.applyTheme();
    cmApplyTheme();
    if (state.stock) renderTab();
  };
}

// ---------------- Router ----------------
const PAGES = { "hang-hoa": "commodities", "vi-mo": "macro" };
const PAGE_EL = { stock: "pageStock", commodities: "pageCommodities", macro: "pageMacro" };
const PAGE_TITLE = { commodities: "Hàng hóa ngành thép · Thép Board", macro: "Vĩ mô & Tỷ giá · Thép Board" };

function showPage(page) {
  state.page = page;
  Object.entries(PAGE_EL).forEach(([p, id]) => ($(id).hidden = p !== page));
  document.querySelector(".layout").classList.toggle("wide", page !== "stock");
  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.page === page));
  document.querySelector('.nav a[data-page="stock"]').href = `#/${state.symbol}`;
  if (PAGE_TITLE[page]) document.title = PAGE_TITLE[page];
}

async function route() {
  const [, first, tab] = location.hash.match(/^#\/([\w-]+)(?:\/([\w-]+))?/) || [];
  const page = PAGES[first] || "stock";
  showPage(page);
  if (page === "commodities") return loadCommodities(tab === "nang-luong" ? "energy" : "steel");
  if (page !== "stock") return;
  const sym = first;
  const symbol = STEEL.includes(sym?.toUpperCase()) ? sym.toUpperCase() : state.symbol;
  const newTab = TABS.includes(tab) ? tab : "overview";
  const symbolChanged = symbol !== state.symbol || !state.stock;
  state.symbol = symbol;
  state.tab = newTab;
  document.querySelector('.nav a[data-page="stock"]').href = `#/${symbol}`;
  if (state.watch.length) renderWatchlist();
  if (symbolChanged) {
    loadPriceChart();
    await loadStock();
  } else {
    renderHead(); // khôi phục document.title khi quay lại từ trang khác
  }
  renderTab();
}

function setupEvents() {
  $("tabs").onclick = (e) => { const t = e.target.dataset.tab; if (t) goto(state.symbol, t); };
  $("tabBody").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg button");
    if (!btn) return;
    state[btn.parentElement.dataset.seg] = btn.dataset.v;
    renderTab();
  });
  window.addEventListener("hashchange", route);
}

async function init() {
  setupTheme();
  setupSearch();
  setupEvents();
  ensurePeers().then(() => state.stock && renderKpis()).catch(() => {});
  await Promise.all([loadMarket(), route()]);
  setInterval(loadMarket, REFRESH_MS);
}

init();
