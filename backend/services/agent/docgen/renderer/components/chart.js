/**
 * Chart block — inline SVG, no runtime library, no CDN.
 *
 * Print has no hover layer, so the interaction tier of the dataviz method is
 * replaced by its documented fallback: direct labels carry the values a tooltip
 * would have. That is also the relief the light palette's sub-3:1 contrast WARN
 * requires, so labels here are not optional decoration — they are the reason the
 * palette is allowed to ship.
 *
 * Mark specs are fixed: bars cap at 24px with a 4px rounded data-end square at
 * the baseline, lines are 2px with round joins, markers are 8px with a 2px
 * surface ring, gridlines are recessive hairlines, and a 2px surface gap does the
 * separating between touching marks. Never a second y-axis.
 */

import { chartPalette, foldSeries, inkOn, ADJACENT_SERIES_CAP } from "../../design/palette.js";
import { escHtml } from "../utils.js";

// ─── Geometry ─────────────────────────────────────────────────────────────────

const W = 720;
const H = 360;
const PAD = { top: 20, right: 24, bottom: 52, left: 60 };
const BAR_MAX = 24;   // never fill the slot — the leftover band is air
const GAP     = 2;    // the surface gap, one consistent width everywhere

// ─── Value helpers ────────────────────────────────────────────────────────────

/**
 * Round an axis maximum up to a clean number and return its ticks.
 *
 * Five ticks rather than four: with four, a peak of 4.1 rounds the axis to 6 and
 * the tallest bar only reaches two-thirds of the plot, which reads as a chart
 * that forgot to fill itself.
 */
function niceScale(max, tickCount = 5) {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] };
  const raw  = max / tickCount;
  const mag  = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const top  = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
  return { max: top, ticks };
}

