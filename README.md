# Income Verification Tool (browser-only)

A small **vanilla JavaScript** demo that uploads a PDF, extracts text with **Mozilla pdf.js**, finds the **Adjusted Gross Income (AGI)** amount using a **label-anchored regex** (not a loose “biggest number” heuristic), and compares AGI to **$150,000**. If AGI cannot be read unambiguously, the tool returns **Unable to Determine**.

## Project overview

- **Frontend-only**: no backend, no OCR, no LLMs.
- **Deterministic**: same PDF → same output; the verdict is tied to the parsed AGI amount.
- **Conservative**: missing AGI labels, multiple conflicting AGI amounts, or unreadable text → **Unable to Determine**.

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

1. **`parser.js`**: validates the file, reads bytes, runs pdf.js page-by-page, concatenates text.
2. **`verifier.js`**: resolves **AGI** with patterns like `Adjusted Gross Income (AGI): $…` (and a small `AGI: $…` fallback). The UI’s “Extraction details” may still list other dollar amounts with legacy keyword scores **for debugging only**; they do **not** drive the decision.
3. **`utils.js`**: small shared helpers (validation, formatting, context windows).
4. **`app.js` + `index.html` + `style.css`**: UI states (upload → loading → result/error) and optional debug JSON.

## Assumptions (explicit)

- PDFs are **clean and machine-readable** (text exists in the PDF structure).
- **AGI** appears as **extractable text** in a form close to: `Adjusted Gross Income (AGI): $123,456` (see `verifier.js` for exact patterns).
- The app **does not infer AGI** from unrelated lines (e.g., business revenue or taxable income).

## Limitations (explicit)

- **Scanned/image PDFs** are not supported (no OCR).
- **Unusual layouts** (tables reconstructed poorly, rotated text, split strings) can yield missing/wrong text.
- **Ambiguous financial documents** may return **Unable to Determine** by design.
- This is **case-study heuristic logic**, not production-grade document understanding.

## Deploying to GitHub Pages

1. Push this repository to GitHub.
2. In the repo **Settings → Pages**:
   - **Source**: Deploy from a branch **or** GitHub Actions (static site).
3. If you publish **only** this subfolder, either:
   - move these files to the repo root / `docs/` folder Pages expects, **or**
   - set Pages to publish from `/income-verifier` if your hosting setup supports subfolder roots.

**Module paths**: the app uses relative imports (`./app.js`, `./parser.js`, …). As long as the site root serves this folder, paths stay valid.

**CDN note**: pdf.js is loaded from jsDelivr in `parser.js`. That requires network access in the browser when first loading the tool.

## Files

| File        | Role                                      |
| ----------- | ----------------------------------------- |
| `index.html` | Page structure + module entry          |
| `style.css`  | Layout, states, accessible basics        |
| `app.js`     | UI wiring + state machine                 |
| `parser.js`  | pdf.js text extraction                    |
| `verifier.js`| Candidates, scoring, selection, verdict |
| `utils.js`   | Shared helpers                            |

## Threshold rule (AGI only)

- **Verified**: parsed **AGI** **>** $150,000  
- **Not Verified**: parsed **AGI** **≤** $150,000  
- **Unable to Determine**: no AGI match, **multiple different AGI values** in the text, parsing failure, or no readable text
