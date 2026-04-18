/**
 * UI wired to match design/app/page.tsx: card layout, dropzone, file row + Verify, results card.
 */

import { extractPdfText } from "./parser.js";
import { analyzeIncomeFromText } from "./verifier.js";
import { validatePdfFile, formatUsd } from "./utils.js";

/** Append `?debug=1` to the URL for console + JSON diagnostics (pdf.js meta, text preview, AGI resolution). */
const DEBUG =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("debug") === "1";

const ICONS = {
  verified: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`,
  notVerified: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`,
  undetermined: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
};

const els = {
  app: document.getElementById("app"),
  fileInput: document.getElementById("file-input"),
  dropzone: document.getElementById("dropzone"),
  fileRow: document.getElementById("file-row"),
  fileName: document.getElementById("file-name"),
  verifyBtn: document.getElementById("verify-btn"),
  clearBtn: document.getElementById("clear-btn"),
  uploadError: document.getElementById("upload-error"),
  resultsCard: document.getElementById("results-card"),
  resultsLoading: document.getElementById("results-loading"),
  resultsBody: document.getElementById("results-body"),
  uploadFilename: document.getElementById("upload-filename"),
  extractedIncome: document.getElementById("extracted-income"),
  decisionWrap: document.getElementById("decision-wrap"),
  decisionIcon: document.getElementById("decision-icon"),
  finalDecision: document.getElementById("final-decision"),
  explanation: document.getElementById("explanation"),
  detailsBody: document.getElementById("details-body"),
  details: document.getElementById("details"),
};

/** @type {File | null} */
let currentFile = null;

function setPageState(state) {
  els.app.dataset.state = state;
}

function hideUploadError() {
  els.uploadError.classList.add("hidden");
  els.uploadError.textContent = "";
}

function showUploadError(message) {
  els.uploadError.classList.remove("hidden");
  els.uploadError.textContent = message;
}

function setDecisionPill(status) {
  els.decisionWrap.classList.remove(
    "decision-pill--verified",
    "decision-pill--not-verified",
    "decision-pill--undetermined"
  );

  if (status === "Verified") {
    els.decisionWrap.classList.add("decision-pill--verified");
    els.decisionIcon.innerHTML = ICONS.verified;
  } else if (status === "Not Verified") {
    els.decisionWrap.classList.add("decision-pill--not-verified");
    els.decisionIcon.innerHTML = ICONS.notVerified;
  } else {
    els.decisionWrap.classList.add("decision-pill--undetermined");
    els.decisionIcon.innerHTML = ICONS.undetermined;
  }
}

function resetUi() {
  currentFile = null;
  els.fileInput.value = "";
  els.fileRow.classList.add("hidden");
  els.fileName.textContent = "";
  hideUploadError();
  els.resultsCard.classList.add("hidden");
  els.resultsLoading.classList.add("hidden");
  els.resultsBody.classList.add("hidden");
  els.detailsBody.textContent = "";
  els.details.open = false;
  setPageState("initial");
}

function onFileChosen(file) {
  const validation = validatePdfFile(file);
  if (!validation.ok) {
    showUploadError(validation.message);
    return;
  }
  hideUploadError();
  currentFile = file;
  els.fileName.textContent = file.name;
  els.fileRow.classList.remove("hidden");
  els.resultsCard.classList.add("hidden");
  setPageState("selected");
}

function renderResults(filename, result, candidates, chosen, agiResolution, debug) {
  els.uploadFilename.textContent = filename;
  els.extractedIncome.textContent =
    result.value === null || result.value === undefined
      ? "Unable to extract"
      : result.formattedValue || formatUsd(result.value);

  els.finalDecision.textContent = result.status;
  setDecisionPill(result.status);
  els.explanation.textContent = result.reason;

  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  els.detailsBody.textContent = JSON.stringify(
    {
      ...(DEBUG && debug ? { debug } : {}),
      policy:
        "Decision uses Adjusted Gross Income (AGI) only — see agiResolution.",
      agiResolution: agiResolution
        ? {
            ambiguous: agiResolution.ambiguous,
            matches: (agiResolution.matches || []).map((x) => ({
              raw: x.raw,
              value: x.value,
              labelSnippet: x.labelSnippet,
            })),
            chosenAgi: chosen
              ? {
                  raw: chosen.raw,
                  value: chosen.value,
                  context: chosen.context,
                  source: chosen.source,
                }
              : null,
          }
        : null,
      chosen: chosen
        ? {
            raw: chosen.raw,
            value: chosen.value,
            score: chosen.score,
            context: chosen.context,
            positiveSignals: chosen.positiveSignals,
            negativeSignals: chosen.negativeSignals,
            source: chosen.source,
          }
        : null,
      topCandidates: sorted.slice(0, 12).map((c) => ({
        raw: c.raw,
        value: c.value,
        score: c.score,
        context: c.context,
        positiveSignals: c.positiveSignals,
        negativeSignals: c.negativeSignals,
        monthlyWithoutAnnual: c.monthlyWithoutAnnual,
      })),
    },
    null,
    2
  );
}

async function runVerification() {
  if (!currentFile) return;

  hideUploadError();
  els.resultsCard.classList.remove("hidden");
  els.resultsLoading.classList.remove("hidden");
  els.resultsBody.classList.add("hidden");
  setPageState("loading");
  els.verifyBtn.disabled = true;
  els.clearBtn.disabled = true;

  try {
    const { fullText, meta } = await extractPdfText(currentFile);
    const { result, candidates, chosen, agiResolution, debug } =
      analyzeIncomeFromText(fullText, {
        debug: DEBUG,
        extractionMeta: meta,
      });
    if (DEBUG && debug) {
      console.info("[income-verifier] parse + verify debug", debug);
    }
    renderResults(
      currentFile.name,
      result,
      candidates,
      chosen,
      agiResolution,
      debug
    );
    els.resultsLoading.classList.add("hidden");
    els.resultsBody.classList.remove("hidden");
    setPageState("done");
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unexpected error while parsing PDF.";
    showUploadError(message);
    els.resultsCard.classList.add("hidden");
    setPageState("selected");
  } finally {
    els.verifyBtn.disabled = false;
    els.clearBtn.disabled = false;
  }
}

els.fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) onFileChosen(file);
});

els.verifyBtn.addEventListener("click", () => {
  void runVerification();
});

els.clearBtn.addEventListener("click", () => {
  resetUi();
});

els.dropzone.addEventListener("click", (e) => {
  if (e.target === els.fileInput || e.target.closest(".dropzone-label")) return;
  els.fileInput.click();
});

els.dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  els.dropzone.classList.add("is-dragover");
});

els.dropzone.addEventListener("dragleave", () => {
  els.dropzone.classList.remove("is-dragover");
});

els.dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  els.dropzone.classList.remove("is-dragover");
  const file = e.dataTransfer.files?.[0];
  if (file) onFileChosen(file);
});

els.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    els.fileInput.click();
  }
});

resetUi();
