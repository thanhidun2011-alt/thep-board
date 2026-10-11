// Trang "Hàng hóa": chia 2 nhóm (ngành thép; năng lượng & nông sản), mỗi nhóm tối đa 8 mặt hàng
// để biểu đồ so sánh không vượt quá 8 màu phân loại.
const CM_GROUPS = {
  steel: {
    desc: "Nguyên liệu đầu vào (quặng sắt, than, phế liệu) và thành phẩm (HRC, thép cây) · giá hợp đồng tương lai, đóng cửa theo ngày",
    first: "iron-ore-dce",
  },
  energy: {
    desc: "Dầu thô, khí tự nhiên, đường và cao su · giá hợp đồng tương lai, đóng cửa theo ngày",
    first: "brent",
  },
};

const CM = {
  meta: [], // danh sách mặt hàng (tên, sàn, đơn vị, nhóm) từ /api/commodities
  details: {}, // id -> tóm tắt + nến theo cmpRange, từ /api/commodities/{id}
  list: [], // meta gộp với details, theo đúng thứ tự meta
  seen: new Set(),
  group: "steel",
  selected: "iron-ore-dce",
  range: "1y",
  cmpRange: "1y",
  hidden: null, // Set id bị tắt trên biểu đồ so sánh; mặc định tắt các nguồn đã ngừng cập nhật
  chart: null,
  cmp: null,
  cmpSeries: new Map(),
};

const cmItems = () => CM.list.filter((c) => c.category === CM.group);
// Màu đi theo vị trí cố định của mặt hàng trong nhóm, không đổi khi bật/tắt series
const cmSlot = (id) => {
  const c = CM.list.find((x) => x.id === id);
  return CM.list.filter((x) => x.category === c?.category).findIndex((x) => x.id === id) + 1;
};
const cmColor = (id) => cssVar(`--cat-${cmSlot(id)}`);
const fmtCm = (v) => (v == null ? "–" : fmt.num(v, v >= 1000 ? 0 : 2));
const unixDate = (t) => (t ? new Date(t * 1000).toLocaleDateString("vi-VN", { timeZone: "UTC" }) : "–");

const CM_HASH = { steel: "#/hang-hoa", energy: "#/hang-hoa/nang-luong" };

async function loadCommodities(group = "steel") {
  if (group !== CM.group) {
    CM.group = group;
    CM.selected = CM_GROUPS[group].first;
  }
  if (!CM.meta.length) {
    try {
      CM.meta = await api("commodities");
    } catch (e) {
      $("cmGrid").innerHTML = `<div class="card err">Không tải được giá hàng hóa: ${esc(e.message)}</div>`;
      return;
    }
    CM.list = CM.meta;
    CM.hidden = new Set();
    $("cmGroups").onclick = (e) => {
      const g = e.target.dataset.g;
      if (g && g !== CM.group) location.hash = CM_HASH[g];
    };
  }
  document.querySelectorAll("#cmGroups button").forEach((b) => b.classList.toggle("active", b.dataset.g === CM.group));
  $("cmDesc").textContent = CM_GROUPS[CM.group].desc;
  await loadCmCompare();
  loadCmChart(); // chạy sau để dùng lại nến vừa tải nếu cùng khung thời gian
}

// Tải tóm tắt + nến (theo khung của biểu đồ so sánh) cho các mặt hàng trong nhóm đang xem
async function loadCmDetails() {
  const group = CM.group, range = CM.cmpRange;
  const items = CM.meta.filter((m) => m.category === group);
  const results = await Promise.all(items.map((m) =>
    api(`commodities/${m.id}?range=${range}`).catch((e) => ({ ...m, error: e.message, history: [] }))));
  if (group !== CM.group || range !== CM.cmpRange) return false; // người dùng đã đổi nhóm/khung trong lúc chờ
  results.forEach((d) => {
    CM.details[d.id] = d;
    // Lần đầu thấy một nguồn đã ngừng cập nhật thì mặc định tắt nó trên biểu đồ so sánh
    if (!CM.seen.has(d.id) && (d.stale || d.error)) CM.hidden.add(d.id);
    CM.seen.add(d.id);
  });
  CM.list = CM.meta.map((m) => CM.details[m.id] || m);
  return true;
}

