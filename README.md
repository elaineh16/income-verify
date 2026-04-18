# Income Verification Tool (browser-only)

A small **vanilla JavaScript** demo that uploads a PDF, extracts text with **Mozilla pdf.js**, and picks a **single relevant personal income dollar amount** using **label-guided heuristics** (not “largest number on the page”). That value is compared to **$150,000**. If the document does not support one clear choice, the tool returns **Unable to Determine**.

## Project overview

- **Frontend-only**: no backend, no OCR, no LLMs.
- **Label-guided**: strong matches include **Adjusted Gross Income**, **annual / gross / total income**, **salary**, **wages**, **compensation**, and similar. **AGI** remains a very strong signal but is not the only path.
- **Conservative tradeoff**: the tool prefers **precision** and **Unable to Determine** over aggressive guessing when labels conflict, when only business P&L lines appear (e.g. revenue / net profit), or when amounts are explicitly **weekly / monthly / biweekly** without annual framing (those are **not** annualized).
- **Deterministic**: same PDF → same output for a given extraction.

## Setup (local)

This folder is static assets only—no bundler required.

1. Open a terminal in `income-verifier/`.
2. Start any static file server (pick one):

```bash
python3 -m http.server 8080
```

3. Visit `http://localhost:8080` in a modern browser.

> **Why a server?** Browsers treat ES modules + worker loading more predictably over `http://localhost` than `file://`.

## How it works (high level)

1. **`parser.js`**: validates the file, reads bytes, runs pdf.js page-by-page, rebuilds **reading order** text (see comments for content-stream ordering pitfalls).
2. **`verifier.js`**: finds currency-like amounts, scores each using **regex label matches** on local context (high-weight personal-income phrases, caution tier such as **taxable income**, and negative phrases such as **revenue**, **net profit**, **payment**, **monthly income**, etc.). Selects **one** candidate only if the score gap vs the next plausible amount is clear enough; otherwise **Unable to Determine**.
3. **`utils.js`**: validation, formatting, context windows, text normalization.
4. **`app.js` + `index.html` + `style.css`**: upload → loading → result, **selected value**, matched label line, explanation, and optional debug JSON (`?debug=1`).

## Assumptions (explicit)

- PDFs are **clean and machine-readable** (text exists in the PDF structure). **Scanned PDFs are not supported** without OCR.
- Income phrases appear as **extractable text** near the dollar figure in a form the regexes recognize (spacing quirks are handled by normalizing context).
- The tool **does not annualize** weekly / monthly / biweekly pay automatically.
- **Business revenue / profit** lines are **not** treated as verified personal income unless a recognized personal-income label also applies.

## Limitations (explicit)

- **Scanned/image PDFs** are not supported (no OCR).
- **Unusual layouts** (tables reconstructed poorly, rotated text) can yield missing or merged lines.
- **Ambiguous documents** (two strong income figures that disagree) return **Unable to Determine** by design.
- This is **case-study heuristic logic**, not production-grade document understanding.

## Deploying to GitHub Pages

1. Push this repository to GitHub.
2. In the repo **Settings → Pages**:
   - **Source**: Deploy from a branch **or** GitHub Actions (static site).
3. If you publish **only** this subfolder, either move files to **`docs/`** or publish from `/income-verifier` if your host supports it.

**Module paths**: relative imports (`./app.js`, `./parser.js`, …). The site root must serve this folder.

**CDN note**: pdf.js loads from jsDelivr in `parser.js`; the browser needs network access when first loading the tool.

## Files

| File         | Role                                      |
| ------------ | ----------------------------------------- |
| `index.html` | Page structure + module entry             |
| `style.css`  | Layout, states, accessible basics         |
| `app.js`     | UI wiring + state machine               |
| `parser.js`  | pdf.js text extraction                  |
| `verifier.js`| Label scoring, selection, threshold     |
| `utils.js`   | Shared helpers                          |

## Threshold rule

- **Verified**: selected income value **>** $150,000  
- **Not Verified**: selected value **≤** $150,000  
- **Unable to Determine**: no safe selection, **conflicting** plausible income figures, **subannual** pay without annual framing, **business-only** lines, parsing failure, or no readable text

See **`INSTALL.md`** for optional **Playwright** end-to-end tests.
