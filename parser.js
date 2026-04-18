/**
 * PDF text extraction using Mozilla pdf.js (ES module from jsDelivr).
 * This file is used to extract the text from the PDF file.
 */

import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/+esm";
import { squishWhitespace, normalizePdfText } from "./utils.js";

/** Keep in sync with the import URL above (avoids worker/API mismatch). */
const PDFJS_VERSION = "4.6.82";

// Worker URL must match pdfjs-dist version exactly — dynamic from version constant.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

/**
 * Cluster text items into horizontal lines, then sort lines top-to-bottom and items left-to-right.
 * @param {Array<{ str: string, transform: number[], height?: number }>} items
 */
function pageTextFromItems(items) {
  if (!items || items.length === 0) return "";

  const heights = items.map((it) => {
    const h = it.height;
    if (typeof h === "number" && h > 0) return h;
    const scaleY = it.transform?.[3];
    return Math.abs(typeof scaleY === "number" ? scaleY : 12);
  });
  const medianH = heights.sort((a, b) => a - b)[Math.floor(heights.length / 2)] || 12;
  const lineTol = Math.max(medianH * 0.65, 4);

  /** @type {{ y: number, parts: typeof items }[]} */
  const lines = [];

  for (const it of items) {
    if (!it.str) continue;
    if (!it.transform || it.transform.length < 6) continue;
    const y = it.transform[5];
    let line = lines.find((l) => Math.abs(l.y - y) < lineTol);
    if (!line) {
      line = { y, parts: [] };
      lines.push(line);
    }
    line.parts.push(it);
  }

  lines.sort((a, b) => b.y - a.y);
  for (const line of lines) {
    line.parts.sort((a, b) => a.transform[4] - b.transform[4]);
  }

  return lines.map((line) => line.parts.map((p) => p.str).join(" ")).join("\n");
}

/**
 * Read a File as ArrayBuffer (pdf.js accepts raw bytes).
 */
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Extract plain text from every page with stable reading order.
 * @param {File} file
 * @returns {Promise<{ fullText: string, pages: { pageNumber: number, text: string }[], meta: object }>}
 */
export async function extractPdfText(file) {
  const data = await readFileAsArrayBuffer(file);
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(data),
    verbosity: 0,
  });
  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (e) {
    throw new Error("Unreadable or corrupted PDF.");
  }

  const pages = [];
  let fullText = "";
  const workerSrc = pdfjsLib.GlobalWorkerOptions.workerSrc;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = normalizePdfText(pageTextFromItems(textContent.items));
    pages.push({ pageNumber, text: pageText });
    fullText += `${pageText}\n`;
  }

  fullText = normalizePdfText(fullText);

  if (!squishWhitespace(fullText)) {
    throw new Error(
      "No readable text found. Scanned PDFs are not supported without OCR."
    );
  }

  const meta = {
    pdfjsVersion: pdfjsLib.version || PDFJS_VERSION,
    workerSrc,
    workerPinnedVersion: PDFJS_VERSION,
    pageCount: pdf.numPages,
    fullTextLength: fullText.length,
  };

  return { fullText, pages, meta };
}