function renderCmGrid() {
  $("cmGrid").innerHTML = cmItems().map((c) => {
    const dot = `<span class="dot" style="background:var(--cat-${cmSlot(c.id)})"></span>`;
    if (c.error) {
      return `<div class="cm-card"><div class="top">${dot}<span class="nm">${esc(c.name)}</span></div>
        <div class="mk">${esc(c.market)}</div><div class="err" style="padding:0">Lỗi nguồn: ${esc(c.error)}</div></div>`;
    }
    return `<button class="cm-card ${c.id === CM.selected ? "active" : ""}" data-cm="${c.id}">
      <div class="top">${dot}<span class="nm" title="${esc(c.name)}">${esc(c.name)}</span></div>
      <div class="mk">${esc(c.market)}${c.stale ? ` · <span class="stale-badge" title="Nguồn ngừng cập nhật">Dữ liệu cũ</span>` : ""}</div>
      <div class="px-row"><span class="px">${fmtCm(c.price)}</span><span class="unit">${esc(c.unit)}</span></div>
      <div class="foot">
        <div><div class="num ${signClass(c.pct)}">${fmt.pct(c.pct)} <span>phiên</span></div>
          <div class="num"><span>1T</span> <b class="${signClass(c.m1)}">${fmt.pct(c.m1, 1)}</b> · <span>1N</span> <b class="${signClass(c.y1)}">${fmt.pct(c.y1, 1)}</b></div></div>
        ${sparkline(c.spark, 76, 30)}
      </div>
      <div class="mk">Ngày ${unixDate(c.date)}</div>
    </button>`;
  }).join("");
  $("cmGrid").onclick = (e) => {
    const card = e.target.closest("[data-cm]");
    if (!card) return;
    CM.selected = card.dataset.cm;
    renderCmGrid();
    loadCmChart();
  };
}

function showCmOhlc(bar) {
  const b = bar || CM.chart?.data?.at(-1);
  $("cmOhlc").innerHTML = b ? `${unixDate(b.time)} · O ${fmtCm(b.open)} · H ${fmtCm(b.high)} · L ${fmtCm(b.low)} · C <b>${fmtCm(b.close)}</b>` : "";
}

async function loadCmChart() {
  const c = CM.list.find((x) => x.id === CM.selected);
  if (!c) return;
  $("cmTitle").textContent = `${c.name} · ${c.market}`;
  $("cmSub").textContent = `${c.unit} · ${c.provider} (${c.ticker})`;
  renderRanges($("cmRanges"), ["1m", "3m", "6m", "1y", "3y", "5y"], CM.range, (r) => { CM.range = r; loadCmChart(); });
  CM.chart ??= new PriceChart($("cmChart"), { onCrosshair: showCmOhlc });
  try {
    // Cùng khung với biểu đồ so sánh thì dùng lại nến đã tải
    const cachedHist = CM.range === CM.cmpRange ? CM.details[c.id]?.history : null;
    const data = cachedHist || (await api(`commodities/${c.id}?range=${CM.range}`)).history;
    CM.chart.setData(data, { isIndex: true });
    showCmOhlc();
  } catch (e) {
    $("cmOhlc").innerHTML = `<span class="down">${esc(e.message)}</span>`;
  }
}

async function loadCmCompare() {
  renderRanges($("cmCmpRanges"), ["1m", "3m", "6m", "1y", "3y", "5y"], CM.cmpRange, (r) => { CM.cmpRange = r; loadCmCompare(); });
  if (!CM.cmp) {
    CM.cmp = LightweightCharts.createChart($("cmCmpChart"), {
      autoSize: true,
      layout: { background: { type: "solid", color: "transparent" }, fontFamily: "system-ui, Segoe UI, sans-serif", fontSize: 11 },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      localization: { priceFormatter: (p) => fmt.num(p, 1) },
    });
  }
  applyCmpTheme();
  if (!(await loadCmDetails())) return;
  renderCmGrid();
  renderCmTable();
  renderCmNote();
  const items = cmItems().filter((c) => !c.error);
  const datas = items.map((c) => c.history || []);
  // Xoá series của nhóm khác để trục thời gian chỉ theo nhóm đang xem
  CM.cmpSeries.forEach((s, id) => {
    if (!items.some((c) => c.id === id)) { CM.cmp.removeSeries(s); CM.cmpSeries.delete(id); }
  });
  items.forEach((c, i) => {
    const d = datas[i];
    let s = CM.cmpSeries.get(c.id);
    if (!s) {
      s = CM.cmp.addLineSeries({ lineWidth: 2, priceLineVisible: false });
      CM.cmpSeries.set(c.id, s);
    }
    const base = d[0]?.close;
    s.setData(base ? d.map((x) => ({ time: x.time, value: (x.close / base) * 100 })) : []);
    s.applyOptions({ color: cmColor(c.id), visible: !CM.hidden.has(c.id) });
  });
  CM.cmp.timeScale().fitContent();
  renderCmLegend();
}

