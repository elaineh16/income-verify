/**
 * Ensures PLAYWRIGHT_BROWSERS_PATH is set before Playwright loads (config alone is too late).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

process.env.PLAYWRIGHT_BROWSERS_PATH = join(process.cwd(), ".playwright-browsers");

const args = ["playwright", "test", ...process.argv.slice(2)];
const r = spawnSync("npx", args, { stdio: "inherit", env: process.env, shell: true });
process.exit(r.status ?? 1);
