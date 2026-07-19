import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mockVideos } from "../src/mockVideos.js";
import { createJavAdapter } from "./video-sources/j-av.mjs";
import { createSourceTemplateAdapter } from "./video-sources/template.mjs";
import { isSourceStopError } from "./video-sources/source-errors.mjs";
import {
  crawlLatestWithRetry,
  latestRetryDelaysFromEnv,
  latestRunOutcome,
  recordSourceFailure,
  recordSourceSuccess,
  sourceHealth,
  sourceSkipReason
} from "./video-crawl-policy.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const videosOutput = join(root, "src", "mockVideos.js");
const stateOutput = join(root, "src", "videoCrawlState.json");
const crawlMode = (process.env.CRAWL_MODE || "backfill").toLowerCase();
const dryRun = ["1", "true", "yes"].includes(String(process.env.CRAWL_DRY_RUN || "").toLowerCase());
const failurePauseThreshold = Number(process.env.SOURCE_FAILURE_PAUSE_THRESHOLD || 3);
const blockedPauseHours = Number(process.env.SOURCE_BLOCKED_PAUSE_HOURS || 24);
const latestRetryDelaysMs = latestRetryDelaysFromEnv(process.env);
const now = new Date();

const sources = [
  createJavAdapter({
    defaultCategory: defaultList("category"),
    defaultTags: defaultList("tags")
  }),
  createSourceTemplateAdapter()
].filter((source) => source.enabled !== false);

const state = await readState();
state.sourceHealth = state.sourceHealth || {};

console.log(`[crawl] mode=${crawlMode}`);
console.log(`[crawl] dryRun=${dryRun}`);
console.log(`[crawl] videosOutput=${videosOutput}`);
console.log(`[crawl] stateOutput=${stateOutput}`);
console.log(`[crawl] existingVideos=${mockVideos.length}`);
console.log(`[crawl] sources=${sources.map((source) => source.sourceName).join(",")}`);
console.log("[crawl] state=" + JSON.stringify(crawlStateSummary(state)));

if (!["latest", "backfill"].includes(crawlMode)) {
  throw new Error(`Unsupported CRAWL_MODE: ${crawlMode}. Use "backfill" or "latest".`);
}

const previousCount = mockVideos.length;
const known = createDedupeIndex(mockVideos);
const collectedItems = [];
const collectedSourceItems = [];
const runResults = [];
let healthChanged = false;
let cursorChanged = false;
let completedSourceCount = 0;
let requestPerformedCount = 0;
let pausedSourceCount = 0;
let failedSourceCount = 0;

for (const source of sources) {
  const health = sourceHealth(state, source, crawlMode, now);
  if (health._changed) {
    console.log(`[source:${source.sourceName}] cooldown expired`);
  }
  healthChanged = Boolean(health._changed) || healthChanged;
  delete health._changed;
  const skipReason = sourceSkipReason(source, health, now);
  if (skipReason) {
    pausedSourceCount += 1;
    console.log(`[source:${source.sourceName}] skipped reason=${skipReason} blockedUntil=${health.blockedUntil || ""} requestPerformed=false crawlStatus=${skipReason}`);
    console.log("No source request was performed");
    runResults.push(emptyResult(source.sourceName, skipReason, null, false));
    continue;
  }

  const sourceContext = source.createContext(process.env);
  const ctx = {
    ...sourceContext,
    sourceName: source.sourceName,
    currentVideos: mockVideos,
    state,
    known,
    duplicateReason,
    addToIndex
  };

  console.log(`[source:${source.sourceName}] start cookieConfigured=${Boolean(sourceContext.cookie)}`);
  try {
    const result = crawlMode === "latest"
      ? await crawlLatestWithRetry(source, ctx, { retryDelaysMs: latestRetryDelaysMs, log: console.log })
      : await source.crawlBackfill(ctx);
    runResults.push(result);
    requestPerformedCount += result.requestPerformed === false ? 0 : 1;
    completedSourceCount += 1;

    healthChanged = recordSourceSuccess(health, now) || healthChanged;

    for (const item of result.items) {
      collectedItems.push(normalizeStoredVideo(item));
    }
    for (const item of result.sourceItems || []) {
      collectedSourceItems.push(normalizeStoredVideo(item));
    }

    if (crawlMode === "backfill" && source.key === "jAv") {
      cursorChanged = updateBackfillStateFromResult(state, result);
    }
    if (crawlMode === "latest" && source.key === "jAv") {
      updateLatestStateFromResult(state, result);
    }

    logRunSummary(result);
  } catch (error) {
    if (!isSourceStopError(error)) throw error;
    requestPerformedCount += 1;
    failedSourceCount += 1;
    console.log(`[source:${source.sourceName}] stopped reason=${error.message}`);
    console.log(`[source:${source.sourceName}] httpStatus=${error.httpStatus || 0} blocked=${Boolean(error.blocked)} retryable=${Boolean(error.retryable)}`);
    const failureRecord = recordSourceFailure(health, error, now, { mode: crawlMode, failurePauseThreshold, blockedPauseHours });
    if (failureRecord.blocked) {
      console.log(`[source] paused until ${health.blockedUntil}`);
    } else if (error.blocked) {
      console.log(`[source] blocked this run; consecutiveFailures=${health.consecutiveFailures}/${failurePauseThreshold}`);
    }
    healthChanged = true;
    runResults.push(emptyResult(source.sourceName, error.message, error, true));
    break;
  } finally {
    if (ctx.browserFetcher) {
      await ctx.browserFetcher.close();
      ctx.browserFetcher = null;
    }
  }
}

