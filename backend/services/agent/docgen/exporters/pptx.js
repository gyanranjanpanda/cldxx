/**
 * PPTX Exporter — turns composed sections into designed slides.
 *
 * This replaces the old standalone ppt.agent, which had one LLM call, a regex
 * parser over a plain-text protocol, and exactly three slide shapes — so every
 * content slide was the same stack of rounded bullet cards no matter what the
 * content was. Now the deck consumes the same planned, validated document tree
 * the PDF does, and each section is drawn by the builder its layout names.
 *
 * Charts are native PowerPoint charts (editable in Keynote/PowerPoint, not
 * pictures of charts). Mermaid diagrams are rasterized, since PowerPoint has no
 * diagram renderer — see `diagram.js`.
 */

import pptxgen from "pptxgenjs";
import { getTheme }        from "../renderer/themes/index.js";
import { chartPalette, foldSeries, ADJACENT_SERIES_CAP } from "../design/palette.js";
import { rasterizeDiagrams } from "./diagram.js";
import { bus }             from "../events/bus.js";

// ─── Slide grid (LAYOUT_WIDE = 13.333 × 7.5 in) ───────────────────────────────

const SW = 13.333;
const SH = 7.5;
const M  = 0.62;                 // side margin
const CW = SW - M * 2;           // content width
const TITLE_Y   = 0.44;
const BODY_Y    = 1.42;
const BODY_H    = 5.25;
const FOOTER_Y  = 6.92;

/** pptxgenjs wants bare hex. */
const hx = (c) => String(c ?? "").replace("#", "").toUpperCase();

/** Strip the HTML entities the Zod layer escaped — PowerPoint shows them literally. */
const txt = (s) => String(s ?? "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim();

/** Cap a string so it can't overrun its box even after shrink-to-fit. */
const clamp = (s, n) => {
  const t = txt(s);
  return t.length <= n ? t : `${t.slice(0, n - 1).replace(/[\s,;:.]+\S*$/, "")}…`;
};

// ─── Theme → slide tokens ─────────────────────────────────────────────────────

function tokens(theme) {
  const p = chartPalette(theme);
  return {
    accent:     hx(theme.accent),
    accentDark: hx(theme.accentDark),
    dark:       hx(theme.coverBg),
    bg:         hx(theme.bg),
    card:       hx(theme.cardBg),
    cardAlt:    hx(theme.cardAlt),
    border:     hx(theme.accentBorder),
    text:       hx(theme.bodyText),
    muted:      hx(theme.mutedText),
    onDark:     hx(theme.coverText),
    onDarkMuted:hx(theme.coverMuted),
    codeBg:     hx(theme.codeBg),
    codeText:   hx(theme.codeText),
    heading:    theme.headingFont,
    body:       theme.bodyFont,
    mono:       theme.monoFont,
    series:     p.series.map(hx),
    gridLine:   hx(p.grid),
    axis:       hx(p.axisLabel),
  };
}

// ─── Shared chrome ────────────────────────────────────────────────────────────

function slideTitle(slide, text, T, opts = {}) {
  slide.addText(clamp(text, 78), {
    x: M, y: TITLE_Y, w: CW - 0.8, h: 0.62,
    fontSize: 27, bold: true, color: opts.onDark ? T.onDark : T.text,
    fontFace: T.heading, valign: "middle", fit: "shrink",
  });
  slide.addShape("rect", {
    x: M, y: TITLE_Y + 0.72, w: 0.62, h: 0.055,
    fill: { color: T.accent }, line: { type: "none" },
  });
}

function slideFooter(slide, T, index, onDark = false) {
  slide.addText("cldxAI", {
    x: M, y: FOOTER_Y, w: 3, h: 0.26,
    fontSize: 9, color: onDark ? T.onDarkMuted : T.muted, fontFace: T.body,
  });
  if (index != null) {
    slide.addText(String(index), {
      x: SW - M - 1, y: FOOTER_Y, w: 1, h: 0.26,
      fontSize: 9, color: onDark ? T.onDarkMuted : T.muted, fontFace: T.body, align: "right",
    });
  }
}

/** Find the first block of a type within a section. */
const pick = (section, type) => section.blocks.find((b) => b.type === type);

// ─── Layout builders ──────────────────────────────────────────────────────────
// Each takes (slide, section, T, ctx) and draws one slide.

function buildCover(slide, section, T, ctx) {
  const b = pick(section, "cover") ?? {};
  slide.background = { color: T.dark };

  slide.addShape("ellipse", {
    x: SW - 3.2, y: -1.8, w: 5.4, h: 5.4,
    fill: { color: T.accent, transparency: 82 }, line: { type: "none" },
  });
  slide.addShape("ellipse", {
    x: -1.2, y: SH - 2.4, w: 3.4, h: 3.4,
    fill: { color: T.accent, transparency: 88 }, line: { type: "none" },
  });

  slide.addShape("rect", {
    x: M, y: 2.5, w: 0.8, h: 0.07,
    fill: { color: T.accent }, line: { type: "none" },
  });
  slide.addText(clamp(b.title ?? ctx.title, 90), {
    x: M, y: 2.78, w: CW - 3, h: 1.5,
    fontSize: 40, bold: true, color: T.onDark, fontFace: T.heading,
    valign: "top", fit: "shrink", lineSpacingMultiple: 1.05,
  });
  if (b.subtitle) {
    slide.addText(clamp(b.subtitle, 130), {
      x: M, y: 4.35, w: CW - 4, h: 0.8,
      fontSize: 15, color: T.onDarkMuted, fontFace: T.body, valign: "top", fit: "shrink",
    });
  }
  slide.addText(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), {
    x: M, y: FOOTER_Y - 0.1, w: 5, h: 0.3,
    fontSize: 10, color: T.onDarkMuted, fontFace: T.body, charSpacing: 1,
  });
}

