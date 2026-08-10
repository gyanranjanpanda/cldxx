/**
 * PDF Exporter — Puppeteer-based PDF generation.
 * Extracted from utils/launchBrowser.js as a clean exporter module.
 */

import puppeteer from "puppeteer";
import { bus }   from "../events/bus.js";

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

  browserInstance.on("disconnected", () => {
    browserInstance = null;
  });

  return browserInstance;
}

/**
 * Convert HTML string to PDF buffer.
 * @param {string} html
 * @param {string} [jobId]
 * @returns {Promise<Buffer>}
 */
export async function exportPdf(html, jobId = "") {
  bus.emit("export.started", { jobId, format: "pdf" });

  const browser = await getBrowser();
  const page    = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });

    // Wait for Mermaid diagrams if present
    const hasMermaid = html.includes('class="mermaid"');
    if (hasMermaid) {
      await page.waitForFunction(
        () => !document.querySelector(".mermaid:not([data-processed])"),
        { timeout: 15000 }
      ).catch(() => {
        console.warn("[pdf-exporter] Mermaid render timed out — continuing without diagrams");
      });
    }

    // Wait for Prism to highlight code blocks
    const hasPrism = html.includes("prism");
    if (hasPrism) {
      await page.evaluate(() => {
        if (window.Prism) window.Prism.highlightAll();
      }).catch(() => {});
    }

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });

    bus.emit("export.finished", { jobId, format: "pdf", byteSize: pdfBuffer.length });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}

// Graceful shutdown
async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}

process.on("SIGTERM", closeBrowser);
process.on("SIGINT", closeBrowser);
