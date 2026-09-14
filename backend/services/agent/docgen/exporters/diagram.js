/**
 * Mermaid → PNG rasterizer.
 *
 * PowerPoint has no Mermaid renderer, so a diagram section heading for a deck
 * would otherwise have to degrade into a bullet list — which is exactly the
 * "dump the text" failure this work is undoing. Instead the diagram is rendered
 * in the same headless browser the PDF exporter uses and embedded as an image.
 *
 * Rendered at 3× and downscaled by PowerPoint, so it stays crisp on a projector.
 */

import puppeteer from "puppeteer";
import { mermaidPath } from "../renderer/assets.js";

let browserInstance = null;

async function getBrowser() {
  if (browserInstance?.isConnected()) return browserInstance;
  browserInstance = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  browserInstance.on("disconnected", () => { browserInstance = null; });
  return browserInstance;
}

/**
 * Rasterize Mermaid sources in one batch — one browser page for all of them.
 * @param {string[]} sources — Mermaid DSL strings
 * @param {{ accent?: string, ink?: string, muted?: string, surface?: string, bg?: string }} [theme]
 * @returns {Promise<(({ dataUrl: string, width: number, height: number })|null)[]>}
 *          Positionally matched to `sources`; null where rendering failed.
 */
export async function rasterizeDiagrams(sources, theme = {}) {
  if (!sources.length) return [];

  const mmd = mermaidPath();
  if (!mmd) {
    console.warn("[diagram] mermaid unavailable — diagrams will be omitted from the deck");
    return sources.map(() => null);
  }

  const {
    accent  = "#2563EB",
    ink     = "#1E293B",
    muted   = "#64748B",
    surface = "#F8FAFC",
    bg      = "#FFFFFF",
  } = theme;

  const browser = await getBrowser();
  const page    = await browser.newPage();

  try {
    await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 3 });
    await page.setContent(
      `<!DOCTYPE html><html><head><style>
        body { margin:0; background:${bg}; font-family: system-ui, sans-serif; }
        .d { display:inline-block; padding:24px; }
      </style></head><body></body></html>`,
      { waitUntil: "domcontentloaded" },
    );
    await page.addScriptTag({ path: mmd });

    await page.evaluate((a, i, m, s) => {
      window.mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        fontFamily: "Inter, system-ui, sans-serif",
        themeVariables: {
          primaryColor: s, primaryTextColor: i, primaryBorderColor: a,
          lineColor: m, secondaryColor: s, tertiaryColor: s,
        },
      });
    }, accent, ink, muted, surface);

    const results = [];
    for (let idx = 0; idx < sources.length; idx++) {
      try {
        const box = await page.evaluate(async (src, id) => {
          const host = document.createElement("div");
          host.className = "d";
          host.id = `d${id}`;
          document.body.innerHTML = "";
          document.body.appendChild(host);

          const { svg } = await window.mermaid.render(`m${id}`, src);
          host.innerHTML = svg;

          const el = host.querySelector("svg");
          if (!el) return null;
          // Mermaid emits a percentage width by default, which screenshots badly.
          el.removeAttribute("style");
          el.style.maxWidth = "none";
          const vb = el.viewBox?.baseVal;
          if (vb?.width) { el.setAttribute("width", vb.width); el.setAttribute("height", vb.height); }

          const r = host.getBoundingClientRect();
          return { x: r.x, y: r.y, width: Math.ceil(r.width), height: Math.ceil(r.height) };
        }, sources[idx], idx);

        if (!box || box.width < 4 || box.height < 4) { results.push(null); continue; }

        const shot = await page.screenshot({
          clip: { x: box.x, y: box.y, width: box.width, height: box.height },
          omitBackground: false,
          type: "png",
          encoding: "base64",
        });

        results.push({
          dataUrl: `image/png;base64,${shot}`,
          width:  box.width,
          height: box.height,
        });
      } catch (err) {
        console.warn(`[diagram] Failed to render diagram ${idx}: ${err.message}`);
        results.push(null);
      }
    }

    return results;
  } finally {
    await page.close();
  }
}

export async function closeDiagramBrowser() {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}

process.on("SIGTERM", closeDiagramBrowser);
process.on("SIGINT", closeDiagramBrowser);
