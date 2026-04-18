// @ts-check
import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name) => join(__dirname, "..", "fixtures", name);

test.describe("Income Verification Tool", () => {
  test("loads upload UI", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Income Verification Tool/);
    await expect(page.getByRole("heading", { name: "Upload Document" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify" })).toBeHidden();
  });

  test("AGI above threshold → Verified", async ({ page }) => {
    await page.goto("/");
    await page.locator("#file-input").setInputFiles(fx("agi-over-threshold.pdf"));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.locator("#results-loading")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("#final-decision")).toHaveText("Verified", { timeout: 5_000 });
    await expect(page.locator("#extracted-income")).toContainText("200,000");
    await expect(page.locator("#value-match-meta")).toContainText("Adjusted Gross Income");
  });

  test("Salary above threshold → Verified", async ({ page }) => {
    await page.goto("/");
    await page.locator("#file-input").setInputFiles(fx("salary-over-threshold.pdf"));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.locator("#results-loading")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("#final-decision")).toHaveText("Verified", { timeout: 5_000 });
    await expect(page.locator("#extracted-income")).toContainText("180,000");
  });

  test("Annual income below threshold → Not Verified", async ({ page }) => {
    await page.goto("/");
    await page.locator("#file-input").setInputFiles(fx("annual-income-below.pdf"));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.locator("#results-loading")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("#final-decision")).toHaveText("Not Verified", { timeout: 5_000 });
    await expect(page.locator("#extracted-income")).toContainText("120,000");
  });

  test("Taxable income only → Verified when above threshold", async ({ page }) => {
    await page.goto("/");
    await page.locator("#file-input").setInputFiles(fx("taxable-income-verified.pdf"));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.locator("#results-loading")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("#final-decision")).toHaveText("Verified", { timeout: 5_000 });
    await expect(page.locator("#value-match-meta")).toContainText("Taxable Income");
  });

  test("Revenue and profit only → Unable to Determine", async ({ page }) => {
    await page.goto("/");
    await page.locator("#file-input").setInputFiles(fx("business-pl-only.pdf"));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.locator("#results-loading")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("#final-decision")).toHaveText("Unable to Determine", {
      timeout: 5_000,
    });
  });

  test("Monthly income only → Unable to Determine", async ({ page }) => {
    await page.goto("/");
    await page.locator("#file-input").setInputFiles(fx("monthly-income-only.pdf"));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.locator("#results-loading")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("#final-decision")).toHaveText("Unable to Determine", {
      timeout: 5_000,
    });
  });

  test("Conflicting income fields → Unable to Determine", async ({ page }) => {
    await page.goto("/");
    await page.locator("#file-input").setInputFiles(fx("conflicting-income-fields.pdf"));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.locator("#results-loading")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("#final-decision")).toHaveText("Unable to Determine", {
      timeout: 5_000,
    });
  });
});
