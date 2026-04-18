/**
 * Label-guided income verification for case-study PDFs:
 * - Extract dollar candidates from full text, score by nearby labels (not "largest number wins").
 * - Prefer strong personal-income labels (AGI, annual income, salary, …); reject business / payment lines.
 * - If ambiguous or unsafe → Unable to Determine (conservative by design).
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
 * High-priority personal / wage income labels (weights are relative, not dollars).
 * Regexes run on a whitespace-normalized context so pdf.js spacing quirks still match.
 */
const POSITIVE_RULES = [
  {
    re: /\badjusted\s+gross\s+income\b/i,
    weight: 10,
    displayName: "Adjusted Gross Income",
  },
  { re: /\bannual\s+income\b/i, weight: 8, displayName: "Annual Income" },
  { re: /\bannual\s+salary\b/i, weight: 8, displayName: "Annual Salary" },
  /** Do not match the "Gross Income" tail inside "Adjusted Gross Income". */
  { re: /(?<!adjusted\s)\bgross\s+income\b/i, weight: 8, displayName: "Gross Income" },
  { re: /\btotal\s+income\b/i, weight: 7, displayName: "Total Income" },
  { re: /\bcompensation\b/i, weight: 7, displayName: "Compensation" },
  { re: /\bearnings\b/i, weight: 6, displayName: "Earnings" },
  { re: /\bwages\b/i, weight: 6, displayName: "Wages" },
  { re: /\bsalary\b/i, weight: 6, displayName: "Salary" },
  /** Caution tier — usable, but easier to trigger ambiguity checks vs other strong fields. */
  {
    re: /\btaxable\s+income\b/i,
    weight: 4,
    displayName: "Taxable Income",
    caution: true,
  },
  /** Standalone AGI (skip if full “adjusted gross income” matched). */
  { re: /\bagi\b/i, weight: 8, displayName: "AGI", agiShort: true },
  /** Weak fallback when nothing else matched. */
  {
    re: /\bincome\b/i,
    weight: 2,
    displayName: "income (generic)",
    generic: true,
  },
];

const STRONG_POSITIVE_KEYS = new Set(
  POSITIVE_RULES.filter((r) => !r.generic && !r.caution).map((r) => r.displayName)
);

/** Reject / penalize non-personal-income financial lines (specific phrases before broad “revenue”). */
const NEGATIVE_RULES = [
  { re: /\bbusiness\s+revenue\b/i, weight: 8, label: "business revenue" },
  { re: /\bgross\s+receipts\b/i, weight: 8, label: "gross receipts" },
  { re: /\boperating\s+expenses\b/i, weight: 7, label: "operating expenses" },
  { re: /\bnet\s+profit\b/i, weight: 8, label: "net profit" },
  { re: /\baccount\s+balance\b/i, weight: 6, label: "account balance" },
  { re: /\bbalance\s+due\b/i, weight: 7, label: "balance due" },
  { re: /\bamount\s+due\b/i, weight: 7, label: "amount due" },
  { re: /\btax\s+due\b/i, weight: 7, label: "tax due" },
  { re: /\brefund\b/i, weight: 6, label: "refund" },
  { re: /\bwithheld\b/i, weight: 6, label: "withheld" },
  { re: /\bdeduction\b/i, weight: 5, label: "deduction" },
  { re: /\bdeposit\b/i, weight: 5, label: "deposit" },
  { re: /\bpayment\b/i, weight: 5, label: "payment" },
  { re: /\bmortgage\b/i, weight: 5, label: "mortgage" },
  { re: /\brent\b/i, weight: 4, label: "rent" },
  { re: /\bmonthly\s+income\b/i, weight: 8, label: "monthly income" },
  { re: /\bweekly\s+income\b/i, weight: 8, label: "weekly income" },
  { re: /\bbi-?weekly\s+income\b/i, weight: 8, label: "biweekly income" },
  { re: /\binterest\s+expense\b/i, weight: 5, label: "interest expense" },
  { re: /\bsubtotal\b/i, weight: 4, label: "subtotal" },
  /** Broad — keep after specific “business revenue”. */
  { re: /\brevenue\b/i, weight: 5, label: "revenue" },
];

const ANNUAL_FRAMING = [
  "annual",
  "per year",
  "/yr",
  "yearly",
  "tax year",
  "calendar year",
  "per annum",
];

function getLineAtIndex(fullText, index) {
  const before = fullText.lastIndexOf("\n", Math.max(0, index - 1));
  const after = fullText.indexOf("\n", index);
  const start = before === -1 ? 0 : before + 1;
  const end = after === -1 ? fullText.length : after;
  return fullText.slice(start, end);
}

