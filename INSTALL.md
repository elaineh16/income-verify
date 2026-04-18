# Installation guide — Income Verification Tool

This project is a **static web app** (HTML, CSS, vanilla ES modules). There is **no production build step**. Optional **Node.js** tooling is used only for **end-to-end (E2E) tests** with Playwright.

---

## 1. Prerequisites

### Run the app in a browser (required)

- **Python 3** (for the documented local server), **or** any other static file server you prefer.
- A **modern browser** (Chrome, Firefox, Safari, or Edge).

### Run E2E tests (optional)

- **Node.js** 18 or newer (includes `npm`).
- **Network access** to download npm packages and Playwright’s Chromium build the first time you install browsers.

---

## 2. Install — use the app locally

1. Open a terminal and go to the project folder (the directory that contains `index.html`):

   ```bash
   cd /path/to/income-verifier
   ```

2. Start a static HTTP server on a free port (example uses **8080**):

   ```bash
   python3 -m http.server 8080
   ```

3. In your browser, open:

   ```text
   http://localhost:8080
   ```

**Why not open `index.html` directly?** Browsers handle **ES modules** and **worker** loading more reliably over `http://localhost` than with the `file://` protocol.

**CDN:** The app loads **pdf.js** from jsDelivr when you parse a PDF. The machine running the browser needs outbound HTTPS access to that CDN (or the library will fail to load).

---

## 3. Install — E2E tests (Playwright)

From the same project directory:

1. **Install JavaScript dependencies**

   ```bash
   npm install
   ```

2. **Install Playwright Chromium** into `./.playwright-browsers` (kept out of git; safe to delete and reinstall)

   ```bash
   npm run install:browsers
   ```

3. **Generate the test PDF fixtures** (minimal text-based PDFs for each scenario)

   ```bash
   npm run make-fixture
   ```

   This writes several files under `tests/fixtures/` (AGI, salary, annual income, taxable income, business-only, monthly-only, conflicting labels). Re-run anytime to regenerate them.

4. **Run the E2E suite**

   ```bash
   npm run test:e2e
   ```

The test runner starts a local static server on port **8765**, opens the app in Chromium, and runs scenarios such as AGI/salary above threshold, annual income below threshold, business-only and monthly-only **Unable to Determine**, and conflicting labels.

---

## 4. Scripts reference

| Command | Purpose |
| -------- | -------- |
| `npm run serve` | Serves the app on port **8080** with `python3 -m http.server` (same idea as section 2). |
| `npm run make-fixture` | Builds all `tests/fixtures/*.pdf` samples using `pdf-lib`. |
| `npm run install:browsers` | Downloads Playwright Chromium into `.playwright-browsers/`. |
| `npm run test:e2e` | Runs Playwright tests (`tests/e2e/`). Sets `PLAYWRIGHT_BROWSERS_PATH` so the browser path is consistent. |

---

## 5. Troubleshooting

| Issue | What to try |
| ----- | ----------- |
| Blank page or module errors | Serve over **http://localhost**, not `file://`. |
| `Executable doesn't exist` (Playwright) | Run `npm run install:browsers` again. On CI, ensure `npm run make-fixture` ran so the PDF exists. |
| E2E can’t find a fixture | Run `npm run make-fixture` from the repo root. |
| PDF parsing fails in the browser | Corporate proxies sometimes block jsDelivr; allow **cdn.jsdelivr.net** or use an offline pdf.js setup (not included in this demo). |

---

## 6. Related docs

- **[README.md](./README.md)** — product behavior, assumptions, and limitations.
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** — hosting on GitHub Pages and similar.
