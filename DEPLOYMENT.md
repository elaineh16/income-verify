# Deployment guide — Income Verification Tool

This app is **static files only** (HTML/CSS/JS + ES modules). No build step is required. pdf.js is loaded from **jsDelivr** in the browser, so visitors need **network access** the first time the scripts load.

## Prerequisites

- A GitHub repository containing the `income-verifier/` folder (or its contents at the site root).
- A modern browser (Chrome, Firefox, Safari, Edge).

## Option A — GitHub Pages from `/docs` (simple)

1. Move or copy everything inside `income-verifier/` to a **`docs/`** folder at the **repository root** (GitHub Pages convention), **or** keep the folder name `docs` and place `index.html` at `docs/index.html`.

2. In GitHub: **Settings → Pages**.

3. Under **Build and deployment**:

   - **Source**: *Deploy from a branch*
   - **Branch**: e.g. `main` / `master`
   - **Folder**: `/docs`

4. Save. After the workflow finishes, the site URL will be:

   `https://<username>.github.io/<repository>/`

5. Open the URL. The entry file must be `index.html` inside the published folder so the path resolves without extra segments.

> If your `index.html` lives at `docs/income-verifier/index.html` instead of `docs/index.html`, users must open  
> `https://<username>.github.io/<repository>/income-verifier/`  
> (trailing slash optional depending on hosting). Prefer **`docs/index.html`** at the root of the published folder for the cleanest URL.

## Option B — GitHub Pages from repository root

If the **only** thing in the repo is this tool (or you put `index.html`, `app.js`, etc. at the repo root):

1. **Settings → Pages → Source**: branch folder **`/` (root)**.

2. Site URL: `https://<username>.github.io/<repository>/`

## Option C — GitHub Pages with a `/income-verifier` subpath

If the rest of your site lives at the repo root and this tool stays in **`income-verifier/`**:

1. Publish the **whole repository** from root (Option B).

2. Users open:

   `https://<username>.github.io/<repository>/income-verifier/`

3. **No base URL change is required** in the code: imports use **relative** paths (`./app.js`, `./parser.js`, …), which resolve under that directory.

## Option D — GitHub Actions (optional)

For reproducible deploys or non-`docs` layouts, add a workflow that uploads the static folder to **GitHub Pages** (artifact) or use **peaceiris/actions-gh-pages** to push a `gh-pages` branch. Point the Pages “source” to **GitHub Actions** when using the official Pages workflow template.

Details vary by template; the important part is that the **published artifact** contains `index.html` next to `app.js`, `parser.js`, `verifier.js`, `utils.js`, and `style.css`.

## Debugging wrong extracted numbers (Vercel vs local)

1. Open your deployed URL with **`?debug=1`** (e.g. `https://….vercel.app/?debug=1`).
2. Upload the PDF and click **Verify**.
3. In DevTools → **Console**, inspect `[income-verifier] parse + verify debug`:
   - **`extractionMeta.workerSrc`** / **`workerPinnedVersion`** — worker must match the pdf.js API version.
   - **`normalizedPreview`** — text after **reading-order** reconstruction; income-related labels should sit on sensible lines.
4. In **Extraction details**, the same `debug` object appears in the JSON when `debug=1`.

Typical **root cause** of “right locally, wrong on Vercel”: PDF text items were concatenated in **content-stream order**, so “$420k revenue” could appear **before** “Adjusted Gross Income” on a single synthesized line, confusing label regexes. This project fixes that by sorting items into lines (see `parser.js`).

## After deploy — checklist

- [ ] `index.html` loads without 404.
- [ ] Browser **Network** tab shows `app.js`, `parser.js`, `verifier.js`, `utils.js`, `style.css` all **200**.
- [ ] pdf.js loads from `cdn.jsdelivr.net` (may be blocked by strict corporate proxies—document for users if needed).
- [ ] Upload a small text-based PDF and confirm **Verify Income** completes.

## Common issues

| Symptom | Likely cause |
| ------- | ------------ |
| Blank page, module errors in console | Served over `file://` or wrong path; use **HTTPS** from Pages or a local static server. |
| pdf.js worker error | CDN blocked or version mismatch; `parser.js` worker URL must match the pdfjs-dist version. |
| 404 on `*.js` | `index.html` and JS files not in the **same** published directory; fix folder layout or URLs. |

## Security / privacy note

All parsing runs **in the user’s browser**. No PDF bytes are sent to **your** server by this app. Third-party **jsDelivr** is used only to load **pdf.js** (and its worker), which is a normal tradeoff for a zero-build static deploy.
