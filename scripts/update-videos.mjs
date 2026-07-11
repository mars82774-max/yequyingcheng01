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
const maxNewItems = Number(process.env.MAX_NEW_ITEMS || 20);
const maxOldItems = Number(process.env.MAX_OLD_ITEMS || 24);
const delayMs = Number(process.env.CRAWL_DELAY_MS || 800);
const crawlMode = (process.env.CRAWL_MODE || "backfill").toLowerCase();

const state = await readState();
const now = new Date().toISOString();

console.log(`[crawl] mode=${crawlMode}`);
console.log(`[crawl] source=${baseUrl}`);
console.log(`[crawl] videosOutput=${videosOutput}`);
console.log(`[crawl] stateOutput=${stateOutput}`);
console.log(`[crawl] existingVideos=${mockVideos.length}`);

if (crawlMode === "latest") {
  const latestResult = await crawlLatest(mockVideos);
  const previousCount = mockVideos.length;

  state.latestLastRunAt = now;
  state.latestLastNewCount = latestResult.items.length;
  state.latestLastSourceId = latestResult.sourceFirstItem?.id || "";
  state.latestLastSourceUrl = latestResult.sourceFirstItem?.source_url || "";
  state.latestLastSourceTitle = latestResult.sourceFirstItem?.title || "";

  logLatestSummary(latestResult);

  if (latestResult.items.length > 0) {
    const merged = dedupeVideos([...latestResult.sourceItems, ...latestResult.items, ...mockVideos]);
    state.totalVideos = merged.length;
    updateOldestState(state, merged);
    console.log(`[crawl] outputBefore=${previousCount}`);
    console.log(`[crawl] outputAfter=${merged.length}`);
    await writeVideos(merged);
    await writeState(state);
    console.log(`Updated latest videos: new=${latestResult.items.length} total=${merged.length}`);
    process.exit(0);
  }

  console.log(`[crawl] outputBefore=${previousCount}`);
  console.log(`[crawl] outputAfter=${previousCount}`);
  console.log(`No new latest videos. pages=${latestResult.pagesDone} checked=${latestResult.fetchedCount} duplicates=${latestResult.duplicateCount}`);
  process.exit(0);
}

if (crawlMode !== "backfill") {
  throw new Error(`Unsupported CRAWL_MODE: ${crawlMode}. Use "backfill" or "latest".`);
}

const backfillResult = await crawlBackfill(mockVideos, state);
const previousBackfillCursor = state.backfillCursor;
state.lastBackfillRunAt = now;
state.backfillPage = backfillResult.nextPage;
state.backfillCursor = backfillResult.nextCursor;
state.lastBackfillFetchedCount = backfillResult.fetchedCount;
state.lastBackfillDuplicateCount = backfillResult.duplicateCount;
state.lastBackfillAddedCount = backfillResult.items.length;
state.lastBackfillStopReason = backfillResult.stopReason;

if (backfillResult.items.length > 0) {
  const merged = dedupeVideos([...mockVideos, ...backfillResult.items]);
  state.totalVideos = merged.length;
  updateOldestState(state, merged);
  await writeVideos(merged);
  await writeState(state);
  logBackfillSummary(backfillResult, state);
  console.log(`Backfilled old videos: added=${backfillResult.items.length} total=${merged.length}`);
  process.exit(0);
}

logBackfillSummary(backfillResult, state);
if (backfillProgressChanged(previousBackfillCursor, state)) {
  await writeState(state);
  console.log("Saved backfill cursor progress without new videos.");
  process.exit(0);
}
console.log("No old video updates");