/** Agenda — the deck's answer to a table of contents. */
function buildAgenda(slide, section, T, ctx, index) {
  slide.background = { color: T.bg };
  slideTitle(slide, "Agenda", T);

  const rows = ctx.agenda.slice(0, 8);
  const colH = 0.62;
  const perCol = Math.ceil(rows.length / 2);
  const useTwoCols = rows.length > 4;
  const colW = useTwoCols ? (CW - 0.5) / 2 : CW;

  rows.forEach((r, i) => {
    const col = useTwoCols && i >= perCol ? 1 : 0;
    const row = useTwoCols ? i % perCol : i;
    const x = M + col * (colW + 0.5);
    const y = BODY_Y + row * (colH + 0.16);

    slide.addShape("ellipse", {
      x, y: y + 0.08, w: 0.42, h: 0.42,
      fill: { color: T.cardAlt }, line: { color: T.border, width: 0.75 },
    });
    slide.addText(String(i + 1).padStart(2, "0"), {
      x, y: y + 0.08, w: 0.42, h: 0.42,
      fontSize: 11, bold: true, color: T.accent, fontFace: T.heading,
      align: "center", valign: "middle",
    });
    slide.addText(clamp(r.title, 52), {
      x: x + 0.58, y, w: colW - 0.58, h: colH,
      fontSize: 13.5, color: T.text, fontFace: T.body, valign: "middle", fit: "shrink",
    });
  });

  slideFooter(slide, T, index);
}

function buildSectionBreak(slide, section, T, ctx, index) {
  const b = pick(section, "section_break") ?? {};
  slide.background = { color: T.dark };

  slide.addShape("ellipse", {
    x: SW - 4, y: SH - 3.4, w: 6, h: 6,
    fill: { color: T.accent, transparency: 86 }, line: { type: "none" },
  });

  if (b.number) {
    slide.addText(String(b.number), {
      x: M, y: 2.0, w: 3, h: 1.3,
      fontSize: 72, bold: true, color: T.accent, fontFace: T.heading, transparency: 60,
    });
  }
  slide.addShape("rect", {
    x: M, y: 3.35, w: 0.7, h: 0.06,
    fill: { color: T.accent }, line: { type: "none" },
  });
  slide.addText(clamp(b.title ?? section.title, 70), {
    x: M, y: 3.6, w: CW - 2.5, h: 1.1,
    fontSize: 34, bold: true, color: T.onDark, fontFace: T.heading, fit: "shrink",
  });
  if (b.subtitle) {
    slide.addText(clamp(b.subtitle, 120), {
      x: M, y: 4.75, w: CW - 4, h: 0.6,
      fontSize: 14, color: T.onDarkMuted, fontFace: T.body, fit: "shrink",
    });
  }
}

function buildBullets(slide, section, T, ctx, index) {
  slide.background = { color: T.bg };
  slideTitle(slide, section.title ?? pick(section, "heading")?.text ?? "", T);

  const b = pick(section, "bullets");
  const items = (b?.items ?? []).slice(0, 6);

  if (!items.length) return buildProse(slide, section, T, ctx, index);

  const gap  = 0.14;
  const rowH = Math.min(0.86, (BODY_H - gap * (items.length - 1)) / items.length);

  items.forEach((item, i) => {
    const y = BODY_Y + i * (rowH + gap);
    slide.addShape("roundRect", {
      x: M, y, w: CW, h: rowH,
      fill: { color: i % 2 === 0 ? T.cardAlt : T.card },
      line: { color: T.border, width: 0.75 },
      rectRadius: 0.06,
    });
    slide.addShape("rect", {
      x: M, y, w: 0.045, h: rowH,
      fill: { color: T.accent }, line: { type: "none" },
    });
    slide.addText(clamp(item, 150), {
      x: M + 0.34, y: y + 0.06, w: CW - 0.66, h: rowH - 0.12,
      fontSize: 14, color: T.text, fontFace: T.body, valign: "middle", fit: "shrink",
    });
  });

  slideFooter(slide, T, index);
}