/**
 * Lines that look like business P&L / receipts without a personal income label — never pick these dollars.
 */
function isBusinessOnlyIncomeLine(line) {
  const hasPersonal =
    /\badjusted\s+gross\s+income\b|\bagi\b|\bannual\s+income\b|\bannual\s+salary\b|\bgross\s+income\b|\btotal\s+income\b|\btaxable\s+income\b|\bsalary\b|\bwages\b|\bearnings\b|\bcompensation\b/i.test(
      line
    );
  if (hasPersonal) return false;
  return /\b(business\s+revenue|gross\s+receipts|net\s+profit|operating\s+expenses|ordinary\s+business)\b/i.test(
    line
  );
}

/**
 * Parse "$162,450.00" / "162,450 USD" style matches into a numeric dollar amount.
 */
function parseMoneyToNumber(rawMatch, numericCapture) {
  const cleaned = numericCapture.replace(/,/g, "");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

function applyStructuralPenalties({ value, raw, fullText, startIndex, endIndex }) {
  let penalty = 0;
  const reasons = [];

  const window = fullText.slice(
    Math.max(0, startIndex - 8),
    Math.min(fullText.length, endIndex + 8)
  );
  if (/%/.test(window)) {
    penalty += 50;
    reasons.push("near-percent-sign");
  }

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

function pickPrimaryLabel(positiveSignals, ruleMatches) {
  if (!ruleMatches.length) return null;
  const sorted = [...ruleMatches].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.displayName.localeCompare(b.displayName);
  });
  return sorted[0].displayName;
}

/**
 * Score a single candidate using keyword hits in a lowercase context window.
 */
export function scoreCandidate(candidate, fullText) {
  const lineText = getLineAtIndex(fullText, candidate.startIndex);
  const lineNorm = squishWhitespace(lineText);
  const lineLower = lineNorm.toLowerCase();

  const ctxRaw = getContextWindow(
    fullText,
    candidate.startIndex,
    candidate.endIndex,
    140
  );

  let score = 0;
  const positiveSignals = [];
  const ruleMatches = [];

  /** Labels are matched on the candidate’s line only so other rows (e.g. revenue vs AGI) do not pollute context. */
  const hasAdjustedGross = /\badjusted\s+gross\s+income\b/i.test(lineLower);

  for (const rule of POSITIVE_RULES) {
    if (rule.generic) continue;
    if (rule.agiShort && hasAdjustedGross) continue;
    if (rule.displayName === "Salary" && /\bannual\s+salary\b/i.test(lineLower)) {
      continue;
    }
    if (!rule.re.test(lineLower)) continue;
    score += rule.weight;
    positiveSignals.push(rule.displayName);
    ruleMatches.push(rule);
  }

  const genericRule = POSITIVE_RULES.find((r) => r.generic);
  if (genericRule) {
    const hasStrong = positiveSignals.some((label) =>
      STRONG_POSITIVE_KEYS.has(label)
    );
    const hasCautionOnly =
      positiveSignals.length > 0 &&
      positiveSignals.every((l) => {
        const r = POSITIVE_RULES.find((x) => x.displayName === l);
        return r && (r.caution || r.generic);
      });
    const isSubannualIncomeLine =
      /\bmonthly\s+income\b/i.test(lineLower) ||
      /\bweekly\s+income\b/i.test(lineLower) ||
      /\bbi-?weekly\s+income\b/i.test(lineLower);
    if (
      (!hasStrong || hasCautionOnly) &&
      genericRule.re.test(lineLower) &&
      !isSubannualIncomeLine
    ) {
      score += genericRule.weight;
      positiveSignals.push(genericRule.displayName);
      ruleMatches.push(genericRule);
    }
  }

  const negativeSignals = [];
  for (const rule of NEGATIVE_RULES) {
    if (!rule.re.test(lineLower)) continue;
    if (rule.label === "interest expense" && /interest\s+income/i.test(lineLower)) {
      continue;
    }
    score -= rule.weight;
    negativeSignals.push(rule.label);
  }

  const { penalty, reasons } = applyStructuralPenalties({
    value: candidate.value,
    raw: candidate.raw,
    fullText,
    startIndex: candidate.startIndex,
    endIndex: candidate.endIndex,
  });
  score -= penalty;

  const hasMonthly = /\bmonthly\b/i.test(lineNorm);
  const hasWeekly = /\bweekly\b/i.test(lineNorm);
  const hasBiweekly = /\bbi-?weekly\b/i.test(lineNorm);
  const hasAnnualFraming = ANNUAL_FRAMING.some((p) => lineLower.includes(p));

  const subAnnualWithoutAnnualFraming =
    (hasMonthly || hasWeekly || hasBiweekly) && !hasAnnualFraming;

  const hardLineReject = isBusinessOnlyIncomeLine(lineText);

  const primaryLabel = pickPrimaryLabel(positiveSignals, ruleMatches);

  const nonGenericRm = ruleMatches.filter((r) => !r.generic);
  let labelWeight = 0;
  if (nonGenericRm.length) {
    labelWeight = Math.max(...nonGenericRm.map((r) => r.weight));
  } else if (ruleMatches.some((r) => r.generic)) {
    const g = POSITIVE_RULES.find((r) => r.generic);
    if (g) labelWeight = g.weight;
  }

  return {
    ...candidate,
    context: squishWhitespace(ctxRaw),
    score,
    positiveSignals,
    negativeSignals,
    monthlyWithoutAnnual: subAnnualWithoutAnnualFraming,
    subAnnualWithoutAnnualFraming,
    structuralReasons: reasons,
    primaryLabel,
    hardLineReject,
    ruleMatches,
    labelWeight,
  };
}