async function crawlLatest(currentVideos) {
  const known = createDedupeIndex(currentVideos);
  const items = [];
  const seenPages = new Set();
  let pageUrl = baseUrl;
  let pagesDone = 0;
  let fetchedCount = 0;
  let duplicateCount = 0;
  let listFoundCount = 0;
  let existingCount = 0;
  let candidateCount = 0;
  let parsedCount = 0;
  let parseFailureCount = 0;
  let sourceFirstItem = null;
  const sourceItems = [];

  while (pageUrl && !seenPages.has(pageUrl) && (maxLatestPages <= 0 || pagesDone < maxLatestPages)) {
    seenPages.add(pageUrl);
    const html = await fetchText(pageUrl);
    pagesDone += 1;
    const entryUrls = parseEntryUrls(html, pageUrl);
    assertEntriesFound(entryUrls, html, pageUrl);
    listFoundCount += entryUrls.length;
    console.log(`[crawl] page=${pagesDone} sourceUrl=${pageUrl}`);
    console.log(`[crawl] listFound=${entryUrls.length}`);
    let pageNewCount = 0;
    let pageDuplicateCount = 0;

    for (const entryUrl of entryUrls) {
      fetchedCount += 1;
      const stub = { source_url: normalizeEntryUrl(entryUrl), id: entryIdFromUrl(entryUrl) };
      const stubDuplicateReason = duplicateReason(known, stub);
      if (stubDuplicateReason) {
        duplicateCount += 1;
        existingCount += 1;
        pageDuplicateCount += 1;
        logSkip("latest", stub, stubDuplicateReason);
        if (!sourceFirstItem) {
          const firstItem = await parseVideoPageSafely(entryUrl);
          if (firstItem) {
            sourceFirstItem = firstItem;
            sourceItems.push(firstItem);
            logLatestSourceItem(firstItem);
          } else {
            parseFailureCount += 1;
          }
        }
        continue;
      }

      candidateCount += 1;
      const item = await parseVideoPageSafely(entryUrl);
      if (!item) {
        parseFailureCount += 1;
        continue;
      }
      parsedCount += 1;
      if (!sourceFirstItem) {
        sourceFirstItem = item;
        logLatestSourceItem(item);
      }
      sourceItems.push(item);

      const itemDuplicateReason = duplicateReason(known, item);
      if (itemDuplicateReason) {
        duplicateCount += 1;
        existingCount += 1;
        pageDuplicateCount += 1;
        logSkip("latest", item, itemDuplicateReason);
        continue;
      }

      items.push(item);
      addToIndex(known, item);
      pageNewCount += 1;
      console.log(`[latest] ${item.id} ${item.date} ${item.title.slice(0, 42)}`);

      if (maxNewItems > 0 && items.length >= maxNewItems) {
        return { items, sourceItems, pagesDone, fetchedCount, duplicateCount, listFoundCount, existingCount, candidateCount, parsedCount, parseFailureCount, sourceFirstItem };
      }
      await sleep(delayMs);
    }

    if (pageDuplicateCount > 0 && pageNewCount === 0) {
      console.log(`[crawl] stop=duplicate_page_without_new page=${pagesDone}`);
      break;
    }

    pageUrl = parseNextUrl(html, pageUrl);
    await sleep(delayMs);
  }

  return { items, sourceItems, pagesDone, fetchedCount, duplicateCount, listFoundCount, existingCount, candidateCount, parsedCount, parseFailureCount, sourceFirstItem };
}

