/**
 * Income verification is **AGI-only** (Adjusted Gross Income):
 * - Parse a dollar amount anchored to an "Adjusted Gross Income (AGI)" style label.
 * - Verified if AGI > threshold; Not Verified if AGI ≤ threshold.
 * - If AGI cannot be found unambiguously → Unable to Determine (no fallback to revenue / taxable income).
 *
 * We still list heuristic-scored dollar candidates in debug output for transparency.
 */

import {
  getContextWindow,
  squishWhitespace,
  formatUsd,
  normalizePdfText,
} from "./utils.js";

/** $150k threshold per product spec (inclusive boundary on the low side). */
export const INCOME_THRESHOLD = 150_000;

/**
 * Strict label → amount: only the $ figure immediately tied to this phrase counts as AGI.
 * (A wide "context window" heuristic falsely scores every $ on the same line—this regex avoids that.)
 */
const RE_AGI_DOLLAR =
  /Adjusted\s+Gross\s+Income\s*(?:\(\s*AGI\s*\))?\s*[:#–—]?\s*\$\s*([\d,]+(?:\.\d{1,2})?)/gi;

/** Fallback: "AGI:" on its own line (still requires $ for safety). */
const RE_AGI_SHORT = /\bAGI\b\s*[:#–—]?\s*\$\s*([\d,]+(?:\.\d{1,2})?)/gi;

/** Lines that look like non-AGI rows (revenue, taxable income, etc.) — reject unless AGI phrase is on the same line. */
function lineFailsNonAgiRow(line) {
  const L = line.trim().toLowerCase();
  if (!L) return true;
  if (L.includes("adjusted gross income")) return false;
  if (L.startsWith("taxable income")) return true;
  if (/(^|\b)(business\s+revenue|gross\s+receipts|total\s+revenue|net\s+business\s+income|ordinary\s+business)\b/i.test(L)) {
    return true;
  }
  return false;
}

/** Standalone "AGI: $…" — allow only if the line is not clearly another tax line. */
function lineAllowsShortAgiFallback(line) {
  const L = line.toLowerCase();
  if (L.includes("adjusted gross income")) return true;
  if (/(revenue|receipts|gross\s+sales|taxable\s+income|net\s+profit|estimate|sch(\.|edule)\s*c\b)/i.test(L)) {
    return false;
  }
  return /\bagi\b/.test(L);
}

function getLineAtIndex(fullText, index) {
  const before = fullText.lastIndexOf("\n", Math.max(0, index - 1));
  const after = fullText.indexOf("\n", index);
  const start = before === -1 ? 0 : before + 1;
  const end = after === -1 ? fullText.length : after;
  return fullText.slice(start, end);
}

function collectRegexMatches(fullText, re, sourceTag) {
  const matches = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(fullText)) !== null) {
    const full = m[0];
    const idxDollar = full.indexOf("$");
    if (idxDollar < 0) continue;
    const raw = full.slice(idxDollar);
    const value = parseMoneyToNumber(raw, m[1]);
    if (value === null) continue;
    const startIndex = m.index + idxDollar;
    const endIndex = startIndex + raw.length;
    const line = getLineAtIndex(fullText, m.index);
    matches.push({
      value,
      raw,
      startIndex,
      endIndex,
      labelSnippet: squishWhitespace(full.slice(0, Math.min(full.length, 72))),
      source: sourceTag,
      lineText: line,
    });
  }
  return matches;
}

/**
 * Extract every AGI-labeled dollar amount (primary; short only if no primary — mirrors selection).
 */
export function extractAgiMatches(fullText) {
  const text = normalizePdfText(fullText);
  const primary = collectRegexMatches(text, RE_AGI_DOLLAR, "primary");
  if (primary.length) return primary;
  return collectRegexMatches(text, RE_AGI_SHORT, "short");
}

/**
 * Filter + rank AGI matches — does **not** use largest dollar amount as a signal.
 * Short "AGI: $…" is used only when **no** primary `Adjusted Gross Income` hits exist at all.
 * If primary hits exist but every line is rejected → Unable (prefer caution over short-fallback).
 */
