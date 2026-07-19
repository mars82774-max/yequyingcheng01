import { SourceStopError } from "./source-errors.mjs";
import { createBrowserFetcher } from "./browser-fetch.mjs";

const baseUrl = "https://j-av.com/video/index.php";

export function createJavAdapter(options = {}) {
  const defaultCategory = Array.isArray(options.defaultCategory) ? options.defaultCategory : [];
  const defaultTags = Array.isArray(options.defaultTags) ? options.defaultTags : [];

  return {
    key: "jAv",
    sourceName: "j-av",
    displayName: "J-AV",
    baseUrl,
    enabled: true,
    createContext(env = process.env) {
      return {
        cookie: env.J_AV_COOKIE || env.CRAWL_COOKIE || "",
        maxLatestPages: Number(env.MAX_LATEST_PAGES || 10),
        maxBackfillPages: Number(env.MAX_BACKFILL_PAGES || 0),
        maxBackfillRepairPages: Number(env.MAX_BACKFILL_REPAIR_PAGES || 80),
        backfillRepairSkipPages: Number(env.BACKFILL_REPAIR_SKIP_PAGES || 3),
        maxNewItems: Number(env.MAX_NEW_ITEMS || 20),
        maxOldItems: Number(env.MAX_OLD_ITEMS || 24),
        delayMs: Number(env.CRAWL_DELAY_MS || 800),
        crawlFetchMode: String(env.CRAWL_FETCH_MODE || "http").toLowerCase(),
        timeoutMs: Number(env.CRAWL_TIMEOUT_MS || 30000),
        browserFetcher: null,
        fetchImpl: null
      };
    },
    async crawlLatest(ctx) {
      return crawlLatest({ ...ctx, defaultCategory, defaultTags });
    },
    async crawlBackfill(ctx) {
      return crawlBackfill({ ...ctx, defaultCategory, defaultTags });
    },
    normalizeSourceUrl,
    videoIdentity(video) {
      return video?.sourceUrl || video?.source_url || "";
    }
  };
}