function buildProse(slide, section, T, ctx, index) {
  slide.background = { color: T.bg };
  slideTitle(slide, section.title ?? pick(section, "heading")?.text ?? "", T);

  const paras = section.blocks.filter((b) => b.type === "paragraph").map((b) => txt(b.text));
  const callout = pick(section, "callout");

  if (paras.length) {
    slide.addText(paras.map((p) => ({ text: clamp(p, 420), options: { breakLine: true, paraSpaceAfter: 8 } })), {
      x: M, y: BODY_Y, w: CW * 0.72, h: BODY_H,
      fontSize: 14.5, color: T.text, fontFace: T.body, valign: "top",
      lineSpacingMultiple: 1.35, fit: "shrink",
    });
  }

  if (callout) {
    slide.addShape("roundRect", {
      x: M + CW * 0.75, y: BODY_Y, w: CW * 0.25, h: 2.1,
      fill: { color: T.cardAlt }, line: { color: T.accent, width: 1 }, rectRadius: 0.08,
    });
    slide.addText(clamp(callout.title ?? "Note", 30), {
      x: M + CW * 0.75 + 0.2, y: BODY_Y + 0.16, w: CW * 0.25 - 0.4, h: 0.3,
      fontSize: 11, bold: true, color: T.accent, fontFace: T.heading,
    });
    slide.addText(clamp(callout.text, 200), {
      x: M + CW * 0.75 + 0.2, y: BODY_Y + 0.5, w: CW * 0.25 - 0.4, h: 1.45,
      fontSize: 11.5, color: T.text, fontFace: T.body, valign: "top", fit: "shrink",
    });
  }

  slideFooter(slide, T, index);
}

function buildTwoCol(slide, section, T, ctx, index) {
  slide.background = { color: T.bg };
  slideTitle(slide, section.title ?? "", T);

  const b = pick(section, "two_col");
  if (!b) return buildBullets(slide, section, T, ctx, index);

  const colW = (CW - 0.55) / 2;
  b.columns.slice(0, 2).forEach((col, i) => {
    const x = M + i * (colW + 0.55);

    slide.addText(clamp(col.title, 44), {
      x, y: BODY_Y, w: colW, h: 0.42,
      fontSize: 15, bold: true, color: T.text, fontFace: T.heading, valign: "middle", fit: "shrink",
    });
    slide.addShape("rect", {
      x, y: BODY_Y + 0.46, w: colW, h: 0.028,
      fill: { color: T.accent }, line: { type: "none" },
    });

    let y = BODY_Y + 0.68;
    if (col.text) {
      slide.addText(clamp(col.text, 240), {
        x, y, w: colW, h: 1.0,
        fontSize: 12.5, color: T.text, fontFace: T.body, valign: "top",
        lineSpacingMultiple: 1.3, fit: "shrink",
      });
      y += 1.1;
    }
    (col.items ?? []).slice(0, 5).forEach((item) => {
      slide.addShape("ellipse", {
        x, y: y + 0.13, w: 0.1, h: 0.1,
        fill: { color: T.accent }, line: { type: "none" },
      });
      slide.addText(clamp(item, 110), {
        x: x + 0.24, y, w: colW - 0.24, h: 0.62,
        fontSize: 12.5, color: T.text, fontFace: T.body, valign: "top", fit: "shrink",
      });
      y += 0.68;
    });
  });

  slideFooter(slide, T, index);
}