async function crawlBackfill(currentVideos, crawlState) {
  const known = createDedupeIndex(currentVideos);
  const items = [];
  const seenPages = new Set();
  const oldestUrl = oldestSourceUrl(currentVideos);
  let pageUrl = crawlState.backfillCursor || oldestUrl || "";
  let currentPage = Number(crawlState.backfillPage || 2);

  if (!crawlState.backfillCursor && oldestUrl) {
    const oldestHtml = await fetchText(oldestUrl);
    pageUrl = parseNextUrl(oldestHtml, oldestUrl) || oldestUrl;
    await sleep(delayMs);
  } else if (!pageUrl) {
    const firstPageHtml = await fetchText(baseUrl);
    pageUrl = parseNextUrl(firstPageHtml, baseUrl);
    currentPage = 2;
    await sleep(delayMs);
  }

  let pagesDone = 0;
  let nextCursor = pageUrl;
  let nextPage = currentPage;
  let fetchedCount = 0;
  let duplicateCount = 0;
  let stopReason = "no_next_cursor";

  while (pageUrl && !seenPages.has(pageUrl) && (maxBackfillPages <= 0 || pagesDone < maxBackfillPages)) {
    seenPages.add(pageUrl);
    const html = await fetchText(pageUrl);
    pagesDone += 1;

    for (const entryUrl of parseEntryUrls(html, pageUrl)) {
      fetchedCount += 1;
      const stub = { source_url: normalizeEntryUrl(entryUrl), id: entryIdFromUrl(entryUrl) };
      if (hasDuplicate(known, stub)) {
        duplicateCount += 1;
        continue;
      }

      const item = await parseVideoPage(entryUrl);
      if (hasDuplicate(known, item)) {
        duplicateCount += 1;
        continue;
      }

      items.push(item);
      addToIndex(known, item);
      console.log(`[backfill] ${item.id} ${item.date} ${item.title.slice(0, 42)}`);

      if (maxOldItems > 0 && items.length >= maxOldItems) {
        nextCursor = parseNextUrl(html, pageUrl) || pageUrl;
        nextPage = currentPage + 1;
        stopReason = "max_old_items";
        return { items, nextCursor, nextPage, pagesDone, fetchedCount, duplicateCount, stopReason };
      }
      await sleep(delayMs);
    }

    nextCursor = parseNextUrl(html, pageUrl);
    nextPage = currentPage + 1;
    stopReason = nextCursor ? "next_cursor" : "no_next_cursor";
    pageUrl = nextCursor;
    currentPage = nextPage;
    await sleep(delayMs);
  }

  if (pageUrl && seenPages.has(pageUrl)) stopReason = "repeated_cursor";
  if (maxBackfillPages > 0 && pagesDone >= maxBackfillPages) stopReason = "max_backfill_pages";
  return { items, nextCursor: nextCursor || "", nextPage, pagesDone, fetchedCount, duplicateCount, stopReason };
}

function logBackfillSummary(result, crawlState) {
  console.log(`Backfill page: ${crawlState.backfillPage}`);
  console.log(`Pages scanned: ${result.pagesDone}`);
  console.log(`Fetched count: ${result.fetchedCount}`);
  console.log(`Duplicate count: ${result.duplicateCount}`);
  console.log(`Added old video count: ${result.items.length}`);
  console.log(`Next backfill cursor: ${crawlState.backfillCursor || ""}`);
  console.log(`Next backfill page: ${crawlState.backfillPage}`);
  console.log(`Stop reason: ${result.stopReason}`);
}

function backfillProgressChanged(previousCursor, crawlState) {
  return Boolean(crawlState.backfillCursor && crawlState.backfillCursor !== previousCursor);
}

function updateOldestState(crawlState, videos) {
  const oldest = oldestVideo(videos);
  crawlState.oldestVideoId = oldest?.id || "";
  crawlState.oldestVideoDate = oldest?.date || "";
}

function oldestVideo(videos) {
  return [...videos]
    .filter((video) => video?.id || video?.date)
    .sort((a, b) => compareVideoAge(a, b))
    .at(-1);
}

function oldestSourceUrl(videos) {
  const oldest = oldestVideo(videos);
  return oldest?.source_url || oldest?.sourceUrl || "";
}

function compareVideoAge(a, b) {
  const dateA = Date.parse(a?.date || a?.publishedAt || a?.createdAt || "");
  const dateB = Date.parse(b?.date || b?.publishedAt || b?.createdAt || "");
  if (Number.isFinite(dateA) && Number.isFinite(dateB) && dateA !== dateB) return dateB - dateA;
  return String(b?.id || "").localeCompare(String(a?.id || ""));
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
  return Boolean(duplicateReason(index, video));
}