let merged = mockVideos;
if (collectedItems.length > 0 || (crawlMode === "latest" && collectedSourceItems.length > 0)) {
  merged = crawlMode === "latest"
    ? dedupeVideos([...collectedSourceItems, ...collectedItems, ...mockVideos])
    : dedupeVideos([...mockVideos, ...collectedItems]);
  state.totalVideos = merged.length;
  updateOldestState(state, merged);
}

if (crawlMode === "latest" && completedSourceCount > 0) {
  state.latestLastRunAt = now.toISOString();
  state.latestLastNewCount = collectedItems.length;
}

console.log(`[crawl] outputBefore=${previousCount}`);
console.log(`[crawl] outputAfter=${merged.length}`);
console.log(`[crawl] addedCount=${merged.length - previousCount}`);
console.log(`[crawl] totalVideoCount=${merged.length}`);
console.log(`[crawl] requestPerformed=${requestPerformedCount > 0}`);
console.log(`[crawl] completedSources=${completedSourceCount}`);
console.log(`[crawl] failedSources=${failedSourceCount}`);
console.log(`[crawl] pausedSources=${pausedSourceCount}`);

if (crawlMode === "latest" && completedSourceCount === 0) {
  if (!dryRun && (healthChanged || cursorChanged)) {
    await writeState(state);
    console.log("[crawl] wrote state only");
  } else if (dryRun) {
    console.log("[crawl] dryRun=true skip writes");
  }
  console.error("[crawl] latest failed: no source completed successfully");
  process.exit(1);
}

if (dryRun) {
  console.log("[crawl] dryRun=true skip writes");
  process.exit(0);
}

if (merged.length !== previousCount || collectedItems.length > 0) {
  await writeVideos(merged);
  await writeState(state);
  console.log(`[crawl] wrote videos/state`);
  process.exit(0);
}

if (healthChanged || cursorChanged) {
  await writeState(state);
  console.log("[crawl] wrote state only");
  if (crawlMode === "latest") {
    const outcome = latestRunOutcome({ completedSourceCount, newCount: collectedItems.length });
    if (outcome.printNoNewLatest) console.log(outcome.message);
  }
  process.exit(0);
}

if (crawlMode === "latest") {
  const outcome = latestRunOutcome({ completedSourceCount, newCount: collectedItems.length });
  if (outcome.printNoNewLatest) console.log(outcome.message);
} else {
  console.log("No old video updates");
}

function updateLatestStateFromResult(crawlState, result) {
  const first = result.sourceFirstItem;
  crawlState.latestLastSourceId = first?.id || crawlState.latestLastSourceId || "";
  crawlState.latestLastSourceUrl = first?.sourceUrl || first?.source_url || crawlState.latestLastSourceUrl || "";
  crawlState.latestLastSourceTitle = first?.title || crawlState.latestLastSourceTitle || "";
}

function updateBackfillStateFromResult(crawlState, result) {
  if (!result.items.length) return false;
  const previousCursor = crawlState.backfillCursor || "";
  crawlState.lastBackfillRunAt = now.toISOString();
  crawlState.backfillPage = result.nextPage || crawlState.backfillPage;
  crawlState.backfillCursor = result.nextCursor || crawlState.backfillCursor;
  crawlState.lastBackfillFetchedCount = result.fetchedCount;
  crawlState.lastBackfillDuplicateCount = result.duplicateCount;
  crawlState.lastBackfillAddedCount = result.items.length;
  crawlState.lastBackfillStopReason = result.stopReason;
  return previousCursor !== crawlState.backfillCursor;
}

function logRunSummary(result) {
  console.log(`[crawl:${result.sourceName}] pagesScanned=${result.pagesDone}`);
  console.log(`[crawl:${result.sourceName}] scannedPageCount=${result.scannedPageCount || result.pagesDone || 0}`);
  console.log(`[crawl:${result.sourceName}] fetched=${result.fetchedCount}`);
  console.log(`[crawl:${result.sourceName}] listFound=${result.listFoundCount || 0}`);
  console.log(`[crawl:${result.sourceName}] existing=${result.existingCount || 0}`);
  console.log(`[crawl:${result.sourceName}] candidates=${result.candidateCount || 0}`);
  console.log(`[crawl:${result.sourceName}] parsed=${result.parsedCount || 0}`);
  console.log(`[crawl:${result.sourceName}] duplicates=${result.duplicateCount}`);
  console.log(`[crawl:${result.sourceName}] parseFailed=${result.parseFailureCount || 0}`);
  console.log(`[crawl:${result.sourceName}] added=${result.items.length}`);
  console.log(`[crawl:${result.sourceName}] newCount=${result.items.length}`);
  console.log(`[crawl:${result.sourceName}] oldestCandidateUrl=${result.oldestCandidateUrl || ""}`);
  console.log(`[crawl:${result.sourceName}] nextUrl=${result.nextCursor || ""}`);
  console.log(`[crawl:${result.sourceName}] hasMore=${Boolean(result.hasMore)}`);
  console.log(`[crawl:${result.sourceName}] stopReason=${result.stopReason}`);
}