async function crawlLatest(ctx) {
  const {
    currentVideos,
    known,
    duplicateReason,
    addToIndex,
    maxLatestPages,
    maxNewItems,
    delayMs
  } = ctx;
  const items = [];
  const sourceItems = [];
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
  let oldestCandidateUrl = "";

  while (pageUrl && !seenPages.has(pageUrl) && (maxLatestPages <= 0 || pagesDone < maxLatestPages)) {
    seenPages.add(pageUrl);
    const html = await fetchText(pageUrl, ctx);
    pagesDone += 1;
    const entryUrls = parseEntryUrls(html, pageUrl);
    assertEntriesFound(entryUrls, html, pageUrl);
    listFoundCount += entryUrls.length;
    oldestCandidateUrl = entryUrls.at(-1) ? normalizeEntryUrl(entryUrls.at(-1)) : oldestCandidateUrl;
    console.log(`[crawl:${ctx.sourceName}] page=${pagesDone} currentUrl=${pageUrl}`);
    console.log(`[crawl:${ctx.sourceName}] listFound=${entryUrls.length}`);
    let pageNewCount = 0;
    let pageDuplicateCount = 0;

    for (const entryUrl of entryUrls) {
      fetchedCount += 1;
      const stub = { sourceUrl: normalizeEntryUrl(entryUrl), source_url: normalizeEntryUrl(entryUrl), id: entryIdFromUrl(entryUrl) };
      const stubDuplicateReason = duplicateReason(known, stub);
      if (stubDuplicateReason) {
        duplicateCount += 1;
        existingCount += 1;
        pageDuplicateCount += 1;
        logSkip("latest", stub, stubDuplicateReason);
        if (!sourceFirstItem) {
          const firstItem = await parseVideoPageSafely(entryUrl, ctx, "latest");
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
      const item = await parseVideoPageSafely(entryUrl, ctx, "latest");
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
      console.log(`[latest:${ctx.sourceName}] ${item.id} ${item.publishedAt || item.date} ${item.title.slice(0, 42)}`);

      if (maxNewItems > 0 && items.length >= maxNewItems) {
        return result({ items, sourceItems, pagesDone, scannedPageCount: pagesDone, fetchedCount, duplicateCount, listFoundCount, existingCount, candidateCount, parsedCount, parseFailureCount, sourceFirstItem, oldestCandidateUrl, nextCursor: pageUrl });
      }
      await sleep(delayMs);
    }

    if (pageDuplicateCount > 0 && pageNewCount === 0) {
      console.log(`[crawl:${ctx.sourceName}] stop=duplicate_page_without_new page=${pagesDone}`);
      break;
    }

    const nextUrl = parseNextUrl(html, pageUrl);
    console.log(`[crawl:${ctx.sourceName}] nextUrl=${nextUrl || ""}`);
    console.log(`[crawl:${ctx.sourceName}] hasMore=${Boolean(nextUrl)}`);
    pageUrl = nextUrl;
    await sleep(delayMs);
  }

  return result({ items, sourceItems, pagesDone, scannedPageCount: pagesDone, fetchedCount, duplicateCount, listFoundCount, existingCount, candidateCount, parsedCount, parseFailureCount, sourceFirstItem, oldestCandidateUrl, nextCursor: pageUrl || "" });
}

async function crawlBackfill(ctx) {
  const {
    currentVideos,
    state,
    known,
    duplicateReason,
    addToIndex,
    maxBackfillPages,
    maxOldItems,
    delayMs
  } = ctx;
  const items = [];
  const seenPages = new Set();
  const oldestUrl = oldestSourceUrl(currentVideos);
  let pageUrl = state.backfillCursor || oldestUrl || "";
  let currentPage = Number(state.backfillPage || 2);

  if (state.backfillCursor && !hasListCursorParams(state.backfillCursor)) {
    console.log(`[backfill:${ctx.sourceName}] repairCursor reason=missing_list_cursor_params cursor=${state.backfillCursor}`);
    const repair = await findBackfillRepairCursor(ctx);
    if (repair.url) {
      pageUrl = repair.url;
      currentPage = repair.page;
      console.log(`[backfill:${ctx.sourceName}] repairCursor page=${repair.page} url=${repair.url}`);
    }
  } else if (oldestUrl && !state.backfillCursor) {
    const oldestHtml = await fetchText(oldestUrl, ctx);
    pageUrl = parseNextUrl(oldestHtml, oldestUrl) || oldestUrl;
    await sleep(delayMs);
  } else if (!pageUrl) {
    const firstPageHtml = await fetchText(baseUrl, ctx);
    pageUrl = parseNextUrl(firstPageHtml, baseUrl);
    currentPage = 2;
    await sleep(delayMs);
  }

  let pagesDone = 0;
  let nextCursor = pageUrl;
  let nextPage = currentPage;
  let fetchedCount = 0;
  let duplicateCount = 0;
  let listFoundCount = 0;
  let existingCount = 0;
  let candidateCount = 0;
  let parsedCount = 0;
  let parseFailureCount = 0;
  let stopReason = "no_next_cursor";

  console.log(`[backfill:${ctx.sourceName}] startCursor=${pageUrl || ""}`);
  console.log(`[backfill:${ctx.sourceName}] startPage=${currentPage}`);
  console.log(`[backfill:${ctx.sourceName}] maxOldItems=${maxOldItems}`);
  console.log(`[backfill:${ctx.sourceName}] maxBackfillPages=${maxBackfillPages}`);

  while (pageUrl && !seenPages.has(pageUrl) && (maxBackfillPages <= 0 || pagesDone < maxBackfillPages)) {
    seenPages.add(pageUrl);
    const html = await fetchText(pageUrl, ctx);
    pagesDone += 1;
    const pageEntryId = entryIdFromUrl(pageUrl);
    const entryUrls = parseContentEntryUrls(html, pageUrl);
    listFoundCount += entryUrls.length;
    console.log(`[backfill:${ctx.sourceName}] page=${pagesDone} currentUrl=${pageUrl}`);
    console.log(`[backfill:${ctx.sourceName}] listFound=${entryUrls.length}`);

    const pageCandidates = pageEntryId && !hasListCursorParams(pageUrl) ? [normalizeEntryUrl(pageUrl)] : entryUrls;

    for (const entryUrl of pageCandidates) {
      fetchedCount += 1;
      const stub = { sourceUrl: normalizeEntryUrl(entryUrl), source_url: normalizeEntryUrl(entryUrl), id: entryIdFromUrl(entryUrl) };
      const stubDuplicateReason = duplicateReason(known, stub);
      if (stubDuplicateReason) {
        duplicateCount += 1;
        existingCount += 1;
        logSkip("backfill", stub, stubDuplicateReason);
        continue;
      }

      candidateCount += 1;
      const item = await parseVideoPageSafely(entryUrl, ctx, "backfill");
      if (!item) {
        parseFailureCount += 1;
        continue;
      }
      parsedCount += 1;

      const itemDuplicateReason = duplicateReason(known, item);
      if (itemDuplicateReason) {
        duplicateCount += 1;
        existingCount += 1;
        logSkip("backfill", item, itemDuplicateReason);
        continue;
      }

      items.push(item);
      addToIndex(known, item);
      console.log(`[backfill:${ctx.sourceName}] ${item.id} ${item.publishedAt || item.date} ${item.title.slice(0, 42)}`);

      if (maxOldItems > 0 && items.length >= maxOldItems) {
        nextCursor = parseNextUrl(html, pageUrl) || pageUrl;
        nextPage = currentPage + 1;
        stopReason = "max_old_items";
        return result({ items, nextCursor, nextPage, pagesDone, fetchedCount, duplicateCount, listFoundCount, existingCount, candidateCount, parsedCount, parseFailureCount, stopReason });
      }
      await sleep(delayMs);
    }

    nextCursor = parseNextUrl(html, pageUrl);
    nextPage = currentPage + 1;
    stopReason = nextCursor ? "next_cursor" : "no_next_cursor";
    console.log(`[backfill:${ctx.sourceName}] nextUrl=${nextCursor || ""}`);
    console.log(`[backfill:${ctx.sourceName}] hasMore=${Boolean(nextCursor)}`);
    pageUrl = nextCursor;
    currentPage = nextPage;
    await sleep(delayMs);
  }

  if (pageUrl && seenPages.has(pageUrl)) stopReason = "repeated_cursor";
  if (maxBackfillPages > 0 && pagesDone >= maxBackfillPages) stopReason = "max_backfill_pages";
  return result({ items, nextCursor: nextCursor || "", nextPage, pagesDone, fetchedCount, duplicateCount, listFoundCount, existingCount, candidateCount, parsedCount, parseFailureCount, stopReason });
}

async function findBackfillRepairCursor(ctx) {
  let pageUrl = baseUrl;
  let page = 1;
  while (pageUrl && page <= ctx.maxBackfillRepairPages) {
    const html = await fetchText(pageUrl, ctx);
    const entryUrls = parseContentEntryUrls(html, pageUrl);
    const missingCount = page > ctx.backfillRepairSkipPages
      ? entryUrls.filter((entryUrl) => !ctx.duplicateReason(ctx.known, { sourceUrl: normalizeEntryUrl(entryUrl), source_url: normalizeEntryUrl(entryUrl), id: entryIdFromUrl(entryUrl) })).length
      : 0;
    console.log(`[backfill:${ctx.sourceName}] repairScan page=${page} entries=${entryUrls.length} missing=${missingCount} url=${pageUrl}`);
    if (missingCount > 0) return { url: pageUrl, page };
    pageUrl = parseNextUrl(html, pageUrl);
    page += 1;
  }
  return { url: "", page: 0 };
}

async function fetchText(url, ctx) {
  console.log(`[crawl:${ctx.sourceName}] fetch=${url}`);
  const fetchMode = ctx.crawlFetchMode === "browser" ? "browser" : "http";
  console.log(`[crawl:${ctx.sourceName}] crawlFetchMode=${fetchMode}`);
  if (fetchMode === "browser") return fetchTextWithBrowser(url, ctx);

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    "Referer": baseUrl
  };
  if (ctx.cookie) headers.Cookie = ctx.cookie;

  let response;
  try {
    const fetchImpl = ctx.fetchImpl || fetch;
    response = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(Number(ctx.timeoutMs || 20000))
    });
  } catch (error) {
    const failureKind = networkFailureKind(error);
    throw new SourceStopError(`Source request failed: ${error?.message || error}`, {
      retryable: true,
      blocked: false,
      url,
      httpStatus: 0,
      failureKind,
      errorCode: error?.cause?.code || error?.code || ""
    });
  }

  console.log(`[crawl:${ctx.sourceName}] httpStatus=${response.status} ok=${response.ok} url=${url}`);
  const text = await response.text();
  const title = cleanText(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  console.log(`[crawl:${ctx.sourceName}] responseLength=${text.length} title=${title || ""}`);
  assertNormalHtml(text, url, response.status);
  if (!response.ok) {
    const blocked = response.status === 429 || response.status >= 500;
    throw new SourceStopError(`Fetch failed ${response.status}: ${url} title=${title || ""} length=${text.length}`, {
      retryable: blocked,
      blocked,
      url,
      httpStatus: response.status,
      failureKind: response.status >= 500 ? "upstream_5xx" : "http_error",
      retryAfterSeconds: retryAfterSeconds(response.headers)
    });
  }
  return text;
}

