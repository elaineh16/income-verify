// @ts-check
import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePdf = join(__dirname, "..", "fixtures", "agi-over-threshold.pdf");

test.describe("Income Verification Tool", () => {
  test("loads upload UI", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Income Verification Tool/);
    await expect(page.getByRole("heading", { name: "Upload Document" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify" })).toBeHidden();
  });

  test("end-to-end: PDF with AGI over threshold → Verified", async ({ page }) => {
    await page.goto("/");
    await page.locator("#file-input").setInputFiles(fixturePdf);
    await expect(page.locator("#file-name")).toContainText("agi-over-threshold.pdf");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.locator("#results-loading")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("#final-decision")).toHaveText("Verified", { timeout: 5_000 });
    await expect(page.locator("#extracted-income")).toContainText("200,000");
  });
});
