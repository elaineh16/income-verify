/**
 * Generates minimal text-based PDF fixtures for Playwright (pdf.js must extract lines).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "tests", "fixtures");

/** @type {{ name: string; lines: { text: string; y: number }[] }[]} */
const FIXTURES = [
  {
    name: "agi-over-threshold.pdf",
    lines: [{ text: "Adjusted Gross Income (AGI): $200,000", y: 720 }],
  },
  {
    name: "salary-over-threshold.pdf",
    lines: [{ text: "Annual Salary: $180,000", y: 720 }],
  },
  {
    name: "annual-income-below.pdf",
    lines: [{ text: "Annual Income: $120,000", y: 720 }],
  },
  {
    name: "taxable-income-verified.pdf",
    lines: [{ text: "Taxable Income: $180,000", y: 720 }],
  },
  {
    name: "business-pl-only.pdf",
    lines: [
      { text: "Business Revenue: $500,000", y: 740 },
      { text: "Net Profit: $100,000", y: 710 },
    ],
  },
  {
    name: "monthly-income-only.pdf",
    lines: [{ text: "Monthly Income: $20,000", y: 720 }],
  },
  {
    name: "conflicting-income-fields.pdf",
    lines: [
      { text: "Annual Income: $200,000", y: 740 },
      { text: "Gross Income: $100,000", y: 710 },
    ],
  },
];

mkdirSync(outDir, { recursive: true });

for (const fx of FIXTURES) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const line of fx.lines) {
    page.drawText(line.text, { x: 72, y: line.y, size: 11, font });
  }
  const bytes = await doc.save();
  const outPath = join(outDir, fx.name);
  writeFileSync(outPath, bytes);
  console.log("Wrote", outPath);
}
