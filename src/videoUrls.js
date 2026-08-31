const fallbackCover = "/assets/brands/yequyingcheng/og-image.png";

export function playableEmbedUrl(url, video = {}) {
  const validation = validatePlayerUrl(url, video);
  if (!validation.valid) return "";

  if (isABigSwPlayerUrl(validation.url)) {
    const routed = new URL(validation.url.toString());
    routed.protocol = "https:";
    routed.hostname = "j-av.com";
    routed.port = "";
    return routed.toString();
  }

  return validation.url.toString();
}

export function validatePlayerUrl(url, video = {}) {
  const parsed = parseAbsoluteUrl(url);
  if (!parsed) return unavailable("empty_or_invalid");

  const sourceUrl = parseAbsoluteUrl(video.sourceUrl || video.source_url || "");
  const detailUrl = parseAbsoluteUrl(video.detailUrl || video.detail_url || "");
  if (sameUrl(parsed, sourceUrl) || sameUrl(parsed, detailUrl)) return unavailable("matches_source_or_detail");
  if (isJavArticleUrl(parsed)) return unavailable("jav_article_url");
  if (!isSupportedPlayerUrl(parsed)) return unavailable("unsupported_player_url");
  if (isFlPlayerUrl(parsed)) return unavailable("fl_hidden");

  return { valid: true, unavailable: false, reason: "", url: parsed };
}

export function isPublicVideo(video = {}) {
  return !isFlPlayerUrl(video.embed_url || video.playUrl || "");
}

export function isSupportedPlayerUrl(url) {
  const parsed = url instanceof URL ? url : parseAbsoluteUrl(url);
  if (!parsed) return false;
  return isABigPlayerUrl(parsed) || isJavPlayerPath(parsed);
}

export function isValidCoverUrl(url) {
  const parsed = parseAbsoluteUrl(url);
  if (!parsed) return false;
  if (!["http:", "https:"].includes(parsed.protocol)) return false;
  if (isJavArticleUrl(parsed) || isSupportedPlayerUrl(parsed)) return false;
  return /\.(avif|gif|jpe?g|png|webp)(?:$|[?#])/i.test(parsed.toString());
}

export function displayCoverUrl(video = {}) {
  const cover = video.cover || video.coverUrl || video.thumbnail || video.image || video.cover_source || "";
  return isValidCoverUrl(cover) ? cover : fallbackCover;
}

export function isJavArticleUrl(url) {
  const parsed = url instanceof URL ? url : parseAbsoluteUrl(url);
  if (!parsed) return false;
  return /(^|\.)j-av\.com$/i.test(parsed.hostname)
    && parsed.pathname.replace(/\/+/g, "/").endsWith("/video/index.php")
    && parsed.searchParams.has("entry");
}

export function normalizeCandidateUrl(value, baseUrl) {
  const decoded = decodeUrlValue(value);
  if (!decoded) return "";
  try {
    if (decoded.startsWith("//")) return `https:${decoded}`;
    return new URL(decoded, baseUrl).toString();
  } catch {
    return "";
  }
}

export function normalizePlayerUrl(value, baseUrl) {
  const normalized = normalizeCandidateUrl(value, baseUrl);
  const parsed = parseAbsoluteUrl(normalized);
  if (!parsed || !isSupportedPlayerUrl(parsed)) return "";

  if (isJavPlayerPath(parsed)) {
    parsed.protocol = "https:";
    parsed.hostname = "a-big.com";
    parsed.port = "";
    return parsed.toString();
  }

  return parsed.toString();
}

export function imageFromPlayerUrl(url) {
  const parsed = parseAbsoluteUrl(url);
  if (!parsed) return "";
  return parsed.searchParams.get("image") || "";
}

function isABigPlayerUrl(url) {
  return /(^|\.)a-big\.com$/i.test(url.hostname)
    && /\/player\/twvid\/(?:sw|fl)\.php$/i.test(url.pathname)
    && Boolean(url.searchParams.get("id"));
}

function isABigSwPlayerUrl(url) {
  return /(^|\.)a-big\.com$/i.test(url.hostname)
    && /\/player\/twvid\/sw\.php$/i.test(url.pathname)
    && Boolean(url.searchParams.get("id"));
}

function isFlPlayerUrl(url) {
  const parsed = url instanceof URL ? url : parseAbsoluteUrl(url);
  if (!parsed) return false;
  return (/(^|\.)a-big\.com$/i.test(parsed.hostname) || /(^|\.)j-av\.com$/i.test(parsed.hostname))
    && /\/player\/twvid\/fl\.php$/i.test(parsed.pathname)
    && Boolean(parsed.searchParams.get("id"));
}

function isJavPlayerPath(url) {
  return /(^|\.)j-av\.com$/i.test(url.hostname)
    && /\/player\/twvid\/(?:sw|fl)\.php$/i.test(url.pathname)
    && Boolean(url.searchParams.get("id"));
}

function parseAbsoluteUrl(url) {
  const value = String(url || "").trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function sameUrl(a, b) {
  return Boolean(a && b) && a.toString() === b.toString();
}

function unavailable(reason) {
  return { valid: false, unavailable: true, reason, url: null };
}

function decodeUrlValue(value = "") {
  let result = String(value || "").trim();
  if (!result) return "";
  result = result
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u002f/gi, "/")
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  try {
    result = decodeURIComponent(result);
  } catch {}
  return result.trim();
}