function buildComparison(slide, section, T, ctx, index) {
  slide.background = { color: T.bg };
  slideTitle(slide, section.title ?? "", T);

  const b = pick(section, "comparison");
  if (!b) return buildBullets(slide, section, T, ctx, index);

  const panelW = (CW - 0.75) / 2;
  const panelH = BODY_H - 0.15;

  [["left", b.left], ["right", b.right]].forEach(([side, col], i) => {
    const x = M + i * (panelW + 0.75);

    slide.addShape("roundRect", {
      x, y: BODY_Y, w: panelW, h: panelH,
      fill: { color: i === 0 ? T.cardAlt : T.card },
      line: { color: T.border, width: 0.75 }, rectRadius: 0.08,
    });
    slide.addShape("rect", {
      x, y: BODY_Y, w: panelW, h: 0.05,
      fill: { color: i === 0 ? T.accent : T.muted }, line: { type: "none" },
    });
    slide.addText(clamp(col.title, 40), {
      x: x + 0.28, y: BODY_Y + 0.24, w: panelW - 0.56, h: 0.42,
      fontSize: 15, bold: true, color: T.text, fontFace: T.heading, fit: "shrink",
    });

    col.items.slice(0, 5).forEach((item, j) => {
      const y = BODY_Y + 0.86 + j * 0.72;
      slide.addShape("ellipse", {
        x: x + 0.3, y: y + 0.13, w: 0.1, h: 0.1,
        fill: { color: i === 0 ? T.accent : T.muted }, line: { type: "none" },
      });
      slide.addText(clamp(item, 120), {
        x: x + 0.54, y, w: panelW - 0.84, h: 0.66,
        fontSize: 12.5, color: T.text, fontFace: T.body, valign: "top", fit: "shrink",
      });
    });
  });

  // The spine, centered between the panels.
  slide.addShape("ellipse", {
    x: M + panelW + 0.135, y: BODY_Y + panelH / 2 - 0.24, w: 0.48, h: 0.48,
    fill: { color: T.bg }, line: { color: T.border, width: 1 },
  });
  slide.addText("VS", {
    x: M + panelW + 0.135, y: BODY_Y + panelH / 2 - 0.24, w: 0.48, h: 0.48,
    fontSize: 10, bold: true, color: T.muted, fontFace: T.heading,
    align: "center", valign: "middle",
  });

  slideFooter(slide, T, index);
}

function buildMetrics(slide, section, T, ctx, index) {
  const b = pick(section, "stats");
  slide.background = { color: T.dark };

  slide.addText(clamp(b?.title ?? section.title ?? "Key Metrics", 70), {
    x: M, y: TITLE_Y, w: CW, h: 0.62,
    fontSize: 27, bold: true, color: T.onDark, fontFace: T.heading, valign: "middle", fit: "shrink",
  });
  slide.addShape("rect", {
    x: M, y: TITLE_Y + 0.72, w: 0.62, h: 0.055,
    fill: { color: T.accent }, line: { type: "none" },
  });

  const items = (b?.items ?? []).slice(0, 4);
  if (!items.length) return slideFooter(slide, T, index, true);

  const gap  = 0.32;
  const cardW = (CW - gap * (items.length - 1)) / items.length;
  const cardH = 3.1;
  const y = BODY_Y + 0.5;

  items.forEach((s, i) => {
    const x = M + i * (cardW + gap);
    slide.addShape("roundRect", {
      x, y, w: cardW, h: cardH,
      fill: { color: T.dark }, line: { color: T.accent, width: 1 }, rectRadius: 0.1,
    });
    slide.addShape("rect", {
      x: x + cardW / 2 - 0.22, y: y + 0.42, w: 0.44, h: 0.045,
      fill: { color: T.accent }, line: { type: "none" },
    });
    slide.addText(clamp(s.value, 12), {
      x: x + 0.12, y: y + 0.85, w: cardW - 0.24, h: 1.1,
      fontSize: 42, bold: true, color: T.accent, fontFace: T.heading,
      align: "center", valign: "middle", fit: "shrink",
    });
    slide.addText(clamp(s.label, 60), {
      x: x + 0.2, y: y + 2.05, w: cardW - 0.4, h: 0.8,
      fontSize: 12, color: T.onDarkMuted, fontFace: T.body,
      align: "center", valign: "top", fit: "shrink",
    });
  });

  slideFooter(slide, T, index, true);
}

