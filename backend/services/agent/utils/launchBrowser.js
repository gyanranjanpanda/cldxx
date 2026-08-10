import puppeteer from "puppeteer";

// ─── Singleton browser manager ─────────────────────────────────────────────────

let browserInstance = null;
let launchPromise = null;

const BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--disable-gpu",
  "--font-render-hinting=none",
];

/**
 * Returns a shared Puppeteer Browser instance.
 * Launches one if none exists, reuses it across requests.
 * Automatically recovers from unexpected browser crashes.
 */
export async function getBrowser() {
  if (browserInstance) {
    try {
      // Probe: if the browser process died this will throw
      await browserInstance.version();
      return browserInstance;
    } catch {
      console.warn("[browser] Existing instance unresponsive — restarting.");
      browserInstance = null;
      launchPromise = null;
    }
  }

  if (launchPromise) {
    return launchPromise;
  }

  launchPromise = puppeteer
    .launch({ headless: true, args: BROWSER_ARGS })
    .then((browser) => {
      browserInstance = browser;
      launchPromise = null;

      browser.on("disconnected", () => {
        console.warn("[browser] Browser disconnected. Will relaunch on next request.");
        browserInstance = null;
        launchPromise = null;
      });

      return browser;
    })
    .catch((err) => {
      launchPromise = null;
      throw err;
    });

  return launchPromise;
}

/**
 * Renders an HTML string to a PDF Buffer.
 *
 * @param {string} html         Full self-contained HTML document
 * @param {number} [timeoutMs]  Max render time in milliseconds (default 45s)
 * @returns {Promise<Buffer>}
 */
export async function renderHtmlToPdf(html, timeoutMs = 45_000) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    page.setDefaultTimeout(timeoutMs);

    await page.setContent(html, {
      waitUntil: "networkidle0",
      timeout: timeoutMs,
    });

    // Wait for Mermaid diagrams to finish rendering if present
    if (html.includes("mermaid")) {
      await page
        .waitForFunction(() => {
          const svgs = document.querySelectorAll(".mermaid svg");
          return svgs.length > 0;
        }, { timeout: 15_000 })
        .catch(() => {
          // Non-fatal: diagram rendering timed out, continue without it
          console.warn("[browser] Mermaid render timed out — continuing.");
        });
    }

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      displayHeaderFooter: false,
    });

    return pdfBuffer;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Gracefully shut down the browser (call on process exit).
 */
export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}

// Cleanup on process exit
process.on("exit", () => closeBrowser());
process.on("SIGINT", async () => {
  await closeBrowser();
  process.exit(0);
});
