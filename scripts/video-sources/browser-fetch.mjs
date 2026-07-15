import { chromium } from "playwright";

const defaultProfileDir = "/home/ubuntu/video-browser-profile";
const defaultTimeoutMs = 30000;
const defaultChallengeTimeoutMs = 60000;

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
  const challengeTimeoutMs = Number(env.BROWSER_CHALLENGE_TIMEOUT_MS || env.CF_CHALLENGE_TIMEOUT_MS || defaultChallengeTimeoutMs);
  let closed = false;

  return {
    async fetchText(url) {
      const page = await context.newPage();
      let response = null;
      let lastMainFrameStatus = 0;
      page.on("response", (nextResponse) => {
        if (nextResponse.frame() === page.mainFrame()) {
          lastMainFrameStatus = nextResponse.status();
        }
      });
      try {
        response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        lastMainFrameStatus = response?.status() || lastMainFrameStatus;
        const ready = await waitForSourcePage(page, challengeTimeoutMs);
        if (!ready.ok) {
          throw new Error(`CHALLENGE_TIMEOUT title=${ready.title || ""} finalUrl=${ready.finalUrl || ""}`);
        }
        await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 10000) }).catch(() => {});
        const status = lastMainFrameStatus || response?.status() || 0;
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

async function waitForSourcePage(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let title = "";
  while (Date.now() < deadline) {
    title = cleanText(await page.title().catch(() => ""));
    const finalUrl = page.url();
    const signal = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      const html = document.documentElement?.innerHTML || "";
      return {
        hasEntryLink: Boolean(document.querySelector('a[href*="entry="]')),
        hasBlogSubject: Boolean(document.querySelector(".blog_subject")),
        hasBlogDate: Boolean(document.querySelector(".blog_date")),
        hasVideoFrame: Boolean(document.querySelector('iframe[src*="a-big.com/player"]')),
        bodyText: text.slice(0, 500),
        htmlText: html.slice(0, 2000)
      };
    }).catch(() => ({
      hasEntryLink: false,
      hasBlogSubject: false,
      hasBlogDate: false,
      hasVideoFrame: false,
      bodyText: "",
      htmlText: ""
    }));

    if (signal.hasEntryLink || signal.hasBlogSubject || signal.hasBlogDate || signal.hasVideoFrame) {
      return { ok: true, title, finalUrl };
    }

    if (!isChallengeLike(title, `${signal.bodyText}\n${signal.htmlText}`)) {
      return { ok: true, title, finalUrl };
    }

    await page.waitForTimeout(1000);
  }
  return { ok: false, title, finalUrl: page.url() };
}

function isChallengeLike(title, text) {
  const combined = `${title}\n${text}`.toLowerCase();
  return combined.includes("just a moment")
    || combined.includes("cf-browser-verification")
    || combined.includes("checking your browser")
    || combined.includes("cloudflare")
    || combined.includes("challenge-platform")
    || combined.includes("captcha");
}

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}