function duplicateReason(index, video) {
  const keys = dedupeKeys(video);
  if (keys.sourceUrl && index.sourceUrls.has(keys.sourceUrl)) return "source_url";
  if (keys.titleDuration && index.titleDurations.has(keys.titleDuration)) return "title_duration";
  if (keys.titleThumbnail && index.titleThumbnails.has(keys.titleThumbnail)) return "title_thumbnail";
  if (keys.id && index.ids.has(keys.id)) return "id";
  return "";
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
    oldestVideoId: "",
    oldestVideoDate: "",
    totalVideos: mockVideos.length,
    lastBackfillRunAt: "",
    lastBackfillFetchedCount: 0,
    lastBackfillDuplicateCount: 0,
    lastBackfillAddedCount: 0,
    lastBackfillStopReason: ""
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
  console.log(`[crawl] writeFile=${videosOutput}`);
  await writeFile(videosOutput, source, "utf-8");
}

async function fetchText(url) {
  console.log(`[crawl] fetch=${url}`);
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"
    }
  });
  console.log(`[crawl] httpStatus=${response.status} ok=${response.ok} url=${url}`);
  if (!response.ok) throw new Error(`Fetch failed ${response.status}: ${url}`);
  const text = await response.text();
  assertNormalHtml(text, url, response.status);
  return text;
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
  if (!id || !title || !embedUrl) {
    throw new Error(`Video parse failed: id=${id || ""} title=${title || ""} embed=${embedUrl || ""} url=${url}`);
  }

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

async function parseVideoPageSafely(url) {
  try {
    return await parseVideoPage(url);
  } catch (error) {
    console.log(`[fail:latest] url=${normalizeEntryUrl(url)} reason=${error?.message || error}`);
    return null;
  }
}

function assertNormalHtml(html, url, status) {
  const text = String(html || "");
  const lower = text.toLowerCase();
  if (!text.trim()) throw new Error(`Empty response body: status=${status} url=${url}`);
  if (lower.includes("cf-browser-verification") || lower.includes("just a moment") || lower.includes("captcha")) {
    throw new Error(`Blocked or challenge response: status=${status} url=${url}`);
  }
}

function assertEntriesFound(entryUrls, html, pageUrl) {
  if (entryUrls.length > 0) return;
  const title = cleanText(String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  throw new Error(`No video entries parsed from source page: url=${pageUrl} title=${title || ""} length=${String(html || "").length}`);
}

function logSkip(scope, item, reason) {
  console.log(`[skip:${scope}] id=${item.id || ""} url=${item.source_url || item.sourceUrl || ""} reason=${reason}`);
}

function logLatestSourceItem(item) {
  console.log("[crawl] latestSourceVideo=" + JSON.stringify({
    title: item.title,
    url: item.source_url,
    id: item.id,
    publishedAt: item.date || item.publishedAt || ""
  }));
}

function logLatestSummary(result) {
  console.log(`[crawl] listFound=${result.listFoundCount || 0}`);
  console.log(`[crawl] existing=${result.existingCount || 0}`);
  console.log(`[crawl] candidates=${result.candidateCount || 0}`);
  console.log(`[crawl] parsed=${result.parsedCount || 0}`);
  console.log(`[crawl] duplicates=${result.duplicateCount || 0}`);
  console.log(`[crawl] parseFailed=${result.parseFailureCount || 0}`);
  console.log(`[crawl] finalWriteCount=${result.items.length}`);
}

function parseEntryUrls(html, pageUrl) {
  const links = [...html.matchAll(/<a[^>]+href=["']([^"']*entry=[^"']+)["']/gi)]
    .map((match) => normalizeUrl(decodeHtml(match[1]), pageUrl))
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return parsed.searchParams.has("entry");
      } catch {
        return false;
      }
    })
    .map((url) => normalizeEntryUrl(url));
  return [...new Set(links)].filter((url) => entryIdFromUrl(url));
}

function parseNextUrl(html, pageUrl) {
  const olderEntryUrl = parseOlderEntryUrl(html, pageUrl);
  if (olderEntryUrl) return olderEntryUrl;

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

function parseOlderEntryUrl(html, pageUrl) {
  const currentId = entryIdFromUrl(pageUrl);
  if (!currentId) return "";

  return parseEntryUrls(html, pageUrl)
    .filter((url) => entryIdFromUrl(url) < currentId)
    .sort((a, b) => entryIdFromUrl(b).localeCompare(entryIdFromUrl(a)))
    .at(0) || "";
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
