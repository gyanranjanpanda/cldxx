import PQueue from "p-queue";
import PDFDocument from "pdfkit";
import { renderHtmlToPdf } from "./launchBrowser.js";
import { renderPdfHtml } from "./renderPdfHtml.js";

// ─── Concurrency limits ────────────────────────────────────────────────────────
// Cap concurrent Puppeteer renders to avoid memory pressure.
// Each render holds a browser page (~50–150MB) until complete.

const pdfQueue = new PQueue({ concurrency: 3 });

/**
 * Queue a PDF render job.
 * Returns a Buffer of the generated PDF.
 *
 * Falls back to PDFKit if Puppeteer fails, so the user always gets *something*.
 *
 * @param {import("../schemas/document.schema.js").DocumentSchema} doc
 * @returns {Promise<Buffer>}
 */
export async function enqueuePdfRender(doc) {
  return pdfQueue.add(() => renderWithFallback(doc));
}

/** @returns {Promise<Buffer>} */
async function renderWithFallback(doc) {
  try {
    const html = renderPdfHtml(doc);
    return await renderHtmlToPdf(html);
  } catch (puppeteerError) {
    console.error("[pdfQueue] Puppeteer render failed — falling back to PDFKit:", puppeteerError.message);
    return renderWithPdfKit(doc);
  }
}

// ─── PDFKit fallback ───────────────────────────────────────────────────────────
// Plain but functional. Used when Puppeteer is unavailable (restricted
// environments, memory pressure, crash) or during local development without
// a Chrome binary.

function renderWithPdfKit(doc) {
  return new Promise((resolve, reject) => {
    const pdfDoc = new PDFDocument({
      size: "A4",
      margin: 60,
      bufferPages: true,
      info: {
        Title: doc.title,
        Author: "cldxAI",
        Creator: "cldxAI PDF Agent (fallback)",
      },
    });

    const chunks = [];
    pdfDoc.on("data", (chunk) => chunks.push(chunk));
    pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
    pdfDoc.on("error", reject);

    // Cover
    pdfDoc
      .fontSize(26)
      .fillColor("#111827")
      .text(doc.title, { align: "center" });

    if (doc.subtitle) {
      pdfDoc.moveDown(0.5);
      pdfDoc.fontSize(14).fillColor("#6B7280").text(doc.subtitle, { align: "center" });
    }

    pdfDoc.moveDown(0.5);
    pdfDoc
      .fontSize(10)
      .fillColor("#9CA3AF")
      .text(`Generated on ${new Date().toLocaleString()}`, { align: "center" });

    // Sections
    for (const section of doc.sections) {
      pdfDoc.addPage();

      if (section.title) {
        pdfDoc.fontSize(18).fillColor("#1E293B").text(section.title);
        pdfDoc.moveDown(0.5);
      }

      switch (section.type) {
        case "text":
          for (const para of section.paragraphs) {
            pdfDoc.fontSize(12).fillColor("#374151").text(decodeHtmlEntities(para), { lineGap: 5 });
            pdfDoc.moveDown(0.5);
          }
          break;

        case "bullets":
          for (const item of section.items) {
            pdfDoc
              .fontSize(12)
              .fillColor("#374151")
              .text(`• ${decodeHtmlEntities(item)}`, { lineGap: 4 });
          }
          break;

        case "stats":
          for (const stat of section.items) {
            pdfDoc
              .fontSize(22)
              .fillColor("#2563EB")
              .text(decodeHtmlEntities(stat.value), { continued: true });
            pdfDoc.fontSize(12).fillColor("#64748B").text(`  ${decodeHtmlEntities(stat.label)}`);
            pdfDoc.moveDown(0.4);
          }
          break;

        case "table":
          pdfDoc
            .fontSize(11)
            .fillColor("#374151")
            .text(section.columns.map(decodeHtmlEntities).join(" | "));
          pdfDoc.moveDown(0.3);
          for (const row of section.rows) {
            pdfDoc.text(row.map(decodeHtmlEntities).join(" | "));
          }
          break;

        case "quote":
          pdfDoc
            .fontSize(14)
            .fillColor("#1E293B")
            .text(`"${decodeHtmlEntities(section.text)}"`, { oblique: true });
          if (section.source) {
            pdfDoc.moveDown(0.3);
            pdfDoc.fontSize(11).fillColor("#2563EB").text(`— ${decodeHtmlEntities(section.source)}`);
          }
          break;

        case "conclusion":
          for (const point of section.points) {
            pdfDoc
              .fontSize(13)
              .fillColor("#1E293B")
              .text(`✓ ${decodeHtmlEntities(point)}`, { lineGap: 4 });
          }
          break;

        case "diagram":
          pdfDoc
            .fontSize(11)
            .fillColor("#64748B")
            .text("[Diagram — rendered in Puppeteer version]");
          break;
      }
    }

    // Footer
    const pageRange = pdfDoc.bufferedPageRange();
    for (let i = 0; i < pageRange.count; i++) {
      pdfDoc.switchToPage(pageRange.start + i);
      pdfDoc
        .fontSize(9)
        .fillColor("#9CA3AF")
        .text(
          `cldxAI · Page ${i + 1} of ${pageRange.count}`,
          60,
          pdfDoc.page.height - 40,
          { align: "center" }
        );
    }

    pdfDoc.end();
  });
}

// Reverse the HTML-escaping applied by Zod schema for PDFKit plain text output
function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

/** How many PDF jobs are currently waiting or running */
export const queueSize = () => pdfQueue.size + pdfQueue.pending;
