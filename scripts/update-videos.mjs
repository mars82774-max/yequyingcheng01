import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mockVideos } from "../src/mockVideos.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const videosOutput = join(root, "src", "mockVideos.js");
const stateOutput = join(root, "src", "videoCrawlState.json");
const baseUrl = "https://j-av.com/video/index.php";
const maxLatestPages = Number(process.env.MAX_LATEST_PAGES || 3);
const maxBackfillPages = Number(process.env.MAX_BACKFILL_PAGES || 0);
const maxNewItems = Number(process.env.MAX_NEW_ITEMS || 0);
const maxOldItems = Number(process.env.MAX_OLD_ITEMS || 24);
const delayMs = Number(process.env.CRAWL_DELAY_MS || 800);

const state = await readState();
const latestResult = await crawlLatest(mockVideos);
const now = new Date().toISOString();

state.latestLastRunAt = now;
state.latestLastNewCount = latestResult.items.length;

if (latestResult.items.length > 0) {
  const merged = dedupeVideos([...latestResult.items, ...mockVideos]);
  state.totalVideos = merged.length;
  await writeVideos(merged);
  await writeState(state);
  console.log(`Updated latest videos: new=${latestResult.items.length} total=${merged.length}`);
  process.exit(0);
}

console.log("No new latest videos. Starting backfill.");

const backfillResult = await crawlBackfill(mockVideos, state);
state.lastBackfillRunAt = now;
state.backfillPage = backfillResult.nextPage;
state.backfillCursor = backfillResult.nextCursor;

if (backfillResult.items.length > 0) {
  const merged = dedupeVideos([...mockVideos, ...backfillResult.items]);
  state.totalVideos = merged.length;
  await writeVideos(merged);
  await writeState(state);
  console.log(`Backfilled old videos: added=${backfillResult.items.length} total=${merged.length}`);
  process.exit(0);
}

console.log("No video updates");

async function crawlLatest(currentVideos) {
  const known = createDedupeIndex(currentVideos);
  const items = [];
  const seenPages = new Set();
  let pageUrl = baseUrl;
  let pagesDone = 0;

  while (pageUrl && !seenPages.has(pageUrl) && (maxLatestPages <= 0 || pagesDone < maxLatestPages)) {
    seenPages.add(pageUrl);
    const html = await fetchText(pageUrl);
    pagesDone += 1;

    for (const entryUrl of parseEntryUrls(html, pageUrl)) {
      const stub = { source_url: normalizeEntryUrl(entryUrl), id: entryIdFromUrl(entryUrl) };
      if (hasDuplicate(known, stub)) {
        return { items, pagesDone };
      }

      const item = await parseVideoPage(entryUrl);
      if (hasDuplicate(known, item)) {
        return { items, pagesDone };
      }

      items.push(item);
      addToIndex(known, item);
      console.log(`[latest] ${item.id} ${item.date} ${item.title.slice(0, 42)}`);

      if (maxNewItems > 0 && items.length >= maxNewItems) {
        return { items, pagesDone };
      }
      await sleep(delayMs);
    }

    pageUrl = parseNextUrl(html, pageUrl);
    await sleep(delayMs);
  }

  return { items, pagesDone };
}