const MIN_ACCEPT_SCORE = 4;
/** When two candidates are this close in score but disagree on $, call it ambiguous. */
const SCORE_TIE_AMBIGUITY = 2;

/**
 * Choose a single best candidate or declare ambiguity / no safe pick.
 */
export function selectIncomeCandidateResolution(scoredCandidates) {
  if (!scoredCandidates.length) {
    return {
      candidate: null,
      ambiguous: false,
      code: "no_candidates",
      filterNote: "no_dollar_candidates",
    };
  }

  const sorted = [...scoredCandidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.startIndex - b.startIndex;
  });

  const viable = sorted.filter(
    (c) =>
      !c.subAnnualWithoutAnnualFraming &&
      !c.hardLineReject &&
      c.score >= MIN_ACCEPT_SCORE
  );

  const best = viable[0];
  if (!best) {
    const top = sorted[0];
    if (top?.subAnnualWithoutAnnualFraming) {
      return {
        candidate: null,
        ambiguous: false,
        code: "subannual_period",
        filterNote: "weekly_monthly_biweekly_without_annual_framing",
        bestAttempt: top,
      };
    }
    if (top?.hardLineReject) {
      return {
        candidate: null,
        ambiguous: false,
        code: "business_line_only",
        filterNote: "only_revenue_or_profit_style_line",
        bestAttempt: top,
      };
    }
    if (top && top.score < MIN_ACCEPT_SCORE) {
      return {
        candidate: null,
        ambiguous: false,
        code: "low_confidence",
        filterNote: "no_label_score_above_threshold",
        bestAttempt: top,
      };
    }
    return {
      candidate: null,
      ambiguous: false,
      code: "no_safe_candidate",
      filterNote: "no_viable_candidate",
      bestAttempt: top,
    };
  }

  if (best.negativeSignals.length && best.positiveSignals.length === 0) {
    return {
      candidate: null,
      ambiguous: false,
      code: "negative_only",
      filterNote: "penalties_without_income_label",
      bestAttempt: best,
    };
  }

  const second = viable[1];
  if (second && best.value !== second.value && second.score >= MIN_ACCEPT_SCORE) {
    const gap = best.score - second.score;
    const bw = best.labelWeight ?? 0;
    const sw = second.labelWeight ?? 0;

    if (gap <= SCORE_TIE_AMBIGUITY) {
      if (bw > sw) {
        return {
          candidate: best,
          ambiguous: false,
          code: "ok",
          filterNote: "label_priority_over_close_scores",
          contenders: [best, second],
        };
      }
      if (sw > bw) {
        return {
          candidate: second,
          ambiguous: false,
          code: "ok",
          filterNote: "label_priority_over_close_scores",
          contenders: [best, second],
        };
      }
      if (gap <= 1) {
        return {
          candidate: null,
          ambiguous: true,
          code: "near_tie_distinct_values",
          filterNote: "same_label_tier_top_two_scores_too_close",
          contenders: [best, second],
        };
      }
      if (second.score >= MIN_ACCEPT_SCORE + 1) {
        return {
          candidate: null,
          ambiguous: true,
          code: "conflicting_income_fields",
          filterNote: "same_label_tier_two_strong_amounts_disagree",
          contenders: [best, second],
        };
      }
    }
  }

  const onlyCaution =
    best.primaryLabel === "Taxable Income" &&
    best.positiveSignals.every((p) => p === "Taxable Income" || p === "income (generic)");

  if (onlyCaution && second && second.score >= MIN_ACCEPT_SCORE && best.value !== second.value) {
    const gap = best.score - second.score;
    if (gap <= 3) {
      return {
        candidate: null,
        ambiguous: true,
        code: "taxable_vs_other_field",
        filterNote: "taxable_income_not_clear_winner",
        contenders: [best, second],
      };
    }
  }

  return {
    candidate: best,
    ambiguous: false,
    code: "ok",
    filterNote: "ok",
    contenders: second ? [best, second] : [best],
  };
}