/** Compact a number the way a stat tile would: 1,284 / 12.9K / 4.2M. */
function fmt(n, unit = "") {
  const abs = Math.abs(n);
  let s;
  if (abs >= 1e9)      s = `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  else if (abs >= 1e6) s = `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  else if (abs >= 1e4) s = `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  else if (Number.isInteger(n)) s = n.toLocaleString("en-US");
  else s = String(Number(n.toFixed(2)));
  return unit === "$" ? `$${s}` : `${s}${unit}`;
}

/** Rough text width at a given px size — enough to decide if a label fits. */
const textWidth = (str, size) => String(str).length * size * 0.56;

// ─── Shared chrome ────────────────────────────────────────────────────────────

function legend(series, p, y) {
  // One series needs no legend — the title already names what is plotted.
  if (series.length < 2) return "";
  let x = PAD.left;
  return `<g class="ct-legend" transform="translate(0,${y})">${series.map((s, i) => {
    const item = `
      <g transform="translate(${x},0)">
        <rect x="0" y="-7" width="9" height="9" rx="2" fill="${p.series[i]}"/>
        <text x="15" y="0" fill="${p.inkMuted}" font-size="12">${escHtml(s.name)}</text>
      </g>`;
    x += 15 + textWidth(s.name, 12) + 22;
    return item;
  }).join("")}</g>`;
}

function gridAndAxis(ticks, scale, p, plotW, unit) {
  return ticks.map((t) => {
    const y = scale(t);
    return `
    <line x1="${PAD.left}" y1="${y}" x2="${PAD.left + plotW}" y2="${y}"
          stroke="${p.grid}" stroke-width="1"/>
    <text x="${PAD.left - 10}" y="${y + 4}" text-anchor="end"
          fill="${p.axisLabel}" font-size="11" style="font-variant-numeric:tabular-nums">${fmt(t, unit)}</text>`;
  }).join("");
}

// ─── Column (vertical bars) ───────────────────────────────────────────────────

function columnChart(b, p) {
  const series = foldSeries(b.series, ADJACENT_SERIES_CAP);
  const cats   = b.categories;
  const unit   = b.unit ?? "";
  const hasLegend = series.length >= 2;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom - (hasLegend ? 24 : 0);
  const baseY = PAD.top + plotH;

  const peak = Math.max(...series.flatMap((s) => s.values), 0);
  const { max, ticks } = niceScale(peak);
  const scale = (v) => baseY - (v / max) * plotH;

  const band    = plotW / cats.length;
  const barW    = Math.min(BAR_MAX, (band - GAP * (series.length + 1)) / series.length);
  const groupW  = barW * series.length + GAP * (series.length - 1);

  // Grouped bars sit 2px apart, so a label centred on one of them runs straight
  // over its neighbour. With more than one series only the group's tallest bar
  // is labelled and the y-axis carries the rest; a single series can label every
  // cap as long as the text fits its band. A collided label is worse than none.
  const widest   = Math.max(...series.flatMap((s) => s.values.map((v) => textWidth(fmt(v, unit), 11))));
  const labelAll = series.length === 1 && widest <= band - 6 && cats.length <= 12;

  const marks = cats.map((cat, ci) => {
    const gx = PAD.left + band * ci + (band - groupW) / 2;
    const groupPeak = Math.max(...series.map((s) => Number(s.values[ci]) || 0));

    const bars = series.map((s, si) => {
      const v = Number(s.values[ci]) || 0;
      const x = gx + si * (barW + GAP);
      const y = scale(v);
      const h = Math.max(baseY - y, 0);
      const r = Math.min(4, barW / 2, h);   // rounded data-end, square at baseline
      const showLabel = labelAll || (v === groupPeak && v > 0);

      // Path so only the top corners round — the baseline end stays square.
      const d = h <= 0 ? "" : `M${x},${baseY} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + barW - r},${y} Q${x + barW},${y} ${x + barW},${y + r} L${x + barW},${baseY} Z`;

      return `
      ${d ? `<path d="${d}" fill="${p.series[si]}"/>` : ""}
      ${showLabel ? `<text x="${x + barW / 2}" y="${y - 7}" text-anchor="middle" fill="${p.ink}"
              font-size="11" font-weight="600" style="font-variant-numeric:tabular-nums">${fmt(v, unit)}</text>` : ""}`;
    }).join("");

    return `${bars}
    <text x="${PAD.left + band * ci + band / 2}" y="${baseY + 20}" text-anchor="middle"
          fill="${p.inkMuted}" font-size="11">${escHtml(cat)}</text>`;
  }).join("");

  return `
  ${gridAndAxis(ticks, scale, p, plotW, unit)}
  <line x1="${PAD.left}" y1="${baseY}" x2="${PAD.left + plotW}" y2="${baseY}" stroke="${p.baseline}" stroke-width="1"/>
  ${marks}
  ${legend(series, p, H - 10)}`;
}

// ─── Bar (horizontal) ─────────────────────────────────────────────────────────

function barChart(b, p) {
  const series = foldSeries(b.series, ADJACENT_SERIES_CAP).slice(0, 4);
  const cats   = b.categories;
  const unit   = b.unit ?? "";
  const hasLegend = series.length >= 2;

  const left  = 120;                       // room for category names
  const plotW = W - left - PAD.right - 52; // trailing room for value labels
  const plotH = H - PAD.top - 24 - (hasLegend ? 24 : 0);

  const peak = Math.max(...series.flatMap((s) => s.values), 0);
  const { max } = niceScale(peak);

  const band = plotH / cats.length;
  const barH = Math.min(BAR_MAX, (band - GAP * (series.length + 1)) / series.length);
  const groupH = barH * series.length + GAP * (series.length - 1);

  const marks = cats.map((cat, ci) => {
    const gy = PAD.top + band * ci + (band - groupH) / 2;

    const bars = series.map((s, si) => {
      const v = Number(s.values[ci]) || 0;
      const y = gy + si * (barH + GAP);
      const w = Math.max((v / max) * plotW, 0);
      const r = Math.min(4, barH / 2, w);
      const d = w <= 0 ? "" : `M${left},${y} L${left + w - r},${y} Q${left + w},${y} ${left + w},${y + r} L${left + w},${y + barH - r} Q${left + w},${y + barH} ${left + w - r},${y + barH} L${left},${y + barH} Z`;

      return `
      ${d ? `<path d="${d}" fill="${p.series[si]}"/>` : ""}
      <text x="${left + w + 8}" y="${y + barH / 2 + 4}" fill="${p.ink}" font-size="11"
            font-weight="600" style="font-variant-numeric:tabular-nums">${fmt(v, unit)}</text>`;
    }).join("");

    return `${bars}
    <text x="${left - 12}" y="${gy + groupH / 2 + 4}" text-anchor="end" fill="${p.inkMuted}" font-size="11">${escHtml(cat)}</text>`;
  }).join("");

  return `
  <line x1="${left}" y1="${PAD.top}" x2="${left}" y2="${PAD.top + plotH}" stroke="${p.baseline}" stroke-width="1"/>
  ${marks}
  ${legend(series, p, H - 10)}`;
}

// ─── Line ─────────────────────────────────────────────────────────────────────

function lineChart(b, p) {
  const series = foldSeries(b.series, ADJACENT_SERIES_CAP).slice(0, 5);
  const cats   = b.categories;
  const unit   = b.unit ?? "";
  const hasLegend = series.length >= 2;

  const plotW = W - PAD.left - PAD.right - 40;  // trailing room for end labels
  const plotH = H - PAD.top - PAD.bottom - (hasLegend ? 24 : 0);
  const baseY = PAD.top + plotH;

  const peak = Math.max(...series.flatMap((s) => s.values), 0);
  const { max, ticks } = niceScale(peak);
  const scale = (v) => baseY - (v / max) * plotH;
  const xAt   = (i) => PAD.left + (cats.length === 1 ? plotW / 2 : (plotW / (cats.length - 1)) * i);

  const lines = series.map((s, si) => {
    const color = p.series[si];
    const pts = s.values.map((v, i) => [xAt(i), scale(Number(v) || 0)]);
    const d   = pts.map((pt, i) => `${i ? "L" : "M"}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(" ");

    // A single series gets a 10% wash under it; multiples would muddy each other.
    const area = series.length === 1
      ? `<path d="${d} L${pts[pts.length - 1][0]},${baseY} L${pts[0][0]},${baseY} Z" fill="${color}" fill-opacity="0.1"/>`
      : "";

    const last = pts[pts.length - 1];
    const lastV = Number(s.values[s.values.length - 1]) || 0;

    return `
    ${area}
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="4" fill="${color}" stroke="${p.surface}" stroke-width="2"/>
    <text x="${last[0] + 10}" y="${last[1] + 4}" fill="${p.ink}" font-size="11" font-weight="600"
          style="font-variant-numeric:tabular-nums">${fmt(lastV, unit)}</text>`;
  }).join("");

  const xLabels = cats.map((c, i) => {
    // Thin the axis labels rather than let them collide.
    const stride = Math.ceil(cats.length / 8);
    if (i % stride !== 0 && i !== cats.length - 1) return "";
    return `<text x="${xAt(i)}" y="${baseY + 20}" text-anchor="middle" fill="${p.inkMuted}" font-size="11">${escHtml(c)}</text>`;
  }).join("");

  return `
  ${gridAndAxis(ticks, scale, p, plotW, unit)}
  <line x1="${PAD.left}" y1="${baseY}" x2="${PAD.left + plotW}" y2="${baseY}" stroke="${p.baseline}" stroke-width="1"/>
  ${lines}
  ${xLabels}
  ${legend(series, p, H - 10)}`;
}

