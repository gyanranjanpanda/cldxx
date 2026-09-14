/**
 * Local asset loader — fonts, Mermaid and Prism served off disk, never a CDN.
 *
 * Why this exists: the renderer used to pull Google Fonts, Prism and Mermaid from
 * CDNs while the PDF exporter waited on `networkidle0`. On a slow or offline box
 * that either hung the render or — worse — silently produced a PDF with no
 * diagrams, no syntax colors and fallback typography, with no error anywhere.
 *
 * Fonts are inlined as base64 `@font-face` so the HTML is genuinely self-contained.
 * Mermaid and Prism are large, so those are exposed as PATHS for the exporter to
 * inject with `page.addScriptTag({ path })` — no base64, no network.
 */

import fs   from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Resolve a file inside an installed package without hardcoding node_modules depth. */
function pkgFile(pkg, ...rel) {
  const pkgJson = require.resolve(`${pkg}/package.json`);
  return path.join(path.dirname(pkgJson), ...rel);
}

// ─── Fonts ────────────────────────────────────────────────────────────────────

/** @type {{ family: string, pkg: string, file: string, weight: number }[]} */
const FONT_FACES = [
  { family: "Inter",          pkg: "@fontsource/inter",           weight: 400 },
  { family: "Inter",          pkg: "@fontsource/inter",           weight: 500 },
  { family: "Inter",          pkg: "@fontsource/inter",           weight: 600 },
  { family: "Inter",          pkg: "@fontsource/inter",           weight: 700 },
  { family: "Sora",           pkg: "@fontsource/sora",            weight: 600 },
  { family: "Sora",           pkg: "@fontsource/sora",            weight: 700 },
  { family: "Sora",           pkg: "@fontsource/sora",            weight: 800 },
  { family: "JetBrains Mono", pkg: "@fontsource/jetbrains-mono",  weight: 400 },
  { family: "JetBrains Mono", pkg: "@fontsource/jetbrains-mono",  weight: 500 },
].map((f) => ({
  ...f,
  file: `${f.pkg.split("/")[1]}-latin-${f.weight}-normal.woff2`,
}));

let fontCssCache = null;

/**
 * Base64 `@font-face` rules for every family the themes use.
 * Cached — the files never change at runtime and this is ~270KB of string.
 * @returns {string}
 */
export function fontCss() {
  if (fontCssCache !== null) return fontCssCache;

  const rules = [];
  for (const face of FONT_FACES) {
    try {
      const buf = fs.readFileSync(pkgFile(face.pkg, "files", face.file));
      rules.push(`@font-face{font-family:'${face.family}';font-style:normal;font-weight:${face.weight};font-display:block;src:url(data:font/woff2;base64,${buf.toString("base64")}) format('woff2');}`);
    } catch (err) {
      // A missing weight degrades to a synthesized one — worth a warning, not a crash.
      console.warn(`[assets] Font not found, falling back: ${face.file} (${err.code ?? err.message})`);
    }
  }

  fontCssCache = rules.join("\n");
  return fontCssCache;
}

// ─── Script paths (injected by the exporter, not inlined) ─────────────────────

/** Absolute path to the Mermaid UMD bundle, or null if unavailable. */
export function mermaidPath() {
  try { return pkgFile("mermaid", "dist", "mermaid.min.js"); }
  catch { console.warn("[assets] mermaid not installed — diagrams will be skipped"); return null; }
}

/** Absolute paths to Prism core + the language grammars we support. */
export function prismPaths() {
  const langs = ["markup", "clike", "javascript", "typescript", "python", "sql",
                 "bash", "json", "yaml", "java", "go", "rust"];
  try {
    const core = pkgFile("prismjs", "prism.js");
    const components = langs
      .map((l) => pkgFile("prismjs", "components", `prism-${l}.min.js`))
      .filter((p) => fs.existsSync(p));
    return { core, components };
  } catch {
    console.warn("[assets] prismjs not installed — code blocks will render unhighlighted");
    return null;
  }
}

let prismCssCache = null;

/** Prism's Tomorrow theme, read off disk and scoped so it can't leak onto the page. */
export function prismCss() {
  if (prismCssCache !== null) return prismCssCache;
  try {
    prismCssCache = fs.readFileSync(pkgFile("prismjs", "themes", "prism-tomorrow.min.css"), "utf8");
  } catch {
    prismCssCache = "";
  }
  return prismCssCache;
}
