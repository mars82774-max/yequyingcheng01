import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { get } from "node:http";
import { chromium } from "playwright";

const port = 4185;
const baseUrl = `http://localhost:${port}/`;

test("featured carousel active slide images are visible after load and dot changes", { timeout: 120000 }, async () => {
  const server = spawn(process.execPath, ["scripts/dev-server.mjs", ".", String(port)], {
    cwd: process.cwd(),
    stdio: "ignore",
    windowsHide: true
  });

  try {
    await waitForServer(baseUrl);
    await verifyCarousel({ width: 1365, disableCache: false });
    await verifyCarousel({ width: 453, disableCache: false });
    await verifyCarousel({ width: 1365, disableCache: true });
    await verifyCarousel({ width: 453, disableCache: true });
  } finally {
    server.kill();
  }
});

async function verifyCarousel({ width, disableCache }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    extraHTTPHeaders: disableCache ? { "Cache-Control": "no-cache", Pragma: "no-cache" } : undefined
  });
  const page = await context.newPage();
  const consoleErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-video-carousel] .featured-slide.active img.is-loaded", { timeout: 30000 });

    const dotCount = await page.locator("[data-video-carousel-dot]").count();
    assert.equal(dotCount, 5);

    for (let index = 0; index < dotCount; index += 1) {
      await page.locator(`[data-video-carousel-dot="${index}"]`).click();
      await page.waitForFunction((dotIndex) => {
        const active = document.querySelectorAll(".featured-slide")[dotIndex];
        const img = active?.querySelector("img");
        if (!active?.classList.contains("active") || !img?.classList.contains("is-loaded")) return false;
        const slideStyle = getComputedStyle(active);
        const imageStyle = getComputedStyle(img);
        return img.naturalWidth > 0
          && slideStyle.opacity !== "0"
          && slideStyle.visibility !== "hidden"
          && imageStyle.opacity !== "0"
          && imageStyle.visibility !== "hidden";
      }, index, { timeout: 30000 });
    }

    assert.deepEqual(consoleErrors, []);
  } finally {
    await browser.close();
  }
}

async function waitForServer(url) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await canConnect(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not start at ${url}`);
}

function canConnect(url) {
  return new Promise((resolve) => {
    const request = get(url, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(1000, () => {
      request.destroy();
      resolve(false);
    });
  });
}