// ─── Donut ────────────────────────────────────────────────────────────────────

function donutChart(b, p) {
  const unit = b.unit ?? "";
  // Composition reads off the first series only — a donut can't hold two.
  const values = b.categories.map((c, i) => ({
    name:  c,
    value: Number(b.series[0]?.values[i]) || 0,
  })).filter((d) => d.value > 0).slice(0, 6);

  const total = values.reduce((a, d) => a + d.value, 0) || 1;
  const cx = 200, cy = H / 2 - 10, rOuter = 110, rInner = 68;

  let angle = -Math.PI / 2;
  const arcs = values.map((d, i) => {
    const sweep = (d.value / total) * Math.PI * 2;
    // The 2px surface gap, expressed as an angle at this radius.
    const gapA  = GAP / rOuter;
    const a0 = angle + gapA / 2;
    const a1 = angle + sweep - gapA / 2;
    angle += sweep;
    if (a1 <= a0) return "";

    const pt = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
    const large = sweep > Math.PI ? 1 : 0;
    const d3 = `M${pt(rOuter, a0)} A${rOuter},${rOuter} 0 ${large} 1 ${pt(rOuter, a1)} L${pt(rInner, a1)} A${rInner},${rInner} 0 ${large} 0 ${pt(rInner, a0)} Z`;

    // Share label inside the band, but only when it genuinely fits the arc.
    const mid  = (a0 + a1) / 2;
    const pct  = `${Math.round((d.value / total) * 100)}%`;
    const arcLen = sweep * ((rOuter + rInner) / 2);
    const fits = arcLen > textWidth(pct, 12) + 12 && rOuter - rInner > 20;
    const lx = cx + ((rOuter + rInner) / 2) * Math.cos(mid);
    const ly = cy + ((rOuter + rInner) / 2) * Math.sin(mid);

    return `
    <path d="${d3}" fill="${p.series[i]}"/>
    ${fits ? `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle"
            fill="${inkOn(p.series[i])}" font-size="12" font-weight="700">${pct}</text>` : ""}`;
  }).join("");

  // Every slice is named and valued in the key, so nothing rests on hue alone.
  const key = values.map((d, i) => `
    <g transform="translate(400,${cy - values.length * 15 + i * 30})">
      <rect x="0" y="-9" width="10" height="10" rx="2" fill="${p.series[i]}"/>
      <text x="18" y="0" fill="${p.ink}" font-size="12.5">${escHtml(d.name)}</text>
      <text x="18" y="15" fill="${p.inkMuted}" font-size="11" style="font-variant-numeric:tabular-nums">${fmt(d.value, unit)}</text>
    </g>`).join("");

  return `
  ${arcs}
  <text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="${p.ink}" font-size="24" font-weight="700">${fmt(total, unit)}</text>
  <text x="${cx}" y="${cy + 16}" text-anchor="middle" fill="${p.axisLabel}" font-size="11" letter-spacing="0.06em">TOTAL</text>
  ${key}`;
}