function buildChart(slide, section, T, ctx, index, ppt) {
  slide.background = { color: T.bg };
  slideTitle(slide, section.title ?? "", T);

  const b = pick(section, "chart");
  if (!b) return buildBullets(slide, section, T, ctx, index);

  const series = foldSeries(b.series, ADJACENT_SERIES_CAP).slice(0, 6);
  const cats   = b.categories.map((c) => clamp(c, 22));
  const takeaway = b.takeaway ? txt(b.takeaway) : null;

  const chartW = takeaway ? CW * 0.68 : CW;
  const chartH = BODY_H - 0.2;

  const common = {
    x: M, y: BODY_Y, w: chartW, h: chartH,
    chartColors: series.map((_, i) => T.series[i]),
    showLegend: series.length > 1,
    legendPos: "b",
    legendColor: T.muted,
    legendFontSize: 10,
    catAxisLabelColor: T.axis,
    valAxisLabelColor: T.axis,
    catAxisLabelFontSize: 10,
    valAxisLabelFontSize: 10,
    catAxisLabelFontFace: T.body,
    valAxisLabelFontFace: T.body,
    valGridLine: { color: T.gridLine, style: "solid", size: 0.75 },
    catGridLine: { style: "none" },
    border: { pt: 0, color: "FFFFFF" },
    // Print has no hover, so values ride the marks — the same rule the SVG
    // charts follow, and the relief the light palette's contrast requires.
    showValue: series.length * cats.length <= 12,
    dataLabelColor: T.text,
    dataLabelFontSize: 10,
    dataLabelFontFace: T.body,
  };

  const data = series.map((s) => ({
    name:   clamp(s.name, 30),
    labels: cats,
    values: s.values.map((v) => Number(v) || 0),
  }));

  if (b.chart_type === "donut") {
    slide.addChart(ppt.ChartType.doughnut, [{
      name: clamp(series[0].name, 30),
      labels: cats,
      values: series[0].values.map((v) => Number(v) || 0),
    }], {
      ...common, holeSize: 58, showValue: false, showPercent: true,
      dataLabelPosition: "ctr", dataLabelColor: "FFFFFF", showLegend: true, legendPos: "r",
    });
  } else if (b.chart_type === "line") {
    slide.addChart(ppt.ChartType.line, data, {
      ...common, lineSize: 2.5, lineSmooth: false,
      lineDataSymbol: "circle", lineDataSymbolSize: 6, showValue: false,
    });
  } else if (b.chart_type === "bar") {
    slide.addChart(ppt.ChartType.bar, data, { ...common, barDir: "bar", barGapWidthPct: 60 });
  } else {
    // column and progress both read as vertical bars in a deck
    slide.addChart(ppt.ChartType.bar, data, { ...common, barDir: "col", barGapWidthPct: 60 });
  }

  if (takeaway) {
    const x = M + chartW + 0.4;
    slide.addShape("rect", {
      x, y: BODY_Y + 0.1, w: 0.04, h: 1.6,
      fill: { color: T.accent }, line: { type: "none" },
    });
    slide.addText(clamp(takeaway, 260), {
      x: x + 0.22, y: BODY_Y + 0.1, w: CW - chartW - 0.62, h: 2.4,
      fontSize: 12.5, color: T.text, fontFace: T.body, valign: "top",
      lineSpacingMultiple: 1.35, fit: "shrink",
    });
  }

  slideFooter(slide, T, index);
}

function buildDiagram(slide, section, T, ctx, index) {
  slide.background = { color: T.bg };
  slideTitle(slide, section.title ?? "", T);

  const b = pick(section, "mermaid");
  const img = b ? ctx.diagrams.get(b) : null;

  if (!img) {
    // Rasterization failed. Say so on the slide rather than shipping a blank one.
    const para = section.blocks.find((x) => x.type === "paragraph");
    slide.addText(para ? clamp(para.text, 380) : "Diagram unavailable.", {
      x: M, y: BODY_Y, w: CW, h: BODY_H,
      fontSize: 14, color: T.muted, fontFace: T.body, valign: "top", fit: "shrink",
    });
    return slideFooter(slide, T, index);
  }

  // Fit inside the body box, preserving aspect ratio.
  const boxW = CW, boxH = BODY_H - 0.5;
  const scale = Math.min(boxW / img.width, boxH / img.height);
  const w = img.width * scale;
  const h = img.height * scale;

  slide.addImage({
    data: img.dataUrl,
    x: M + (boxW - w) / 2,
    y: BODY_Y + (boxH - h) / 2,
    w, h,
  });

  const para = section.blocks.find((x) => x.type === "paragraph");
  if (para) {
    slide.addText(clamp(para.text, 170), {
      x: M, y: BODY_Y + boxH + 0.1, w: CW, h: 0.4,
      fontSize: 11.5, color: T.muted, fontFace: T.body, align: "center", fit: "shrink",
    });
  }

  slideFooter(slide, T, index);
}

function buildTable(slide, section, T, ctx, index) {
  slide.background = { color: T.bg };
  slideTitle(slide, section.title ?? "", T);

  const t = pick(section, "table");
  const generic = t ?? deriveTable(section);
  if (!generic) return buildBullets(slide, section, T, ctx, index);

  const head = generic.columns.map((c) => ({
    text: clamp(c, 30),
    options: { bold: true, color: T.onDark, fill: { color: T.dark }, fontFace: T.heading, fontSize: 11.5 },
  }));

  const maxRows = 8;
  const body = generic.rows.slice(0, maxRows).map((row, i) =>
    row.map((cell) => ({
      text: clamp(cell, 110),
      options: {
        color: T.text, fontFace: T.body, fontSize: 11,
        fill: { color: i % 2 === 0 ? T.bg : T.card },
      },
    })),
  );

  slide.addTable([head, ...body], {
    x: M, y: BODY_Y, w: CW,
    border: { type: "solid", color: T.border, pt: 0.5 },
    autoPage: false, valign: "middle",
    rowH: Math.min(0.52, (BODY_H - 0.5) / (body.length + 1)),
  });

  if (generic.rows.length > maxRows) {
    slide.addText(`+${generic.rows.length - maxRows} more rows`, {
      x: M, y: BODY_Y + BODY_H - 0.3, w: CW, h: 0.28,
      fontSize: 10, italic: true, color: T.muted, fontFace: T.body,
    });
  }

  slideFooter(slide, T, index);
}