async function fetchTextWithBrowser(url, ctx) {
  if (!ctx.browserFetcher) {
    ctx.browserFetcher = await createBrowserFetcher(process.env);
  }

  let result;
  try {
    result = await ctx.browserFetcher.fetchText(url);
  } catch (error) {
    const message = String(error?.message || error);
    const stopReason = message.includes("CHALLENGE_TIMEOUT")
      ? `CHALLENGE_TIMEOUT: ${url}. Cloudflare challenge did not clear within the browser wait window.`
      : `Browser request failed: ${message}. Run npm run browser:verify if verification is required.`;
    throw new SourceStopError(stopReason, {
      retryable: true,
      blocked: true,
      url,
      httpStatus: 0
    });
  }

  const ok = result.status >= 200 && result.status < 400;
  console.log(`[crawl:${ctx.sourceName}] httpStatus=${result.status} ok=${ok} url=${url}`);
  console.log(`[crawl:${ctx.sourceName}] finalUrl=${result.finalUrl || ""}`);
  console.log(`[crawl:${ctx.sourceName}] responseLength=${result.html.length} title=${result.title || ""}`);
  assertNormalHtml(result.html, url, result.status);
  if (!ok) {
    const blocked = result.status === 429 || result.status >= 500;
    throw new SourceStopError(`Browser fetch failed ${result.status}: ${url} title=${result.title || ""} length=${result.html.length}. Run npm run browser:verify if verification is required.`, {
      retryable: blocked,
      blocked,
      url,
      httpStatus: result.status,
      failureKind: result.status >= 500 ? "upstream_5xx" : "http_error"
    });
  }
  return result.html;
}