// ─── Progress meters ──────────────────────────────────────────────────────────

function progressChart(b, p) {
  const unit = b.unit ?? "%";
  const rows = b.categories.map((c, i) => ({
    name:  c,
    value: Number(b.series[0]?.values[i]) || 0,
  })).slice(0, 6);

  const max = Math.max(...rows.map((r) => r.value), unit === "%" ? 100 : 0) || 1;
  const left = 150;
  const trackW = W - left - 90;
  const rowH = Math.min(56, (H - 40) / rows.length);

  return rows.map((r, i) => {
    const y = 24 + i * rowH;
    const w = Math.max((r.value / max) * trackW, 0);
    const h = 12;
    // The meter's fill is the sequential hue; the track is a lighter step of the
    // same ramp, so the state reads across the whole bar.
    const fill  = p.series[0];
    const track = p.mode === "dark" ? p.track : p.sequential[0];
    return `
    <text x="${left - 14}" y="${y + h}" text-anchor="end" fill="${p.ink}" font-size="12.5">${escHtml(r.name)}</text>
    <rect x="${left}" y="${y + 2}" width="${trackW}" height="${h}" rx="${h / 2}" fill="${track}"/>
    ${w > 0 ? `<rect x="${left}" y="${y + 2}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"/>` : ""}
    <text x="${left + trackW + 12}" y="${y + h}" fill="${p.ink}" font-size="12" font-weight="600"
          style="font-variant-numeric:tabular-nums">${fmt(r.value, unit)}</text>`;
  }).join("");
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const RENDERERS = {
  column:   columnChart,
  bar:      barChart,
  line:     lineChart,
  donut:    donutChart,
  progress: progressChart,
};

export function renderChart(block, t) {
  const p = chartPalette(t);
  const draw = RENDERERS[block.chart_type] ?? columnChart;

  let body;
  try {
    body = draw(block, p);
  } catch (err) {
    // A malformed chart must never take the whole document down.
    console.warn(`[chart] Failed to draw ${block.chart_type}: ${err.message}`);
    return "";
  }

  return `
<figure class="chart-block">
  ${block.title ? `<figcaption class="chart-head">
    <h3 class="chart-title">${block.title}</h3>
    ${block.subtitle ? `<p class="chart-sub">${block.subtitle}</p>` : ""}
  </figcaption>` : ""}
  <svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img"
       aria-label="${block.title ? String(block.title).replace(/"/g, "") : block.chart_type + " chart"}"
       xmlns="http://www.w3.org/2000/svg">
    ${body}
  </svg>
  ${block.takeaway ? `<p class="chart-takeaway">${block.takeaway}</p>` : ""}
</figure>`;
}

export function chartCss(t) {
  return `
.chart-block { margin: 0 0 22px; break-inside: avoid; }
.chart-head { margin-bottom: 10px; }
.chart-title { font-family: '${t.headingFont}', sans-serif; font-size: 15px; font-weight: 700; color: ${t.bodyText}; }
.chart-sub { font-size: 12px; color: ${t.mutedText}; margin-top: 2px; }
.chart-svg { width: 100%; height: auto; display: block;
  font-family: '${t.bodyFont}', system-ui, sans-serif; }
.chart-takeaway { font-size: 12.5px; line-height: 1.6; color: ${t.mutedText};
  margin-top: 10px; padding-left: 12px; border-left: 2px solid ${t.accent}; }
`;
}