/** Flatten the specialised table-ish blocks into columns/rows. */
function deriveTable(section) {
  const api = pick(section, "api_table");
  if (api) return {
    columns: ["Method", "Endpoint", "Description", "Auth"],
    rows: api.endpoints.map((e) => [e.method, e.path, e.description, e.auth ? "Yes" : "No"]),
  };

  const risk = pick(section, "risk_matrix");
  if (risk) return {
    columns: ["Risk", "Likelihood", "Impact", "Mitigation"],
    rows: risk.risks.map((r) => [r.name, r.likelihood, r.impact, r.mitigation ?? "—"]),
  };

  const prd = pick(section, "prd");
  if (prd) return {
    columns: ["ID", "Requirement", "Priority", "Status"],
    rows: prd.requirements.map((r) => [r.id, r.requirement, r.priority, r.status]),
  };

  const dec = pick(section, "decision_log");
  if (dec) return {
    columns: ["ID", "Decision", "Rationale", "Status"],
    rows: dec.decisions.map((d) => [d.id, d.decision, d.rationale, d.status]),
  };

  const schema = pick(section, "schema");
  if (schema) return {
    columns: ["Table", "Column", "Type", "Constraints"],
    rows: schema.tables.flatMap((tb) =>
      tb.columns.map((c) => [tb.name, c.name, c.type, c.constraints ?? "—"])),
  };

  return null;
}

function buildTimeline(slide, section, T, ctx, index) {
  slide.background = { color: T.bg };
  slideTitle(slide, section.title ?? "", T);

  const b = pick(section, "timeline");
  const events = (b?.events ?? []).slice(0, 5);
  if (!events.length) return buildBullets(slide, section, T, ctx, index);

  const railY = BODY_Y + 1.55;
  slide.addShape("rect", {
    x: M + 0.3, y: railY, w: CW - 0.6, h: 0.035,
    fill: { color: T.border }, line: { type: "none" },
  });

  const step = (CW - 0.6) / Math.max(events.length - 1, 1);
  const colW = Math.min(2.5, step * 0.92);

  events.forEach((e, i) => {
    const cx = M + 0.3 + i * step;
    const done = e.status === "done";
    const active = e.status === "active";
    const dotColor = done || active ? T.accent : T.border;

    slide.addShape("ellipse", {
      x: cx - 0.13, y: railY - 0.115, w: 0.26, h: 0.26,
      fill: { color: dotColor }, line: { color: T.bg, width: 2 },
    });
    if (active) {
      slide.addShape("ellipse", {
        x: cx - 0.24, y: railY - 0.225, w: 0.48, h: 0.48,
        fill: { type: "none" }, line: { color: T.accent, width: 1 },
      });
    }

    // Alternate above/below so labels never collide on a dense timeline.
    const above = i % 2 === 0;
    const dateY = above ? railY - 1.05 : railY + 0.34;
    const titleY = above ? railY - 0.74 : railY + 0.62;

    // The first and last label columns would otherwise hang off the slide, since
    // their milestones sit on the rail's ends. Clamp them into the margins.
    const lx = Math.min(Math.max(cx - colW / 2, M), SW - M - colW);

    slide.addText(clamp(e.date, 18), {
      x: lx, y: dateY, w: colW, h: 0.28,
      fontSize: 10.5, bold: true, color: T.accent, fontFace: T.heading, align: "center",
    });
    slide.addText(clamp(e.title, 40), {
      x: lx, y: titleY, w: colW, h: 0.34,
      fontSize: 12.5, bold: true, color: T.text, fontFace: T.body, align: "center", fit: "shrink",
    });
    if (e.description) {
      slide.addText(clamp(e.description, 70), {
        x: lx, y: titleY + 0.34, w: colW, h: 0.56,
        fontSize: 10.5, color: T.muted, fontFace: T.body, align: "center", valign: "top", fit: "shrink",
      });
    }
  });

  slideFooter(slide, T, index);
}

