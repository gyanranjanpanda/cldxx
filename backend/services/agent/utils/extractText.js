import fs from "fs";
import path from "path";
import { PDFParse } from "pdf-parse";
import JSZip from "jszip";

const PLAIN_TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".json",
  ".log",
  ".yml",
  ".yaml",
  ".xml",
  ".html",
  ".htm"
]);

const decodeEntities = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

// A .docx is a zip; the body text lives in word/document.xml. Pulling it out
// directly avoids adding a Word-parsing dependency for what is a tag strip.
const extractDocx = async (buffer) => {
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file("word/document.xml");

  if (!entry) throw new Error("not a readable .docx (no word/document.xml)");

  const xml = await entry.async("string");

  return decodeEntities(
    xml
      // Keep paragraph and line breaks as newlines before dropping all markup.
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

/**
 * Pulls plain text out of an uploaded file.
 * Returns { text, kind } where kind is "pdf" | "docx" | "text".
 */
export const extractText = async (file) => {
  const buffer = fs.readFileSync(file.path);
  const ext = path.extname(file.originalname || file.path).toLowerCase();
  const mime = file.mimetype || "";

  if (mime === "application/pdf" || ext === ".pdf") {
    const pdf = new PDFParse({ data: buffer });
    const result = await pdf.getText();
    return { text: (result.text || "").trim(), kind: "pdf" };
  }

  if (
    ext === ".docx" ||
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return { text: await extractDocx(buffer), kind: "docx" };
  }

  if (mime.startsWith("text/") || PLAIN_TEXT_EXTENSIONS.has(ext)) {
    return { text: buffer.toString("utf-8").trim(), kind: "text" };
  }

  // .doc is the old binary format -- a zip reader cannot help there.
  if (ext === ".doc") {
    throw new Error(
      "legacy .doc files aren't supported — please save it as .docx or PDF"
    );
  }

  throw new Error(`unsupported file type (${mime || ext || "unknown"})`);
};
