// Biểu đồ giá (TradingView lightweight-charts) và biểu đồ tài chính (Chart.js).
const VN_OFFSET = 7 * 3600; // lightweight-charts hiển thị theo UTC; dời sang giờ VN cho nến trong ngày

function sma(candles, n) {
  const out = [];
  let sum = 0;
  candles.forEach((c, i) => {
    sum += c.close;
    if (i >= n) sum -= candles[i - n].close;
    if (i >= n - 1) out.push({ time: c.time, value: sum / n });
  });
  return out;
}

class PriceChart {
  constructor(el, { ma = false, compact = false, onCrosshair } = {}) {
    this.el = el;
    this.compact = compact;
    this.chart = LightweightCharts.createChart(el, {
      autoSize: true,
      layout: { background: { type: "solid", color: "transparent" }, fontFamily: "system-ui, Segoe UI, sans-serif", fontSize: compact ? 10 : 11 },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderVisible: false, rightOffset: 2, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      handleScroll: !compact, handleScale: !compact,
    });
    this.candles = this.chart.addCandlestickSeries({ borderVisible: false, priceLineVisible: true });
    this.volume = this.chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    this.chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
    if (ma) {
      this.ma20 = this.chart.addLineSeries({ lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      this.ma50 = this.chart.addLineSeries({ lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    }
    if (onCrosshair) {
      this.chart.subscribeCrosshairMove((p) => {
        const bar = p.time ? p.seriesData.get(this.candles) : null;
        const vol = p.time ? p.seriesData.get(this.volume) : null;
        onCrosshair(bar ? { ...bar, volume: vol?.value } : null);
      });
    }
    this.applyTheme();
  }

  applyTheme() {
    const up = cssVar("--up"), down = cssVar("--down");
    this.colors = { up, down };
    this.chart.applyOptions({
      layout: { textColor: cssVar("--muted") },
      grid: { vertLines: { color: cssVar("--grid") }, horzLines: { color: cssVar("--grid") } },
      crosshair: { vertLine: { labelBackgroundColor: cssVar("--surface-2") }, horzLine: { labelBackgroundColor: cssVar("--surface-2") } },
    });
    this.candles.applyOptions({ upColor: up, downColor: down, wickUpColor: up, wickDownColor: down });
    this.ma20?.applyOptions({ color: cssVar("--series-1") });
    this.ma50?.applyOptions({ color: cssVar("--series-2") });
    if (this.data) this.setData(this.data, this.opts);
  }

  setData(data, opts = {}) {
    this.data = data;
    this.opts = opts;
    const shift = opts.intraday ? VN_OFFSET : 0;
    const candles = data.map((c) => ({ ...c, time: c.time + shift }));
    const formatter = opts.isIndex ? (p) => fmt.index(p) : (p) => fmt.price(p);
    this.candles.applyOptions({ priceFormat: { type: "custom", formatter, minMove: opts.isIndex ? 0.01 : 10 } });
    this.candles.setData(candles);
    const { up, down } = this.colors;
    this.volume.setData(candles.map((c) => ({
      time: c.time, value: c.volume,
      color: (c.close >= c.open ? up : down) + "66",
    })));
    if (this.ma20) {
      this.ma20.setData(opts.intraday ? [] : sma(candles, 20));
      this.ma50.setData(opts.intraday ? [] : sma(candles, 50));
    }
    this.chart.timeScale().applyOptions({ timeVisible: !!opts.intraday, secondsVisible: false });
    this.chart.timeScale().fitContent();
  }
}

// ---------- Chart.js ----------
const charts = new Map(); // canvas id -> Chart, để huỷ khi vẽ lại

function chartDefaults() {
  const muted = cssVar("--muted"), grid = cssVar("--grid");
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "top", align: "start", labels: { color: cssVar("--text-2"), boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2, font: { size: 11.5 } } },
      tooltip: {
        backgroundColor: cssVar("--surface-2"), titleColor: cssVar("--text"), bodyColor: cssVar("--text-2"),
        borderColor: cssVar("--border"), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: grid }, ticks: { color: muted, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 8 } },
      y: { grid: { color: grid }, border: { display: false }, ticks: { color: muted, font: { size: 11 } } },
    },
  };
}