function buildSteps(slide, section, T, ctx, index) {
  slide.background = { color: T.bg };
  slideTitle(slide, section.title ?? "", T);

  const b = pick(section, "steps");
  const steps = (b?.steps ?? []).slice(0, 5);
  if (!steps.length) return buildBullets(slide, section, T, ctx, index);

  const gap = 0.3;
  const cardW = (CW - gap * (steps.length - 1)) / steps.length;
  const cardH = 2.9;
  const y = BODY_Y + 0.5;

  steps.forEach((s, i) => {
    const x = M + i * (cardW + gap);

    slide.addShape("roundRect", {
      x, y, w: cardW, h: cardH,
      fill: { color: T.card }, line: { color: T.border, width: 0.75 }, rectRadius: 0.08,
    });
    slide.addShape("ellipse", {
      x: x + cardW / 2 - 0.26, y: y - 0.26, w: 0.52, h: 0.52,
      fill: { color: T.accent }, line: { color: T.bg, width: 2 },
    });
    slide.addText(String(i + 1), {
      x: x + cardW / 2 - 0.26, y: y - 0.26, w: 0.52, h: 0.52,
      fontSize: 14, bold: true, color: "FFFFFF", fontFace: T.heading,
      align: "center", valign: "middle",
    });
    slide.addText(clamp(s.title, 44), {
      x: x + 0.18, y: y + 0.5, w: cardW - 0.36, h: 0.6,
      fontSize: 13.5, bold: true, color: T.text, fontFace: T.heading,
      align: "center", valign: "top", fit: "shrink",
    });
    if (s.description) {
      slide.addText(clamp(s.description, 140), {
        x: x + 0.18, y: y + 1.15, w: cardW - 0.36, h: 1.5,
        fontSize: 11.5, color: T.muted, fontFace: T.body,
        align: "center", valign: "top", fit: "shrink",
      });
    }

    // Connector between cards.
    if (i < steps.length - 1) {
      slide.addShape("rect", {
        x: x + cardW, y: y + cardH / 2 - 0.015, w: gap, h: 0.03,
        fill: { color: T.border }, line: { type: "none" },
      });
    }
  });

  slideFooter(slide, T, index);
}

function buildCode(slide, section, T, ctx, index) {
  slide.background = { color: T.bg };
  slideTitle(slide, section.title ?? "", T);

  const b = pick(section, "code");
  if (!b) return buildBullets(slide, section, T, ctx, index);

  let y = BODY_Y;
  if (b.description) {
    slide.addText(clamp(b.description, 200), {
      x: M, y, w: CW, h: 0.5,
      fontSize: 12.5, color: T.muted, fontFace: T.body, valign: "top", fit: "shrink",
    });
    y += 0.6;
  }

  const boxH = BODY_H - (y - BODY_Y);

  slide.addShape("roundRect", {
    x: M, y, w: CW, h: boxH,
    fill: { color: T.codeBg }, line: { type: "none" }, rectRadius: 0.06,
  });
  slide.addText(clamp(b.language ?? "text", 18).toUpperCase(), {
    x: M + 0.24, y: y + 0.1, w: 2, h: 0.26,
    fontSize: 9, bold: true, color: T.accent, fontFace: T.mono, charSpacing: 1,
  });

  // Trim by LINES, not characters — a clipped code sample is worse than a short one.
  const lines = txt(b.code).split("\n").slice(0, 16);
  slide.addText(lines.join("\n"), {
    x: M + 0.24, y: y + 0.44, w: CW - 0.48, h: boxH - 0.6,
    fontSize: 11, color: T.codeText, fontFace: T.mono,
    valign: "top", lineSpacingMultiple: 1.2, fit: "shrink",
  });

  slideFooter(slide, T, index);
}

function buildQuote(slide, section, T, ctx, index) {
  const b = pick(section, "quote");
  slide.background = { color: T.dark };

  slide.addShape("ellipse", {
    x: -1.5, y: -1.5, w: 5, h: 5,
    fill: { color: T.accent, transparency: 88 }, line: { type: "none" },
  });
  slide.addText("“", {
    x: M, y: 1.0, w: 1.4, h: 1.4,
    fontSize: 110, bold: true, color: T.accent, fontFace: T.heading,
  });
  slide.addText(clamp(b?.text ?? "", 260), {
    x: M + 0.1, y: 2.35, w: CW - 1.6, h: 2.4,
    fontSize: 26, color: T.onDark, fontFace: T.heading, valign: "top",
    lineSpacingMultiple: 1.25, fit: "shrink",
  });
  if (b?.source) {
    slide.addText(`— ${clamp(b.source, 60)}`, {
      x: M + 0.1, y: 4.95, w: CW - 1.6, h: 0.4,
      fontSize: 13, bold: true, color: T.accent, fontFace: T.body, charSpacing: 1,
    });
  }

  slideFooter(slide, T, index, true);
}