/**
 * Map chosen candidate → Verified / Not Verified / Unable to Determine.
 */
export function determineIncomeVerification(resolution) {
  const { candidate, ambiguous, code, filterNote } = resolution;

  if (ambiguous) {
    return {
      status: "Unable to Determine",
      value: null,
      formattedValue: "—",
      matchedLabel: null,
      confidence: "none",
      reason:
        "Multiple plausible income values were found with no clear winner; cannot determine the correct figure confidently.",
      detailCode: code,
    };
  }

  if (!candidate) {
    let reason =
      "No dollar amount was found next to a recognized personal income label with sufficient confidence.";
    if (code === "subannual_period") {
      reason =
        "Only weekly, biweekly, or monthly income amounts were found; these are not annualized automatically.";
    } else if (code === "business_line_only") {
      reason =
        "Only revenue- or profit-style fields were found, which are not treated as verified personal income.";
    } else if (code === "low_confidence" || filterNote === "no_label_score_above_threshold") {
      reason =
        "No income field matched strongly enough in context; refusing to guess from unrelated dollar amounts.";
    } else if (code === "negative_only") {
      reason =
        "Dollar amounts appeared next to payment, tax, or expense-style labels rather than personal income.";
    }
    return {
      status: "Unable to Determine",
      value: null,
      formattedValue: "—",
      matchedLabel: null,
      confidence: "none",
      reason,
      detailCode: code,
      bestAttempt: resolution.bestAttempt,
    };
  }

  const label = candidate.primaryLabel || "Selected income";
  const conf =
    label === "Taxable Income" ? "medium" : STRONG_POSITIVE_KEYS.has(label) || label === "AGI"
      ? "high"
      : "medium";

  const matchedPhrase =
    label === "income (generic)"
      ? "a generic income mention"
      : label;

  if (candidate.value > INCOME_THRESHOLD) {
    return {
      status: "Verified",
      value: candidate.value,
      formattedValue: formatUsd(candidate.value),
      matchedLabel: label,
      confidence: conf,
      reason: `Matched ${matchedPhrase}. Amount is above ${formatUsd(INCOME_THRESHOLD)}.`,
      detailCode: "verified",
    };
  }

  return {
    status: "Not Verified",
    value: candidate.value,
    formattedValue: formatUsd(candidate.value),
    matchedLabel: label,
    confidence: conf,
    reason: `Matched ${matchedPhrase}. Amount is at or below ${formatUsd(INCOME_THRESHOLD)}.`,
    detailCode: "not_verified",
  };
}

/** @deprecated Use determineIncomeVerification with full resolution object. */
export function determineVerification(candidate) {
  if (!candidate) {
    return determineIncomeVerification({
      candidate: null,
      ambiguous: false,
      code: "legacy",
    });
  }
  return determineIncomeVerification({
    candidate,
    ambiguous: false,
    code: "ok",
  });
}

/**
 * Full pipeline for the UI: extract dollars → score by labels → select safely → threshold.
 */
export function analyzeIncomeFromText(fullText, options = {}) {
  const text = normalizePdfText(fullText);
  const base = extractCandidateValues(text);
  const scored = base.map((c) => scoreCandidate(c, text));
  const resolution = selectIncomeCandidateResolution(scored);
  const result = determineIncomeVerification(resolution);

  const debug =
    options.debug === true
      ? {
          normalizedLength: text.length,
          normalizedPreview: text.slice(0, 2500),
          selectionResolution: resolution,
          extractionMeta: options.extractionMeta ?? null,
          topScoredCandidates: [...scored]
            .sort((a, b) => b.score - a.score)
            .slice(0, 16),
        }
      : undefined;

  return {
    result,
    candidates: scored,
    chosen: resolution.candidate,
    selectionResolution: resolution,
    debug,
  };
}