function drawChart(canvasId, config) {
  charts.get(canvasId)?.destroy();
  const el = document.getElementById(canvasId);
  if (!el) return;
  charts.set(canvasId, new Chart(el, config));
}

// Biểu đồ cột nhiều chuỗi cùng đơn vị (ví dụ doanh thu & LNST, tỷ đồng)
function barChart(canvasId, labels, series, { yFormat = (v) => fmt.num(v), legend = true } = {}) {
  const base = chartDefaults();
  base.plugins.legend.display = legend;
  base.plugins.tooltip.callbacks = { label: (c) => ` ${c.dataset.label}: ${yFormat(c.parsed.y ?? c.parsed.x)}` };
  base.scales.y.ticks.callback = (v) => yFormat(v);
  base.scales.y.beginAtZero = true; // cột luôn tính từ 0
  drawChart(canvasId, {
    type: "bar",
    data: {
      labels,
      datasets: series.map((s) => ({
        label: s.label, data: s.data, backgroundColor: s.color, borderRadius: 4, borderSkipped: "start",
        maxBarThickness: 26, categoryPercentage: 0.7, barPercentage: 0.9,
      })),
    },
    options: base,
  });
}

function lineChart(canvasId, labels, series, { yFormat = (v) => fmt.num(v, 1), legend = true } = {}) {
  const base = chartDefaults();
  base.plugins.legend.display = legend;
  base.plugins.tooltip.callbacks = { label: (c) => ` ${c.dataset.label}: ${yFormat(c.parsed.y)}` };
  base.scales.y.ticks.callback = (v) => yFormat(v);
  drawChart(canvasId, {
    type: "line",
    data: {
      labels,
      datasets: series.map((s) => ({
        label: s.label, data: s.data, borderColor: s.color, backgroundColor: s.color,
        borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 2,
        pointHoverBorderColor: cssVar("--surface"), tension: 0.25, spanGaps: true,
      })),
    },
    options: base,
  });
}

// Thanh ngang so sánh 1 chỉ số giữa các mã; mã đang xem được tô màu nhấn, còn lại xám
function peerBarChart(canvasId, labels, values, highlightIndex, yFormat, medianValue) {
  const base = chartDefaults();
  base.indexAxis = "y";
  base.interaction = { mode: "nearest", axis: "y", intersect: false };
  base.plugins.legend.display = false;
  base.plugins.tooltip.callbacks = { label: (c) => ` ${yFormat(c.parsed.x)}` };
  base.scales.x.grid = { color: cssVar("--grid") };
  base.scales.x.ticks.callback = (v) => yFormat(v);
  base.scales.x.beginAtZero = true;
  base.scales.y.grid = { display: false };
  base.layout = { padding: { top: 18 } };
  const accent = cssVar("--series-1"), rest = cssVar("--muted") + "88";
  const medianLine = {
    id: "medianLine",
    afterDatasetsDraw(chart) {
      if (medianValue == null) return;
      const x = chart.scales.x.getPixelForValue(medianValue), { top, bottom } = chart.chartArea, ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = cssVar("--text-2"); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, top - 2); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.fillStyle = cssVar("--text-2"); ctx.font = "11px system-ui"; ctx.textAlign = "left";
      ctx.fillText("Trung vị " + yFormat(medianValue), x + 4, top - 6);
      ctx.restore();
    },
  };
  drawChart(canvasId, {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: values.map((_, i) => (i === highlightIndex ? accent : rest)), borderRadius: 4, borderSkipped: "start", maxBarThickness: 18 }] },
    options: base,
    plugins: [medianLine],
  });
}