function filterAndRankAgiMatches(primaryList, shortList) {
  const keptPrimary = primaryList.filter((m) => !lineFailsNonAgiRow(m.lineText));

  if (keptPrimary.length) {
    return {
      used: keptPrimary,
      rejected: primaryList.filter((m) => !keptPrimary.includes(m)),
      mode: "primary",
    };
  }

  if (primaryList.length > 0) {
    return {
      used: [],
      rejected: primaryList,
      mode: "primary-rejected-unsafe",
    };
  }

  const keptShort = shortList.filter((m) => lineAllowsShortAgiFallback(m.lineText));
  return {
    used: keptShort,
    rejected: shortList.filter((m) => !keptShort.includes(m)),
    mode: "short-fallback",
  };
}

/**
 * Deterministic tie-break: prefer **earliest document offset** (reading order after parser fix), not max value.
 */
function pickCanonicalMatch(used) {
  if (!used.length) return null;
  const byPosition = [...used].sort((a, b) => a.startIndex - b.startIndex);
  const values = [...new Set(byPosition.map((m) => m.value))];
  if (values.length > 1) return { ambiguous: true, choice: null };
  const value = values[0];
  const sameVal = byPosition.filter((m) => m.value === value);
  sameVal.sort((a, b) => {
    if (a.source !== b.source) return a.source === "primary" ? -1 : 1;
    return a.startIndex - b.startIndex;
  });
  return { ambiguous: false, choice: sameVal[0] };
}

/**
 * Pick a single AGI figure, or null if none / conflicting values.
 */
export function selectAgiCandidate(fullText, options = {}) {
  const text = normalizePdfText(fullText);
  const primary = collectRegexMatches(text, RE_AGI_DOLLAR, "primary");
  const short = collectRegexMatches(text, RE_AGI_SHORT, "short");
  const { used, rejected, mode } = filterAndRankAgiMatches(primary, short);

  if (!used.length) {
    return {
      candidate: null,
      ambiguous: false,
      matches: [...primary, ...short],
      rejected,
      selectionMode: mode,
      filterNote:
        mode === "primary-rejected-unsafe"
          ? "primary_lines_rejected_not_using_short_fallback"
          : "no_match_after_line_filter",
    };
  }

  const distinct = new Set(used.map((x) => x.value));
  if (distinct.size > 1) {
    return {
      candidate: null,
      ambiguous: true,
      matches: used,
      rejected,
      selectionMode: mode,
      filterNote: "multiple_distinct_agi_values",
    };
  }

  const picked = pickCanonicalMatch(used);
  if (picked.ambiguous) {
    return {
      candidate: null,
      ambiguous: true,
      matches: used,
      rejected,
      selectionMode: mode,
      filterNote: "tie_break_failed",
    };
  }

  const m = picked.choice;
  const candidate = {
    raw: m.raw,
    value: m.value,
    startIndex: m.startIndex,
    endIndex: m.endIndex,
    context: getContextWindow(text, m.startIndex, m.endIndex),
    score: 100,
    positiveSignals: ["Adjusted Gross Income (AGI)"],
    negativeSignals: [],
    monthlyWithoutAnnual: false,
    structuralReasons: [],
    source: m.source === "primary" ? "agi-label-regex" : "agi-short-fallback",
  };

  return {
    candidate,
    ambiguous: false,
    matches: used,
    rejected,
    selectionMode: mode,
    filterNote: "ok",
  };
}

/**
 * Weighted positive signals (longer phrases first to prefer specific labels).
 * We intentionally keep "income" lower-weight because it appears in many non-salary lines.
 */