function applyCmpTheme() {
  CM.cmp?.applyOptions({
    layout: { textColor: cssVar("--muted") },
    grid: { vertLines: { color: cssVar("--grid") }, horzLines: { color: cssVar("--grid") } },
  });
  CM.cmpSeries.forEach((s, id) => s.applyOptions({ color: cmColor(id) }));
}

function renderCmLegend() {
  $("cmLegend").innerHTML = cmItems().filter((c) => !c.error).map((c) => `
    <button class="${CM.hidden.has(c.id) ? "off" : ""}" data-cm="${c.id}" aria-pressed="${!CM.hidden.has(c.id)}" title="Bật/tắt trên biểu đồ">
      <i style="background:${cmColor(c.id)}"></i>${esc(c.name)} <span class="muted">${esc(c.market.split(" ")[0])}</span>${c.stale ? " ⚠" : ""}
    </button>`).join("");
  $("cmLegend").onclick = (e) => {
    const b = e.target.closest("[data-cm]");
    if (!b) return;
    const id = b.dataset.cm;
    CM.hidden.has(id) ? CM.hidden.delete(id) : CM.hidden.add(id);
    CM.cmpSeries.get(id)?.applyOptions({ visible: !CM.hidden.has(id) });
    renderCmLegend();
  };
}

function renderCmTable() {
  const cols = [["pct", "Phiên"], ["w1", "1 tuần"], ["m1", "1 tháng"], ["m3", "3 tháng"], ["ytd", "Từ đầu năm"], ["y1", "1 năm"]];
  $("cmTable").innerHTML = `<table class="tbl">
    <thead><tr><th>Mặt hàng</th><th>Thị trường</th><th>Giá</th><th>Đơn vị</th><th>Ngày</th>${cols.map(([, l]) => `<th>${l}</th>`).join("")}<th>Thấp – Cao 52 tuần</th></tr></thead>
    <tbody>${cmItems().map((c) => `<tr>
      <td>${esc(c.name)}${c.stale ? ' <span class="stale-badge">Dữ liệu cũ</span>' : ""}</td>
      <td style="text-align:left" class="muted">${esc(c.market)}</td>
      <td><b>${fmtCm(c.price)}</b></td><td class="muted" style="text-align:left">${esc(c.unit)}</td><td>${unixDate(c.date)}</td>
      ${cols.map(([k]) => `<td class="${signClass(c[k])}">${fmt.pct(c[k], k === "pct" ? 2 : 1)}</td>`).join("")}
      <td>${fmtCm(c.low52w)} – ${fmtCm(c.high52w)}</td></tr>`).join("")}</tbody></table>`;
}

function renderCmNote() {
  const stale = cmItems().filter((c) => c.stale);
  const common = `<b>Nguồn dữ liệu:</b> hợp đồng tương lai liên tục trên các sàn Trung Quốc (qua Sina Finance) và sàn Mỹ/châu Âu (qua Yahoo Finance), giá đóng cửa theo ngày, có thể trễ.`;
  const perGroup = CM.group === "steel"
    ? `Giá sàn Trung Quốc tính bằng CNY/tấn, giá sàn Mỹ tính bằng USD (tấn ngắn = 907 kg, tấn dài = 1.016 kg).<br>
       <b>Phôi thép:</b> chưa có nguồn dữ liệu miễn phí nào (giá phôi Đường Sơn/Đông Nam Á nằm trên Mysteel, SteelOrbis… đều cần trả phí). Có thể tham khảo giá thép cây SHFE vì diễn biến của nó bám sát giá phôi.`
    : `Dầu tính bằng USD hoặc CNY/thùng (159 lít). Khí tự nhiên tính bằng USD/MMBtu. Đường số 11 tính bằng US cent/pound (1 pound = 0,454 kg).<br>
       <b>Cao su:</b> RSS3 là cao su tấm xông khói (sàn SHFE), TSR20 là cao su khối kỹ thuật (sàn INE), loại được xuất khẩu nhiều từ Việt Nam và Đông Nam Á.`;
  $("cmNote").innerHTML = `${common} ${perGroup}
    ${stale.length ? `<br><b>Lưu ý:</b> ${stale.map((c) => `${esc(c.name)} (${esc(c.ticker)})`).join(", ")} đã ngừng cập nhật trên nguồn miễn phí từ ${unixDate(stale[0].date)}, nên mặc định bị tắt trên biểu đồ so sánh.` : ""}`;
}

function cmApplyTheme() {
  if (!CM.list.length) return;
  CM.chart?.applyTheme();
  applyCmpTheme();
  renderCmGrid();
  renderCmLegend();
}
