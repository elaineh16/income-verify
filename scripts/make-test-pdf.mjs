/**
 * Generates a minimal text-based PDF for e2e tests (pdf.js must extract AGI line).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "tests", "fixtures");
const outPath = join(outDir, "agi-over-threshold.pdf");

const doc = await PDFDocument.create();
const page = doc.addPage([612, 792]);
const font = await doc.embedFont(StandardFonts.Helvetica);
const line = "Adjusted Gross Income (AGI): $200,000";
page.drawText(line, { x: 72, y: 720, size: 11, font });

const bytes = await doc.save();
mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, bytes);
console.log("Wrote", outPath);
