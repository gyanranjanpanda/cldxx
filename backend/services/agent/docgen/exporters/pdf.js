/**
 * PDF Exporter — Puppeteer, with everything served off disk.
 *
 * The old exporter loaded the page with `waitUntil: "networkidle0"` while the
 * HTML pulled Mermaid, Prism and Google Fonts from three different CDNs. Offline
 * or on a slow link that produced a PDF with no diagrams, no syntax colors and
 * fallback typography — and reported success. Now nothing is fetched: fonts are
 * inlined in the HTML, and Mermaid and Prism are injected from node_modules.
 *
 * Page breaks are decided here too, after layout, by the paginator running in the
 * browser where element heights are real. See `renderer/paginate.js`.
 */

import puppeteer from "puppeteer";
import { bus }   from "../events/bus.js";
import { PAGINATOR_SOURCE } from "../renderer/paginate.js";
import { mermaidPath, prismPaths } from "../renderer/assets.js";

let browserInstance = null;

async function getBrowser() {
  if (browserInstance?.isConnected()) return browserInstance;

  browserInstance = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--font-render-hinting=none",
    ],
  });

  browserInstance.on("disconnected", () => { browserInstance = null; });
  return browserInstance;
}

/**
 * Convert HTML to a PDF buffer.
 * @param {string} html
 * @param {string} [jobId]
 * @returns {Promise<Buffer>}
 */
export async function exportPdf(html, jobId = "") {
  bus.emit("export.started", { jobId, format: "pdf" });

  const browser = await getBrowser();
  const page    = await browser.newPage();
  const warnings = [];

  try {
    // `domcontentloaded`, not `networkidle0` — there is no network to idle for,
    // and waiting on one that never settles is how this used to hang.
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.evaluateHandle("document.fonts.ready");

    const needsPrism   = await page.evaluate(() => document.body.dataset.needsPrism === "true");
    const needsMermaid = await page.evaluate(() => document.body.dataset.needsMermaid === "true");

    // ── Syntax highlighting ────────────────────────────────────────────────
    if (needsPrism) {
      const prism = prismPaths();
      if (prism) {
        await page.addScriptTag({ path: prism.core });
        for (const c of prism.components) await page.addScriptTag({ path: c });
        await page.evaluate(() => window.Prism?.highlightAll());
      } else {
        warnings.push("prism unavailable — code rendered unhighlighted");
      }
    }

    // ── Diagrams ───────────────────────────────────────────────────────────
    if (needsMermaid) {
      const mmd = mermaidPath();
      if (mmd) {
        await page.addScriptTag({ path: mmd });
        const rendered = await page.evaluate(async () => {
          if (!window.mermaid) return false;
          const d = document.body.dataset;
          window.mermaid.initialize({
            startOnLoad: false,
            theme: "base",
            fontFamily: "Inter, system-ui, sans-serif",
            themeVariables: {
              primaryColor:     d.surface,
              primaryTextColor: d.ink,
              primaryBorderColor: d.accent,
              lineColor:        d.muted,
              secondaryColor:   d.surface,
              tertiaryColor:    d.surface,
            },
          });
          try {
            await window.mermaid.run({ querySelector: ".mermaid" });
            return true;
          } catch (e) {
            console.warn("mermaid run failed", e);
            return false;
          }
        });

        if (!rendered) warnings.push("mermaid failed — diagrams omitted");
      } else {
        warnings.push("mermaid unavailable — diagrams omitted");
      }
    }

    // ── Measured pagination ────────────────────────────────────────────────
    // Runs last: diagrams and highlighted code must have their final heights
    // before anything decides where a page ends.
    const { pages } = await page.evaluate(PAGINATOR_SOURCE);

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });

    if (warnings.length) console.warn(`[pdf-exporter] ${warnings.join("; ")}`);
    bus.emit("export.finished", {
      jobId, format: "pdf", byteSize: pdfBuffer.length, pages, warnings,
    });

    const out = Buffer.from(pdfBuffer);
    out.pageCount = pages;
    return out;
  } finally {
    await page.close();
  }
}

async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}

process.on("SIGTERM", closeBrowser);
process.on("SIGINT", closeBrowser);