function emptyResult(sourceName, stopReason, error = null, requestPerformed = false) {
  return {
    sourceName,
    items: [],
    sourceItems: [],
    pagesDone: 0,
    scannedPageCount: 0,
    fetchedCount: 0,
    duplicateCount: 0,
    listFoundCount: 0,
    existingCount: 0,
    candidateCount: 0,
    parsedCount: 0,
    parseFailureCount: 0,
    nextCursor: "",
    oldestCandidateUrl: "",
    nextPage: 0,
    hasMore: false,
    stopReason,
    error,
    requestPerformed
  };
}

function normalizeStoredVideo(video) {
  const sourceUrl = video.sourceUrl || video.source_url || "";
  const playUrl = video.playUrl || video.embed_url || "";
  const thumbnail = video.thumbnail || video.cover || video.cover_source || "";
  const publishedAt = video.publishedAt || video.date || video.createdAt || "";
  const sourceName = video.sourceName || video.provider || "unknown";
  return {
    ...video,
    id: video.id,
    slug: video.slug || video.id,
    title: video.title || video.id,
    thumbnail,
    duration: video.duration || "",
    sourceUrl,
    playUrl,
    publishedAt,
    actors: Array.isArray(video.actors) ? video.actors : [],
    tags: Array.isArray(video.tags) ? video.tags : [],
    sourceName,
    source_url: sourceUrl,
    embed_url: playUrl,
    cover_source: thumbnail,
    cover: thumbnail,
    date: publishedAt,
    category: Array.isArray(video.category) ? video.category : defaultList("category"),
    type: video.type || "iframe",
    provider: video.provider || sourceName
  };
}

function updateOldestState(crawlState, videos) {
  const oldest = oldestVideo(videos);
  crawlState.oldestVideoId = oldest?.id || "";
  crawlState.oldestVideoDate = oldest?.date || oldest?.publishedAt || "";
}

function oldestVideo(videos) {
  return [...videos]
    .filter((video) => video?.id || video?.date || video?.publishedAt)
    .sort((a, b) => compareVideoAge(a, b))
    .at(-1);
}

function compareVideoAge(a, b) {
  const dateA = videoDateValue(a);
  const dateB = videoDateValue(b);
  if (Number.isFinite(dateA) && Number.isFinite(dateB) && dateA !== dateB) return dateB - dateA;
  return String(b?.id || "").localeCompare(String(a?.id || ""));
}

function videoDateValue(video) {
  const raw = String(video?.publishedAt || video?.date || video?.createdAt || "").trim();
  const numericDate = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (numericDate) {
    const [, year, month, day] = numericDate;
    return Date.UTC(Number(year), Number(month) - 1, Number(day));
  }
  return Date.parse(raw);
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
    lastBackfillStopReason: "",
    sourceHealth: {}
  };

  try {
    const existing = JSON.parse(await readFile(stateOutput, "utf-8"));
    return { ...fallback, ...existing, sourceHealth: existing.sourceHealth || {} };
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

function crawlStateSummary(crawlState) {
  return {
    latestLastRunAt: crawlState.latestLastRunAt || "",
    latestLastNewCount: crawlState.latestLastNewCount || 0,
    backfillPage: crawlState.backfillPage || 0,
    backfillCursor: crawlState.backfillCursor || "",
    totalVideos: crawlState.totalVideos || mockVideos.length,
    lastBackfillRunAt: crawlState.lastBackfillRunAt || "",
    lastBackfillFetchedCount: crawlState.lastBackfillFetchedCount || 0,
    lastBackfillDuplicateCount: crawlState.lastBackfillDuplicateCount || 0,
    lastBackfillAddedCount: crawlState.lastBackfillAddedCount || 0,
    lastBackfillStopReason: crawlState.lastBackfillStopReason || "",
    sourceHealth: crawlState.sourceHealth || {}
  };
}

function defaultList(field) {
  const values = mockVideos[0]?.[field];
  return Array.isArray(values) ? [...values.slice(0, 2)] : [];
}

function normalizeSourceUrl(url) {
  try {
    const parsed = new URL(url || "", "https://j-av.com/video/index.php");
    const entry = parsed.searchParams.get("entry") || "";
    return entry ? `https://j-av.com/video/index.php?entry=${encodeURIComponent(entry)}` : parsed.toString();
  } catch {
    return url || "";
  }
}

function normalizeKey(value = "") {
  return String(value).replace(/\s+/g, " ").trim().toLowerCase();
}
