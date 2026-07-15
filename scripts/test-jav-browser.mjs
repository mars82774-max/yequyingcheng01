import { createBrowserFetcher } from "./video-sources/browser-fetch.mjs";

const baseUrl = "https://j-av.com/video/index.php";
const targetUrl = process.env.TEST_JAV_URL || baseUrl;
const fetcher = await createBrowserFetcher(process.env);

try {
  const list = await fetcher.fetchText(targetUrl);
  const entryUrls = parseEntryUrls(list.html, list.finalUrl || targetUrl);
  console.log(`[test] listStatus=${list.status}`);
  console.log(`[test] listTitle=${list.title || ""}`);
  console.log(`[test] listFinalUrl=${list.finalUrl || ""}`);
  console.log(`[test] listFound=${entryUrls.length}`);

  if (!entryUrls.length) {
    throw new Error("No entry links found on source page");
  }

  const videoUrl = entryUrls[0];
  const video = await fetcher.fetchText(videoUrl);
  const parsed = parseVideoPage(video.html, video.finalUrl || videoUrl);
  console.log(`[test] videoStatus=${video.status}`);
  console.log(`[test] videoTitle=${video.title || ""}`);
  console.log(`[test] videoFinalUrl=${video.finalUrl || ""}`);
  console.log(`[test] parsedId=${parsed.id}`);
  console.log(`[test] parsedTitle=${parsed.title}`);
  console.log(`[test] parsedEmbed=${parsed.embedUrl ? "yes" : "no"}`);
} finally {
  await fetcher.close();
}

function parseEntryUrls(html, pageUrl) {
  const urls = [...html.matchAll(/<a[^>]+href=["']([^"']*entry=[^"']+)["'][^>]*>/gi)]
    .map((match) => normalizeEntryUrl(normalizeUrl(decodeHtml(match[1]), pageUrl)));
  return [...new Set(urls)].filter((url) => entryIdFromUrl(url));
}

function parseVideoPage(html, url) {
  const embedUrl = normalizeUrl(findFirst(html, /<iframe[^>]+src=["']([^"']+)["']/gi, (value) => value.includes("a-big.com/player")), url);
  const title = cleanText(
    findFirst(html, /<div[^>]+class=["'][^"']*blog_subject[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
      || findFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i)?.split(" - J-AV")[0]
      || entryIdFromUrl(url)
  );
  const id = entryIdFromUrl(url);
  if (!id || !title || !embedUrl) {
    throw new Error(`Video parse failed: id=${id || ""} title=${title || ""} embed=${embedUrl || ""} url=${url}`);
  }
  return { id, title, embedUrl };
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
