import { browserProfileDir, browserLaunchOptions } from "./video-sources/browser-fetch.mjs";
import { chromium } from "playwright";

const targetUrl = process.env.BROWSER_VERIFY_URL || "https://j-av.com/video/index.php";
const profileDir = browserProfileDir(process.env);
const options = {
  ...browserLaunchOptions({ ...process.env, BROWSER_HEADLESS: "false" })
};

console.log(`[browser:verify] profile=${profileDir}`);
console.log(`[browser:verify] url=${targetUrl}`);
console.log("[browser:verify] Complete the site's normal browser verification, then press Ctrl+C here when done.");

const context = await chromium.launchPersistentContext(profileDir, options);
const page = await context.newPage();
await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: Number(process.env.BROWSER_VERIFY_TIMEOUT_MS || 60000) });

process.on("SIGINT", closeAndExit);
process.on("SIGTERM", closeAndExit);

async function closeAndExit() {
  console.log("[browser:verify] closing browser");
  await context.close();
  process.exit(0);
}

await new Promise(() => {});