async function crawlBackfill(currentVideos, crawlState) {
  const known = createDedupeIndex(currentVideos);
  const items = [];
  const seenPages = new Set();
  let pageUrl = crawlState.backfillCursor || "";
  let currentPage = Number(crawlState.backfillPage || 2);

  if (!pageUrl) {
    const firstPageHtml = await fetchText(baseUrl);
    pageUrl = parseNextUrl(firstPageHtml, baseUrl);
    currentPage = 2;
    await sleep(delayMs);
  }

  let pagesDone = 0;
  let nextCursor = pageUrl;
  let nextPage = currentPage;

  while (pageUrl && !seenPages.has(pageUrl) && (maxBackfillPages <= 0 || pagesDone < maxBackfillPages)) {
    seenPages.add(pageUrl);
    const html = await fetchText(pageUrl);
    pagesDone += 1;

    for (const entryUrl of parseEntryUrls(html, pageUrl)) {
      const stub = { source_url: normalizeEntryUrl(entryUrl), id: entryIdFromUrl(entryUrl) };
      if (hasDuplicate(known, stub)) continue;

      const item = await parseVideoPage(entryUrl);
      if (hasDuplicate(known, item)) continue;

      items.push(item);
      addToIndex(known, item);
      console.log(`[backfill] ${item.id} ${item.date} ${item.title.slice(0, 42)}`);

      if (maxOldItems > 0 && items.length >= maxOldItems) {
        nextCursor = parseNextUrl(html, pageUrl) || pageUrl;
        nextPage = currentPage + 1;
        return { items, nextCursor, nextPage, pagesDone };
      }
      await sleep(delayMs);
    }

    nextCursor = parseNextUrl(html, pageUrl);
    nextPage = currentPage + 1;
    pageUrl = nextCursor;
    currentPage = nextPage;
    await sleep(delayMs);
  }

  return { items, nextCursor: nextCursor || "", nextPage, pagesDone };
}

function dedupeVideos(videos) {
  const index = createEmptyDedupeIndex();
  const result = [];

  for (const video of videos) {
    if (!video || hasDuplicate(index, video)) continue;
    result.push(video);
    addToIndex(index, video);
  }

  return result;
}

function createDedupeIndex(videos) {
  const index = createEmptyDedupeIndex();
  for (const video of videos) addToIndex(index, video);
  return index;
}

function createEmptyDedupeIndex() {
  return {
    sourceUrls: new Set(),
    titleDurations: new Set(),
    titleThumbnails: new Set(),
    ids: new Set()
  };
}

function hasDuplicate(index, video) {
  const keys = dedupeKeys(video);
  return (
    (keys.sourceUrl && index.sourceUrls.has(keys.sourceUrl)) ||
    (keys.titleDuration && index.titleDurations.has(keys.titleDuration)) ||
    (keys.titleThumbnail && index.titleThumbnails.has(keys.titleThumbnail)) ||
    (keys.id && index.ids.has(keys.id))
  );
}

function addToIndex(index, video) {
  const keys = dedupeKeys(video);
  if (keys.sourceUrl) index.sourceUrls.add(keys.sourceUrl);
  if (keys.titleDuration) index.titleDurations.add(keys.titleDuration);
  if (keys.titleThumbnail) index.titleThumbnails.add(keys.titleThumbnail);
  if (keys.id) index.ids.add(keys.id);
}

function dedupeKeys(video) {
  const title = normalizeKey(video?.title);
  const duration = normalizeKey(video?.duration);
  const thumbnail = normalizeKey(video?.thumbnail || video?.cover || video?.cover_source);
  return {
    sourceUrl: normalizeSourceUrl(video?.sourceUrl || video?.source_url),
    titleDuration: title && duration ? `${title}|${duration}` : "",
    titleThumbnail: title && thumbnail ? `${title}|${thumbnail}` : "",
    id: normalizeKey(video?.id)
  };
}

async function readState() {
  const fallback = {
    latestLastRunAt: "",
    latestLastNewCount: 0,
    backfillPage: 2,
    backfillCursor: "",
    totalVideos: mockVideos.length,
    lastBackfillRunAt: ""
  };

  try {
    const existing = JSON.parse(await readFile(stateOutput, "utf-8"));
    return { ...fallback, ...existing };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return fallback;
  }
}

async function writeState(nextState) {
  await writeFile(stateOutput, `${JSON.stringify(nextState, null, 2)}\n`, "utf-8");
}

async function writeVideos(items) {
  const source = `export const mockVideos = ${JSON.stringify(items, null, 2)};\n`;
  await writeFile(videosOutput, source, "utf-8");
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"
    }
  });
  if (!response.ok) throw new Error(`Fetch failed ${response.status}: ${url}`);
  return response.text();
}