const POSITIVE_RULES = [
  { phrase: "adjusted gross income", weight: 6, label: "adjusted gross income" },
  { phrase: "taxable income", weight: 5, label: "taxable income" },
  { phrase: "gross income", weight: 5, label: "gross income" },
  { phrase: "annual income", weight: 5, label: "annual income" },
  { phrase: "total income", weight: 4, label: "total income" },
  { phrase: "compensation", weight: 4, label: "compensation" },
  { phrase: "earnings", weight: 3, label: "earnings" },
  { phrase: "wages", weight: 3, label: "wages" },
  { phrase: "salary", weight: 3, label: "salary" },
  // "agi" is short; require word boundaries via includes check on padded text
  { phrase: " agi ", weight: 5, label: "AGI" },
  /** Last-resort label match: only applied if no stronger income label hit (see scoreCandidate). */
  { phrase: "income", weight: 2, label: "income (generic)", generic: true },
];

const STRONG_POSITIVE_LABELS = new Set(
  POSITIVE_RULES.filter((r) => !r.generic).map((r) => r.label)
);

const NEGATIVE_RULES = [
  { phrase: "balance due", weight: 6, label: "balance due" },
  { phrase: "amount due", weight: 6, label: "amount due" },
  { phrase: "tax due", weight: 6, label: "tax due" },
  { phrase: "interest paid", weight: 5, label: "interest paid" },
  { phrase: "withheld", weight: 5, label: "withheld" },
  { phrase: "deduction", weight: 4, label: "deduction" },
  { phrase: "mortgage", weight: 4, label: "mortgage" },
  { phrase: "refund", weight: 5, label: "refund" },
  { phrase: "payment", weight: 4, label: "payment" },
  { phrase: "deposit", weight: 4, label: "deposit" },
  { phrase: "subtotal", weight: 4, label: "subtotal" },
  { phrase: "rent", weight: 3, label: "rent" },
  { phrase: "biweekly", weight: 5, label: "biweekly" },
  { phrase: "weekly", weight: 4, label: "weekly" },
  { phrase: "monthly", weight: 5, label: "monthly" },
];

/** If monthly appears without explicit annual framing, we refuse to treat it as annual income. */
const ANNUAL_FRAMING = [
  "annual",
  "per year",
  "/yr",
  "yearly",
  "tax year",
  "calendar year",
];

/**
 * Parse "$162,450.00" / "162,450 USD" style matches into a numeric dollar amount.
 */