function buildConclusion(slide, section, T, ctx, index) {
  const b = pick(section, "conclusion");
  slide.background = { color: T.accent };

  slide.addShape("ellipse", {
    x: SW - 3.5, y: SH - 3, w: 6, h: 6,
    fill: { color: "FFFFFF", transparency: 92 }, line: { type: "none" },
  });

  slide.addText(clamp(b?.title ?? "Conclusion", 60), {
    x: M, y: 1.15, w: CW - 2, h: 0.85,
    fontSize: 34, bold: true, color: "FFFFFF", fontFace: T.heading, fit: "shrink",
  });
  slide.addText("KEY TAKEAWAYS", {
    x: M, y: 2.05, w: CW - 2, h: 0.32,
    fontSize: 11, bold: true, color: "FFFFFF", fontFace: T.body,
    charSpacing: 2, transparency: 35,
  });

  (b?.points ?? []).slice(0, 4).forEach((p, i) => {
    const y = 2.75 + i * 0.82;
    slide.addShape("ellipse", {
      x: M, y: y + 0.16, w: 0.16, h: 0.16,
      fill: { color: "FFFFFF" }, line: { type: "none" },
    });
    slide.addText(clamp(p, 150), {
      x: M + 0.42, y, w: CW - 1.4, h: 0.7,
      fontSize: 15, color: "FFFFFF", fontFace: T.body, valign: "top", fit: "shrink",
    });
  });

  slideFooter(slide, T, index, true);
}

// ─── Builder table ────────────────────────────────────────────────────────────

const BUILDERS = {
  cover:         buildCover,
  toc:           buildAgenda,
  section_break: buildSectionBreak,
  bullets:       buildBullets,
  prose:         buildProse,
  two_col:       buildTwoCol,
  comparison:    buildComparison,
  metrics:       buildMetrics,
  chart:         buildChart,
  diagram:       buildDiagram,
  table:         buildTable,
  timeline:      buildTimeline,
  steps:         buildSteps,
  code:          buildCode,
  quote:         buildQuote,
  conclusion:    buildConclusion,
};

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * @param {{ document: object, jobId?: string }} opts
 * @returns {Promise<Buffer>}
 */
export async function exportPptx({ document: doc, jobId = "" }) {
  bus.emit("export.started", { jobId, format: "pptx" });

  const theme = getTheme(doc.meta.theme);
  const T     = tokens(theme);
  const sections = doc.sections?.length ? doc.sections : [];

  if (!sections.length) {
    throw new Error("PPTX export requires a composed document — run the composer first");
  }

  // Rasterize every diagram up front, in one browser session.
  const mermaidBlocks = sections.flatMap((s) => s.blocks.filter((b) => b.type === "mermaid"));
  const rendered = await rasterizeDiagrams(
    mermaidBlocks.map((b) => b.source),
    { accent: theme.accent, ink: theme.bodyText, muted: theme.mutedText,
      surface: theme.cardBg, bg: theme.bg },
  );
  const diagrams = new Map();
  mermaidBlocks.forEach((b, i) => { if (rendered[i]) diagrams.set(b, rendered[i]); });

  const ppt = new pptxgen();
  ppt.layout  = "LAYOUT_WIDE";
  ppt.author  = doc.meta.author ?? "cldxAI";
  ppt.title   = txt(doc.meta.title);
  ppt.subject = txt(doc.meta.subject ?? "");

  const ctx = {
    title: txt(doc.meta.title),
    diagrams,
    agenda: sections
      .filter((s) => s.title && !["cover", "toc", "section_break", "conclusion"].includes(s.layout))
      .map((s) => ({ title: txt(s.title) })),
  };

  let slideNo = 0;
  for (const section of sections) {
    const build = BUILDERS[section.layout] ?? buildBullets;
    const slide = ppt.addSlide();

    // The cover carries no number; everything after it does.
    const numbered = section.layout !== "cover";
    if (numbered) slideNo++;

    try {
      build(slide, section, T, ctx, numbered ? slideNo : null, ppt);
    } catch (err) {
      console.warn(`[pptx] Builder "${section.layout}" failed for section ${section.id}: ${err.message}`);
      slide.addText(clamp(section.title ?? "Section", 70), {
        x: M, y: BODY_Y, w: CW, h: 1,
        fontSize: 24, bold: true, color: T.text, fontFace: T.heading,
      });
    }

    if (section.notes) slide.addNotes(txt(section.notes));
  }

  const buffer = await ppt.write({ outputType: "nodebuffer" });
  const out = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  out.pageCount = ppt.slides?.length ?? sections.length;

  bus.emit("export.finished", {
    jobId, format: "pptx", byteSize: out.length, slides: sections.length,
    diagramsRendered: diagrams.size, diagramsRequested: mermaidBlocks.length,
  });

  return out;
}
