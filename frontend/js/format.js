// Định dạng số kiểu VN và các helper hiển thị dùng chung.
const nf = (d) => new Intl.NumberFormat("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
const NF = [0, 1, 2].map(nf);

const fmt = {
  num(v, d = 0) { return v == null || !isFinite(v) ? "–" : NF[d].format(v); },
  // Giá cổ phiếu: API trả VND, hiển thị nghìn đồng
  price(v) { return v == null ? "–" : NF[2].format(v / 1000); },
  index(v) { return v == null ? "–" : NF[2].format(v); },
  pct(v, d = 2, sign = true) {
    if (v == null || !isFinite(v)) return "–";
    return (sign && v > 0 ? "+" : "") + NF[d].format(v) + "%";
  },
  change(v, isIndex) {
    if (v == null) return "–";
    const s = isIndex ? NF[2].format(v) : NF[2].format(v / 1000);
    return (v > 0 ? "+" : "") + s;
  },
  // Tiền VND -> tỷ đồng
  bn(v, d = 0) { return v == null || !isFinite(v) ? "–" : NF[d].format(v / 1e9); },
  vol(v) {
    if (v == null) return "–";
    if (v >= 1e9) return NF[2].format(v / 1e9) + " tỷ";
    if (v >= 1e6) return NF[2].format(v / 1e6) + " tr";
    if (v >= 1e3) return NF[1].format(v / 1e3) + " N";
    return NF[0].format(v);
  },
  ratio(v, d = 2) { return v == null || !isFinite(v) ? "–" : NF[d].format(v); },
  date(s) {
    if (!s) return "–";
    const d = new Date(s);
    return isNaN(d) ? s : d.toLocaleDateString("vi-VN");
  },
};

// Màu giá theo quy ước sàn VN: trần tím, sàn xanh lam, tham chiếu vàng, tăng xanh lá, giảm đỏ
function priceClass(price, ref, ceiling, floor) {
  if (price == null || ref == null) return "";
  if (ceiling && price >= ceiling) return "ceil";
  if (floor && price <= floor) return "floor";
  if (price > ref) return "up";
  if (price < ref) return "down";
  return "ref";
}
const signClass = (v) => (v > 0 ? "up" : v < 0 ? "down" : "ref");

const BOARD_CAFEF = { HSX: "hose", HOSE: "hose", HNX: "hnx", UPCOM: "upcom" };
const BOARD_LABEL = { HSX: "HOSE", HNX: "HNX", UPCOM: "UPCOM" };

function slugify(s) {
  return (s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Link trang công ty trên CafeF. CafeF chỉ đọc phần mã trước dấu "-" đầu tiên,
// nhưng URL bắt buộc phải có slug (thiếu slug -> 404), nên fallback là "{ma}-{ma}".
function cafefUrl(symbol, board, companyName) {
  const ma = symbol.toLowerCase();
  const san = BOARD_CAFEF[board] || "hose";
  const slug = slugify(companyName) || ma;
  return `https://cafef.vn/du-lieu/${san}/${ma}-${slug}.chn`;
}

function cafefLink(symbol, board, name, cls = "ext") {
  return `<a class="${cls}" href="${cafefUrl(symbol, board, name)}" target="_blank" rel="noopener"
    title="Xem ${symbol} trên CafeF" aria-label="Xem ${symbol} trên CafeF" onclick="event.stopPropagation()">↗</a>`;
}

function sparkline(values, w = 64, h = 24) {
  if (!values || values.length < 2) return `<svg class="spark" width="${w}" height="${h}"></svg>`;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (w - 2) + 1).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`);
  const color = values.at(-1) >= values[0] ? "var(--up)" : "var(--down)";
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Hồ sơ công ty từ API là HTML; chỉ lấy text để tránh chèn markup lạ
function htmlToText(html) {
  return new DOMParser().parseFromString(html || "", "text/html").body.textContent.replace(/\s+/g, " ").trim();
}

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
