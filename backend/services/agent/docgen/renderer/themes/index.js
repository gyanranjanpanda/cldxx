/** @type {import("./index.js").Theme} */
export const github = {
  name:          "github",
  accent:        "#0969DA",
  accentDark:    "#0550AE",
  accentLight:   "#DDF4FF",
  accentBorder:  "#54AEFF",
  bg:            "#FFFFFF",
  coverBg:       "#24292F",
  coverText:     "#FFFFFF",
  coverMuted:    "#8B949E",
  bodyText:      "#24292F",
  mutedText:     "#656D76",
  cardBg:        "#F6F8FA",
  cardAlt:       "#DDF4FF",
  codeBg:        "#161B22",
  codeText:      "#C9D1D9",
  statBg:        "#24292F",
  statCard:      "#161B22",
  statValue:     "#79C0FF",
  conclusionBg:  "#0969DA",
  borderRadius:  "6px",
  cardShadow:    "0 1px 0 rgba(27,31,36,0.04), 0 0 0 1px rgba(27,31,36,0.06)",
  headingFont:   "Inter",
  bodyFont:      "Inter",
  monoFont:      "JetBrains Mono",
  googleFonts:   "Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500",
};

// ─── Theme index ──────────────────────────────────────────────────────────────

import { professional } from "./professional.js";
import { dark }         from "./dark.js";
import { minimal }      from "./minimal.js";

/** @param {string} name @returns {Theme} */
export function getTheme(name) {
  const themes = { professional, dark, minimal, github };
  return themes[name] ?? professional;
}

/**
 * @typedef {object} Theme
 * @property {string} name
 * @property {string} accent
 * @property {string} accentDark
 * @property {string} accentLight
 * @property {string} accentBorder
 * @property {string} bg
 * @property {string} coverBg
 * @property {string} coverText
 * @property {string} coverMuted
 * @property {string} bodyText
 * @property {string} mutedText
 * @property {string} cardBg
 * @property {string} cardAlt
 * @property {string} codeBg
 * @property {string} codeText
 * @property {string} statBg
 * @property {string} statCard
 * @property {string} statValue
 * @property {string} conclusionBg
 * @property {string} borderRadius
 * @property {string} cardShadow
 * @property {string} headingFont
 * @property {string} bodyFont
 * @property {string} monoFont
 * @property {string} googleFonts
 */
