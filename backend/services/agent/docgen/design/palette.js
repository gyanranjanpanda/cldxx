/**
 * Chart palette — the color parameters for every chart we draw, in either medium.
 *
 * The categorical slot ORDER is the colorblind-safety mechanism, not decoration.
 * Both columns were checked with the dataviz validator against the surfaces they
 * actually render on, and both clear every gate:
 *
 *   light  (surface #FFFFFF)  worst adjacent CVD ΔE 9.1 · normal-vision ΔE 19.6
 *   dark   (surface #0F172A)  worst adjacent CVD ΔE 8.4 · normal-vision ΔE 19.3
 *
 * Light mode carries a contrast WARN — aqua/yellow/magenta sit below 3:1 on white.
 * The documented relief is visible direct labels, which every chart component here
 * ships unconditionally. Print has no hover layer, so labels were mandatory anyway.
 *
 * Do not reorder these arrays and do not append a 9th hue. A 9th series folds into
 * "Other" or becomes small multiples — see `foldSeries()`.
 */

/** Categorical hues, in fixed assignment order. */
const CATEGORICAL = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark:  ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

/**
 * Forms that put every series against every other (donut arcs, scatter) can only
 * carry the first three slots — past that, adjacent-pair safety no longer applies
 * and the full eight cannot clear the floors. Bars/lines/columns use the adjacent
 * pairlist and get all eight.
 */
export const ALL_PAIRS_SERIES_CAP = 3;
export const ADJACENT_SERIES_CAP  = 8;

/** Sequential ramp (single hue, light→dark) for magnitude encoding. */
const SEQUENTIAL = {
  light: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#2a78d6", "#256abf", "#184f95"],
  dark:  ["#184f95", "#256abf", "#2a78d6", "#3987e5", "#6da7ec", "#9ec5f4", "#cde2fb"],
};

/** Status colors — reserved. Never reused as "series 4". Always shipped with a label. */
export const STATUS = {
  good:     "#0ca30c",
  warning:  "#fab219",
  serious:  "#ec835a",
  critical: "#d03b3b",
};

/** Chart chrome — grid, axis and ink. Text never wears a series color. */
const CHROME = {
  light: {
    surface:   "#FFFFFF",
    ink:       "#0b0b0b",
    inkMuted:  "#52514e",
    axisLabel: "#898781",
    grid:      "#e1e0d9",
    baseline:  "#c3c2b7",
    track:     "#eef2f7",
  },
  dark: {
    surface:   "#0F172A",
    ink:       "#F1F5F9",
    inkMuted:  "#c3c2b7",
    axisLabel: "#898781",
    grid:      "#2c2c2a",
    baseline:  "#383835",
    track:     "#1E293B",
  },
};

/**
 * Resolve the chart palette for a document theme.
 * @param {import("../renderer/themes/index.js").Theme} theme
 * @returns {{ mode: "light"|"dark", series: string[], sequential: string[], status: typeof STATUS } & typeof CHROME.light}
 */
export function chartPalette(theme) {
  const mode = theme?.mode === "dark" ? "dark" : "light";
  return {
    mode,
    series:     CATEGORICAL[mode],
    sequential: SEQUENTIAL[mode],
    status:     STATUS,
    ...CHROME[mode],
    // The surface a chart sits on is the theme's own card background, not the
    // abstract white/black — surface gaps and rings are drawn in THIS color.
    surface: theme?.chartSurface ?? CHROME[mode].surface,
  };
}

/**
 * Assign a color to a series by its INDEX, never by its rank. A filter that drops
 * a series must not repaint the survivors, so the index is the identity.
 * @param {number} index
 * @param {"light"|"dark"} mode
 */
export function seriesColor(index, mode = "light") {
  const hues = CATEGORICAL[mode] ?? CATEGORICAL.light;
  return hues[index] ?? hues[hues.length - 1];
}

/**
 * Fold an over-long series list down to the cap, collapsing the tail into "Other"
 * rather than inventing a 9th hue.
 * @template {{ name: string, values: number[] }} S
 * @param {S[]} series
 * @param {number} cap
 * @returns {S[]}
 */
export function foldSeries(series, cap = ADJACENT_SERIES_CAP) {
  if (series.length <= cap) return series;

  const kept = series.slice(0, cap - 1);
  const tail = series.slice(cap - 1);
  const width = Math.max(...tail.map((s) => s.values.length));
  const summed = Array.from({ length: width }, (_, i) =>
    tail.reduce((acc, s) => acc + (Number(s.values[i]) || 0), 0),
  );

  return [...kept, /** @type {S} */ ({ name: "Other", values: summed })];
}

/**
 * Pick ink or white for a label set INSIDE a colored fill, by the fill's luminance.
 * This is the one place a label is allowed to sit on a series color.
 * @param {string} hex
 */
export function inkOn(hex) {
  const h = hex.replace("#", "");
  const to = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(to(0)) + 0.7152 * lin(to(2)) + 0.0722 * lin(to(4));
  return L > 0.45 ? "#0b0b0b" : "#FFFFFF";
}
