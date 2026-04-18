# Income Verification Tool

A lightweight **JavaScript** web app that uploads a PDF, extracts text using **Mozilla pdf.js**, and identifies a **relevant personal income value**. The value is compared against **$150,000** to return:

- **Verified** (> $150,000)
- **Not Verified** (≤ $150,000)
- **Unable to Determine** (ambiguous or no clear value)

## How it works

- **Client-side parsing**: Extracts text from PDFs in the browser (no backend)
- **Heuristic selection**: Uses label-based rules to identify income values (e.g., **AGI, gross income, salary, wages**)
- **Conservative logic**: Avoids guessing and returns **Unable to Determine** if multiple or unclear values exist
- **Deterministic**: Same input gives the same output

## Assumptions

- PDFs are **text-based** (not scanned)  
- Income values are **labeled and extractable** from text  
- Monthly or weekly values are **not annualized automatically**  

## Limitations

- No OCR support  
- Scanned PDFs are unsupported  
- Ambiguous documents return **Unable to Determine**  
- Heuristic-based (not full document intelligence)  

## Tech

- Vanilla JavaScript  
- Mozilla **pdf.js**  
- Static, GitHub Pages–friendly  

## Setup

Run locally with a simple static server:

```bash
python3 -m http.server 8080