async function parseVideoPage(url) {
  const html = await fetchText(url);
  const embedUrl = normalizeUrl(findFirst(html, /<iframe[^>]+src=["']([^"']+)["']/gi, (value) => value.includes("a-big.com/player")), url);
  const cover = coverFromEmbed(embedUrl);
  const title = cleanText(
    findFirst(html, /<div[^>]+class=["'][^"']*blog_subject[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
      findFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i)?.split(" - J-AV")[0] ||
      entryIdFromUrl(url)
  );
  const date = cleanText(findFirst(html, /<div[^>]+class=["'][^"']*blog_date[^"']*["'][^>]*>([\s\S]*?)<\/div>/i));
  const id = entryIdFromUrl(url);

  return {
    id,
    slug: id,
    title,
    source_url: normalizeEntryUrl(url),
    embed_url: embedUrl,
    cover_source: cover,
    cover,
    date,
    category: defaultList("category"),
    tags: inferTags(title, cover),
    type: "iframe",
    provider: "j-av"
  };
}

function parseEntryUrls(html, pageUrl) {
  const links = [...html.matchAll(/<a[^>]+href=["']([^"']*entry=[^"']+)["']/gi)]
    .map((match) => normalizeUrl(decodeHtml(match[1]), pageUrl))
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return parsed.searchParams.has("entry") && !parsed.searchParams.has("m") && !parsed.searchParams.has("d") && !parsed.searchParams.has("y");
      } catch {
        return false;
      }
    })
    .map((url) => normalizeEntryUrl(url));
  return [...new Set(links)].filter((url) => entryIdFromUrl(url));
}

function parseNextUrl(html, pageUrl) {
  const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const [, href, label] of links) {
    const text = cleanText(label).toLowerCase();
    if (href.includes("entry=") && (text.includes("next") || text.includes("older") || text.includes("下一") || text.includes("下頁"))) {
      return normalizeUrl(decodeHtml(href), pageUrl);
    }
  }

  const entryUrls = parseEntryUrls(html, pageUrl);
  return entryUrls.at(-1) || "";
}

function findFirst(html, pattern, predicate = () => true) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);
  for (const match of html.matchAll(globalPattern)) {
    const value = normalizeUrl(match[1] || "", baseUrl);
    if (predicate(value)) return match[1] || "";
  }
  return "";
}

function normalizeUrl(url, base) {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function normalizeEntryUrl(url) {
  const entry = entryIdFromUrl(url);
  return entry.startsWith("entry") ? `${baseUrl}?entry=${encodeURIComponent(entry)}` : normalizeUrl(url, baseUrl);
}

function normalizeSourceUrl(url) {
  const normalized = normalizeUrl(url || "", baseUrl);
  return entryIdFromUrl(normalized) ? normalizeEntryUrl(normalized) : normalized;
}

function entryIdFromUrl(url) {
  try {
    return new URL(url, baseUrl).searchParams.get("entry") || "";
  } catch {
    return "";
  }
}

function coverFromEmbed(url) {
  try {
    return new URL(url).searchParams.get("image") || "";
  } catch {
    return "";
  }
}

function inferTags(title, cover) {
  const tags = defaultList("tags");
  const code = findCode(title) || findCode(cover);
  if (code) {
    tags.push(code);
    tags.push(code.split("-")[0]);
  }
  return dedupe(tags);
}

function defaultList(field) {
  const values = mockVideos[0]?.[field];
  return Array.isArray(values) ? [...values.slice(0, 2)] : [];
}

function findCode(value = "") {
  return String(value).match(/[a-z]{2,12}-?\d{2,5}/i)?.[0]?.toUpperCase().replace(/([A-Z]+)(\d+)$/, "$1-$2") || "";
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeKey(value = "") {
  return String(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function cleanText(value = "") {
  return String(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