async function parseVideoPage(url, ctx) {
  const html = await fetchText(url, ctx);
  const embedUrl = normalizeUrl(findFirst(html, /<iframe[^>]+src=["']([^"']+)["']/gi, (value) => value.includes("a-big.com/player")), url);
  const thumbnail = coverFromEmbed(embedUrl);
  const title = cleanText(
    findFirst(html, /<div[^>]+class=["'][^"']*blog_subject[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
      findFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i)?.split(" - J-AV")[0] ||
      entryIdFromUrl(url)
  );
  const publishedAt = cleanText(findFirst(html, /<div[^>]+class=["'][^"']*blog_date[^"']*["'][^>]*>([\s\S]*?)<\/div>/i));
  const id = entryIdFromUrl(url);
  if (!id || !title || !embedUrl) {
    throw new Error(`Video parse failed: id=${id || ""} title=${title || ""} embed=${embedUrl || ""} url=${url}`);
  }

  return normalizeVideo({
    id,
    title,
    thumbnail,
    duration: "",
    sourceUrl: normalizeEntryUrl(url),
    playUrl: embedUrl,
    publishedAt,
    actors: [],
    tags: inferTags(title, thumbnail, ctx.defaultTags),
    sourceName: ctx.sourceName,
    category: ctx.defaultCategory
  });
}

async function parseVideoPageSafely(url, ctx, scope = "latest") {
  try {
    return await parseVideoPage(url, ctx);
  } catch (error) {
    if (error instanceof SourceStopError) throw error;
    console.log(`[fail:${scope}:${ctx.sourceName}] url=${normalizeEntryUrl(url)} reason=${error?.message || error}`);
    return null;
  }
}

function normalizeVideo(video) {
  return {
    id: video.id,
    slug: video.id,
    title: video.title,
    thumbnail: video.thumbnail || "",
    duration: video.duration || "",
    sourceUrl: video.sourceUrl || "",
    playUrl: video.playUrl || "",
    publishedAt: video.publishedAt || "",
    actors: Array.isArray(video.actors) ? video.actors : [],
    tags: Array.isArray(video.tags) ? video.tags : [],
    sourceName: video.sourceName || "j-av",
    source_url: video.sourceUrl || "",
    embed_url: video.playUrl || "",
    cover_source: video.thumbnail || "",
    cover: video.thumbnail || "",
    date: video.publishedAt || "",
    category: Array.isArray(video.category) ? video.category : [],
    type: "iframe",
    provider: video.sourceName || "j-av"
  };
}

function result(values) {
  return {
    sourceName: "j-av",
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
    hasMore: Boolean(values.nextCursor),
    stopReason: "completed",
    ...values
  };
}

function assertNormalHtml(html, url, status) {
  const text = String(html || "");
  const lower = text.toLowerCase();
  const title = cleanText(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  if (!text.trim()) {
    throw new SourceStopError(`Empty response body: status=${status} url=${url}`, { retryable: true, blocked: true, url, httpStatus: status });
  }
  if (lower.includes("cf-browser-verification") || lower.includes("just a moment") || lower.includes("captcha")) {
    throw new SourceStopError(`Blocked or challenge response: status=${status} title=${title || ""} url=${url}. Run npm run browser:verify and complete the site's normal browser verification if required.`, {
      retryable: true,
      blocked: true,
      url,
      httpStatus: status,
      failureKind: "cloudflare_challenge",
      challenge: true
    });
  }
}

function retryAfterSeconds(headers) {
  const raw = headers?.get?.("retry-after") || "";
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const dateValue = Date.parse(raw);
  if (Number.isFinite(dateValue)) return Math.max(0, Math.ceil((dateValue - Date.now()) / 1000));
  return 0;
}

function networkFailureKind(error) {
  const name = error?.name || "";
  const code = error?.code || "";
  const causeCode = error?.cause?.code || "";
  const message = error?.message || "";
  const combined = [name, code, causeCode, message, error?.cause?.message].filter(Boolean).join(" ");
  if (combined.includes("UND_ERR_CONNECT_TIMEOUT") || combined.includes("ETIMEDOUT")) return "connect_timeout";
  if (combined.includes("UND_ERR_HEADERS_TIMEOUT")) return "headers_timeout";
  if (combined.includes("ECONNRESET")) return "connection_reset";
  if (name === "AbortError" || name === "TimeoutError" || combined.includes("The operation was aborted due to timeout")) return "timeout";
  return "network_error";
}

function assertEntriesFound(entryUrls, html, pageUrl) {
  if (entryUrls.length > 0) return;
  const title = cleanText(String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  throw new Error(`No video entries parsed from source page: url=${pageUrl} title=${title || ""} length=${String(html || "").length}`);
}

function logSkip(scope, item, reason) {
  console.log(`[skip:${scope}:j-av] id=${item.id || ""} url=${item.sourceUrl || item.source_url || ""} reason=${reason}`);
}

function logLatestSourceItem(item) {
  console.log("[crawl] latestSourceVideo=" + JSON.stringify({
    title: item.title,
    url: item.sourceUrl || item.source_url,
    id: item.id,
    publishedAt: item.publishedAt || item.date || ""
  }));
}

function oldestVideo(videos) {
  return [...videos]
    .filter((video) => video?.id || video?.date || video?.publishedAt)
    .sort((a, b) => compareVideoAge(a, b))
    .at(-1);
}

function oldestSourceUrl(videos) {
  const oldest = oldestVideo(videos);
  return oldest?.sourceUrl || oldest?.source_url || "";
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

function parseEntryUrls(html, pageUrl) {
  const links = parseEntryLinks(html, pageUrl).map((link) => normalizeEntryUrl(link.url));
  return [...new Set(links)].filter((url) => entryIdFromUrl(url));
}

function parseContentEntryUrls(html, pageUrl) {
  const links = parseEntryLinks(html, pageUrl)
    .filter((link) => link.label && !isPaginationLabel(link.label))
    .map((link) => normalizeEntryUrl(link.url));
  return [...new Set(links)].filter((url) => entryIdFromUrl(url));
}

function parseEntryLinks(html, pageUrl) {
  return [...html.matchAll(/<a[^>]+href=["']([^"']*entry=[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({
      url: normalizeUrl(decodeHtml(match[1]), pageUrl),
      label: cleanText(match[2] || "")
    }))
    .filter((link) => {
      try {
        const parsed = new URL(link.url);
        return parsed.searchParams.has("entry");
      } catch {
        return false;
      }
    });
}

function isPaginationLabel(label) {
  const text = cleanText(label).toLowerCase();
  return /^\d+$/.test(text) || ["\u7b2c\u4e00\u9801", "\u4e0a\u4e00\u9801", "\u4e0b\u4e00\u9801", "first", "prev", "previous", "next", "older"].includes(text);
}

function parseNextUrl(html, pageUrl) {
  const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const [, href, label] of links) {
    const text = cleanText(label).toLowerCase();
    if (href.includes("entry=") && (text.includes("next") || text.includes("older") || text.includes("\u4e0b\u4e00\u9801"))) {
      return normalizeUrl(decodeHtml(href), pageUrl);
    }
  }

  if (entryIdFromUrl(pageUrl)) return "";

  const numericLinks = links
    .map(([, href, label]) => ({ href, text: cleanText(label) }))
    .filter((link) => link.href.includes("entry=") && /^\d+$/.test(link.text))
    .sort((a, b) => Number(a.text) - Number(b.text));
  return numericLinks.length > 0 ? normalizeUrl(decodeHtml(numericLinks[0].href), pageUrl) : "";
}

function hasListCursorParams(url) {
  try {
    const parsed = new URL(url, baseUrl);
    return parsed.searchParams.has("entry") && parsed.searchParams.has("m") && parsed.searchParams.has("y") && parsed.searchParams.has("d");
  } catch {
    return false;
  }
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

function inferTags(title, thumbnail, defaultTags) {
  const tags = [...defaultTags];
  const code = findCode(title) || findCode(thumbnail);
  if (code) {
    tags.push(code);
    tags.push(code.split("-")[0]);
  }
  return dedupe(tags);
}

function findCode(value = "") {
  return String(value).match(/[a-z]{2,12}-?\d{2,5}/i)?.[0]?.toUpperCase().replace(/([A-Z]+)(\d+)$/, "$1-$2") || "";
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
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
