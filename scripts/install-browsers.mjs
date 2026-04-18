/**
 * Installs Playwright Chromium into ./.playwright-browsers (same path as playwright.config.js).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

process.env.PLAYWRIGHT_BROWSERS_PATH = join(process.cwd(), ".playwright-browsers");

const r = spawnSync(
  "npx",
  ["playwright", "install", "chromium"],
  { stdio: "inherit", env: process.env, shell: true }
);
process.exit(r.status ?? 1);
