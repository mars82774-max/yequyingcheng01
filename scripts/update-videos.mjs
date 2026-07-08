import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mockVideos } from "../src/mockVideos.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "src", "mockVideos.js");
const baseUrl = "https://j-av.com/video/index.php";
const maxPages = Number(process.env.MAX_PAGES || 0);
const maxNewItems = Number(process.env.MAX_NEW_ITEMS || 0);
const maxOldItems = Number(process.env.MAX_OLD_ITEMS || 24);
const delayMs = Number(process.env.CRAWL_DELAY_MS || 800);

const knownIds = new Set(mockVideos.map((video) => video.id));
const newestExistingId = mockVideos[0]?.id || "";
const newHeadItems = [];
const oldTailItems = [];
const seenPages = new Set();
let pageUrl = baseUrl;
let pagesDone = 0;
let knownHits = 0;
let reachedNewestExisting = false;

while (pageUrl && !seenPages.has(pageUrl) && (maxPages <= 0 || pagesDone < maxPages)) {
  seenPages.add(pageUrl);
  const html = await fetchText(pageUrl);
  pagesDone += 1;

  for (const entryUrl of parseEntryUrls(html, pageUrl)) {
    const id = entryIdFromUrl(entryUrl);
    if (!id) continue;
    if (knownIds.has(id)) {
      knownHits += 1;
      if (id === newestExistingId) reachedNewestExisting = true;
      if (newHeadItems.length > 0 && reachedNewestExisting) {
        pageUrl = "";
        break;
      }
      continue;
    }

    const item = await parseVideoPage(entryUrl);
    if (!reachedNewestExisting) {
      newHeadItems.push(item);
    } else {
      oldTailItems.push(item);
    }
    knownIds.add(item.id);
    const mode = reachedNewestExisting ? "old" : "new";
    console.log(`[${mode}] ${item.id} ${item.date} ${item.title.slice(0, 42)}`);
    if (!reachedNewestExisting && maxNewItems > 0 && newHeadItems.length >= maxNewItems) {
      pageUrl = "";
      break;
    }
    if (reachedNewestExisting && maxOldItems > 0 && oldTailItems.length >= maxOldItems) {
      pageUrl = "";
      break;
    }
    await sleep(delayMs);
  }

  if (!pageUrl) break;
  pageUrl = parseNextUrl(html, pageUrl);
  await sleep(delayMs);
}

if (newHeadItems.length || oldTailItems.length) {
  const merged = mergeVideos(newHeadItems, mockVideos, oldTailItems);
  await writeVideos(merged);
}

console.log(
  `pages=${pagesDone} new_head=${newHeadItems.length} old_tail=${oldTailItems.length} known_hits=${knownHits} total=${newHeadItems.length + mockVideos.length + oldTailItems.length}`
);

function mergeVideos(head, current, tail) {
  const seen = new Set();
  return [...head, ...current, ...tail].filter((video) => {
    if (!video?.id || seen.has(video.id)) return false;
    seen.add(video.id);
    return true;
  });
}

async function writeVideos(items) {
  const source = `export const mockVideos = ${JSON.stringify(items, null, 2)};\n`;
  await writeFile(output, source, "utf-8");
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

  return {
    id: entryIdFromUrl(url),
    slug: entryIdFromUrl(url),
    title,
    source_url: normalizeEntryUrl(url),
    embed_url: embedUrl,
    cover_source: cover,
    cover,
    date,
    category: ["影音", "中文有碼"],
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
    if (href.includes("entry=") && (text.includes("下一頁") || text.includes("next"))) {
      return normalizeUrl(decodeHtml(href), pageUrl);
    }
  }
  return "";
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
  const tags = ["影音", "中文有碼"];
  const keywords = ["人妻", "熟女", "巨乳", "美乳", "素人", "女教師", "護士", "制服", "學生", "偶像", "NTR"];
  for (const keyword of keywords) {
    if (title.includes(keyword)) tags.push(keyword);
  }
  return dedupe(tags);
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
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
