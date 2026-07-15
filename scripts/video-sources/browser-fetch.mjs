import { chromium } from "playwright";

const defaultProfileDir = "/home/ubuntu/video-browser-profile";
const defaultTimeoutMs = 30000;

export function browserProfileDir(env = process.env) {
  return env.BROWSER_PROFILE_DIR || env.VIDEO_BROWSER_PROFILE || defaultProfileDir;
}

export function browserLaunchOptions(env = process.env) {
  return {
    headless: !["0", "false", "no"].includes(String(env.BROWSER_HEADLESS ?? "true").toLowerCase()),
    viewport: { width: 1365, height: 768 },
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    args: [
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check"
    ]
  };
}

export async function createBrowserFetcher(env = process.env) {
  const context = await chromium.launchPersistentContext(browserProfileDir(env), browserLaunchOptions(env));
  const timeoutMs = Number(env.CRAWL_TIMEOUT_MS || env.BROWSER_FETCH_TIMEOUT_MS || defaultTimeoutMs);
  let closed = false;

  return {
    async fetchText(url) {
      const page = await context.newPage();
      let response = null;
      try {
        response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 10000) }).catch(() => {});
        const status = response?.status() || 0;
        const title = cleanText(await page.title().catch(() => ""));
        const html = await page.content();
        return { html, status, title, finalUrl: page.url() };
      } finally {
        await page.close().catch(() => {});
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await context.close();
    }
  };
}

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}
