// @ts-check
/**
 * E2E checks against sample income report PDFs (paths from local Cursor storage).
 */
import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";

const SAMPLES = {
  ambiguous:
    "/Users/elainehong/Library/Application Support/Cursor/User/workspaceStorage/c9f3b22b8824e08388830045d9b60d57/pdfs/f7be2b7d-eec1-4774-a7fc-c21892db1c7e/sample_income_report_ambiguous.pdf",
  above:
    "/Users/elainehong/Library/Application Support/Cursor/User/workspaceStorage/c9f3b22b8824e08388830045d9b60d57/pdfs/f2b8fda7-134b-44a7-8f7a-36a2274b9047/sample_income_report_above.pdf",
  below:
    "/Users/elainehong/Library/Application Support/Cursor/User/workspaceStorage/c9f3b22b8824e08388830045d9b60d57/pdfs/d4a6d7fc-738e-4e26-bf15-642c59bfcdd2/sample_income_report_below.pdf",
};

test.beforeAll(() => {
  for (const [name, p] of Object.entries(SAMPLES)) {
    if (!existsSync(p)) {
      throw new Error(`Missing sample PDF (${name}): ${p}`);
    }
  }
});

test.describe("Sample income report PDFs", () => {
  test("ambiguous → Unable to Determine", async ({ page }) => {
    await page.goto("/");
    await page.locator("#file-input").setInputFiles(SAMPLES.ambiguous);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.locator("#results-loading")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("#final-decision")).toHaveText("Unable to Determine", {
      timeout: 15_000,
    });
  });

  test("above threshold → Verified", async ({ page }) => {
    await page.goto("/");
    await page.locator("#file-input").setInputFiles(SAMPLES.above);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.locator("#results-loading")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("#final-decision")).toHaveText("Verified", { timeout: 15_000 });
  });

  test("below threshold → Not Verified", async ({ page }) => {
    await page.goto("/");
    await page.locator("#file-input").setInputFiles(SAMPLES.below);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.locator("#results-loading")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("#final-decision")).toHaveText("Not Verified", { timeout: 15_000 });
  });
});