function parseMoneyToNumber(rawMatch, numericCapture) {
  const cleaned = numericCapture.replace(/,/g, "");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Quick filters for obvious non-income literals (still conservative).
 */
function applyStructuralPenalties({ value, raw, fullText, startIndex, endIndex }) {
  let penalty = 0;
  const reasons = [];

  // Percentages near the match (e.g., "15.3 %")
  const window = fullText.slice(
    Math.max(0, startIndex - 8),
    Math.min(fullText.length, endIndex + 8)
  );
  if (/%/.test(window)) {
    penalty += 50;
    reasons.push("near-percent-sign");
  }

  // Looks like a tax year (common on forms) — only when it smells like a year label
  const intVal = Math.round(value);
  if (
    Number.isInteger(value) &&
    intVal >= 1900 &&
    intVal <= 2100 &&
    !raw.includes("$")
  ) {
    const ctx = getContextWindow(fullText, startIndex, endIndex, 80).toLowerCase();
    const yearish =
      /(tax year|fiscal year|calendar year|for year|year ended|ending december|dec\.?\s*\d{1,2},?\s*\d{4})/i.test(
        ctx
      );
    if (yearish) {
      penalty += 40;
      reasons.push("likely-tax-year");
    }
  }

  return { penalty, reasons };
}

/**
 * Walk full extracted PDF text and collect currency-like candidates with context.
 */
export function extractCandidateValues(fullText) {
  const candidates = [];
  const text = fullText;

  // Primary: $12,345.67
  const reDollar = /\$\s*([\d,]+(?:\.\d{1,2})?)/g;
  let m;
  while ((m = reDollar.exec(text)) !== null) {
    const raw = m[0];
    const value = parseMoneyToNumber(raw, m[1]);
    if (value === null) continue;
    const startIndex = m.index;
    const endIndex = m.index + raw.length;
    candidates.push({
      raw,
      value,
      context: getContextWindow(text, startIndex, endIndex),
      startIndex,
      endIndex,
    });
  }

  // Secondary: 12,345 USD
  const reUsd = /\b([\d,]+(?:\.\d{1,2})?)\s*(?:USD|US\s*DOLLARS?)\b/gi;
  while ((m = reUsd.exec(text)) !== null) {
    const raw = m[0];
    const value = parseMoneyToNumber(raw, m[1]);
    if (value === null) continue;
    const startIndex = m.index;
    const endIndex = m.index + raw.length;
    candidates.push({
      raw,
      value,
      context: getContextWindow(text, startIndex, endIndex),
      startIndex,
      endIndex,
    });
  }

  // De-dupe identical positions (regex overlap)
  const seen = new Set();
  const unique = [];
  for (const c of candidates) {
    const key = `${c.startIndex}:${c.endIndex}:${c.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }

  return unique;
}

/**
 * Score a single candidate using keyword hits in a lowercase context window.
 * @returns {object} candidate enriched with score + signal lists + flags
 */
export function scoreCandidate(candidate, fullText) {
  const ctxRaw = getContextWindow(
    fullText,
    candidate.startIndex,
    candidate.endIndex,
    140
  );
  const ctx = ` ${ctxRaw.toLowerCase()} `;

  let score = 0;
  const positiveSignals = [];
  const negativeSignals = [];

  for (const rule of POSITIVE_RULES) {
    if (rule.generic) continue;
    const needle = ` ${rule.phrase.trim()} `;
    if (ctx.includes(needle)) {
      score += rule.weight;
      positiveSignals.push(rule.label);
    }
  }

  // Generic "income" is noisy ("tax due", "interest income", etc.) — use only as a weak fallback.
  const genericIncomeRule = POSITIVE_RULES.find((r) => r.generic);
  if (genericIncomeRule) {
    const hasStrong = positiveSignals.some((label) =>
      STRONG_POSITIVE_LABELS.has(label)
    );
    const needle = ` ${genericIncomeRule.phrase.trim()} `;
    if (!hasStrong && ctx.includes(needle)) {
      score += genericIncomeRule.weight;
      positiveSignals.push(genericIncomeRule.label);
    }
  }

  for (const rule of NEGATIVE_RULES) {
    const needle = ` ${rule.phrase.trim()} `;
    if (ctx.includes(needle)) {
      score -= rule.weight;
      negativeSignals.push(rule.label);
    }
  }

  const { penalty, reasons } = applyStructuralPenalties({
    value: candidate.value,
    raw: candidate.raw,
    fullText,
    startIndex: candidate.startIndex,
    endIndex: candidate.endIndex,
  });
  score -= penalty;

  // Monthly income: do not silently annualize; heavily penalize unless annual framing exists.
  // Use a tighter window so unrelated "monthly" mentions elsewhere on the line do not taint annual totals.
  const tightCtx = getContextWindow(
    fullText,
    candidate.startIndex,
    candidate.endIndex,
    70
  );
  const hasMonthly = /\bmonthly\b/i.test(tightCtx);
  const hasAnnualFraming = ANNUAL_FRAMING.some((p) =>
    tightCtx.toLowerCase().includes(p)
  );
  let monthlyWithoutAnnual = false;
  if (hasMonthly && !hasAnnualFraming) {
    score -= 25;
    monthlyWithoutAnnual = true;
    negativeSignals.push("monthly (no explicit annual framing)");
  }

  return {
    ...candidate,
    context: squishWhitespace(ctxRaw),
    score,
    positiveSignals,
    negativeSignals,
    monthlyWithoutAnnual,
    structuralReasons: reasons,
  };
}

/**
 * Pick a single best candidate or return null if confidence is too low / ambiguous.
 */
export function selectIncomeCandidate(scoredCandidates) {
  if (!scoredCandidates.length) return null;

  const sorted = [...scoredCandidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Deterministic tie-breaker for stable demos (not "pick the richest person")
    return a.startIndex - b.startIndex;
  });

  const best = sorted[0];

  // Hard reject: monthly figure without explicit annual framing
  if (best.monthlyWithoutAnnual) {
    return null;
  }

  // Minimum score gate (tuned for a case study — favors caution)
  const MIN_ACCEPT_SCORE = 4;
  if (best.score < MIN_ACCEPT_SCORE) {
    return null;
  }

  // Ambiguity: two strong interpretations close together
  const second = sorted[1];
  if (second && second.score >= MIN_ACCEPT_SCORE && best.score - second.score <= 1) {
    return null;
  }

  // If negatives outweigh positives for the top pick, bail out
  if (best.negativeSignals.length && best.positiveSignals.length === 0) {
    return null;
  }

  return best;
}

/**
 * Map AGI candidate to Verified / Not Verified / Unable to Determine.
 * @param {{ candidate: object | null, ambiguous: boolean }} agiResolution
 */
export function determineAgiVerification(agiResolution) {
  const { candidate, ambiguous, filterNote } = agiResolution;

  if (ambiguous) {
    return {
      status: "Unable to Determine",
      value: null,
      formattedValue: "—",
      reason:
        "Multiple different Adjusted Gross Income (AGI) amounts were found; cannot pick one safely.",
      confidence: "none",
    };
  }

  if (!candidate) {
    let reason =
      "No Adjusted Gross Income (AGI) dollar amount was found next to a recognized AGI label.";
    if (filterNote === "primary_lines_rejected_not_using_short_fallback") {
      reason =
        "Adjusted Gross Income labels were present but each matching line looked like a non-AGI row (for example revenue or receipts); refusing to substitute a different line.";
    }
    return {
      status: "Unable to Determine",
      value: null,
      formattedValue: "—",
      reason,
      confidence: "none",
    };
  }

  const confidence = "high";
  if (candidate.value > INCOME_THRESHOLD) {
    return {
      status: "Verified",
      value: candidate.value,
      formattedValue: formatUsd(candidate.value),
      reason: `AGI (${formatUsd(candidate.value)}) is above ${formatUsd(INCOME_THRESHOLD)}.`,
      confidence,
    };
  }

  return {
    status: "Not Verified",
    value: candidate.value,
    formattedValue: formatUsd(candidate.value),
    reason: `AGI (${formatUsd(candidate.value)}) is at or below ${formatUsd(INCOME_THRESHOLD)}.`,
    confidence,
  };
}

/**
 * @deprecated Use determineAgiVerification for product logic; kept for unit-style reuse of scoring path.
 */
export function determineVerification(candidate) {
  return determineAgiVerification({
    candidate,
    ambiguous: false,
  });
}

/**
 * Convenience pipeline used by the UI layer.
 * Decision uses **AGI only**; `candidates` remain heuristic-scored for the debug panel.
 * @param {object} [options]
 * @param {boolean} [options.debug] — include `debug` payload (also log from app when `?debug=1`)
 * @param {object} [options.extractionMeta] — pdf.js metadata from `extractPdfText` (worker URL, page count)
 */
export function analyzeIncomeFromText(fullText, options = {}) {
  const text = normalizePdfText(fullText);
  const agiResolution = selectAgiCandidate(text, options);
  const result = determineAgiVerification(agiResolution);

  const base = extractCandidateValues(text);
  const scored = base.map((c) => scoreCandidate(c, text));

  const debug =
    options.debug === true
      ? {
          normalizedLength: text.length,
          normalizedPreview: text.slice(0, 2500),
          agiResolution,
          extractionMeta: options.extractionMeta ?? null,
          topScoredCandidates: [...scored]
            .sort((a, b) => b.score - a.score)
            .slice(0, 12),
        }
      : undefined;

  return {
    result,
    candidates: scored,
    chosen: agiResolution.candidate,
    agiResolution,
    debug,
  };
}
