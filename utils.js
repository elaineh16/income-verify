/**
 * Shared helpers for file validation, currency formatting, and small string utilities.
 * Kept dependency-free so the demo stays easy to reason about in an interview.
 */

/** Maximum reasonable file size for a browser-only demo (10 MB). */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/**
 * Basic PDF validation before handing bytes to pdf.js.
 * Assumption: user uploads a real PDF; we still guard type and size early for UX.
 */
export function validatePdfFile(file) {
  if (!file) {
    return { ok: false, message: "No file selected." };
  }
  const name = file.name || "";
  const typeOk =
    file.type === "application/pdf" ||
    name.toLowerCase().endsWith(".pdf");
  if (!typeOk) {
    return {
      ok: false,
      message: "Please upload a PDF file (.pdf).",
    };
  }
  if (file.size > MAX_PDF_BYTES) {
    return {
      ok: false,
      message: `File is too large (max ${(MAX_PDF_BYTES / (1024 * 1024)).toFixed(0)} MB for this demo).`,
    };
  }
  return { ok: true, message: "" };
}

/** Format a number as USD for display (deterministic, locale "en-US"). */
export function formatUsd(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

/** Collapse whitespace for cleaner context snippets in the UI. */
export function squishWhitespace(str) {
  return str.replace(/\s+/g, " ").trim();
}

/**
 * Build a substring window around an index range in full document text.
 * Used both for scoring and for showing humans what the heuristic "saw".
 */
export function getContextWindow(fullText, startIndex, endIndex, radius = 120) {
  const start = Math.max(0, startIndex - radius);
  const end = Math.min(fullText.length, endIndex + radius);
  return squishWhitespace(fullText.slice(start, end));
}

/**
 * Normalize PDF-derived text so AGI regexes behave the same across browsers / deployments.
 * (Unicode spaces, compatibility characters, odd whitespace from font encodings.)
 */
export function normalizePdfText(str) {
  if (!str) return "";
  return str
    .normalize("NFKC")
    .replace(/[\u00A0\u2007\u202F\uFEFF]/g, " ")
    .replace(/\r\n/g, "\n");
}
