const CATEGORY_BOOSTS = new Map([
  ["熱門", 20],
  ["推薦", 15],
  ["新片", 12],
  ["精選", 10]
]);

export function getTotalViews(video) {
  const value = video?.viewCount ?? video?.views ?? video?.playCount ?? video?.totalViews ?? 0;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function getVideoTimestamp(video) {
  const value = video?.createdAt || video?.publishedAt || video?.updatedAt || video?.date || "";
  const timestamp = Date.parse(String(value).replaceAll("-", "/"));
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function getFreshnessBoost(video, now = new Date()) {
  const timestamp = getVideoTimestamp(video);
  if (!timestamp) return 0;

  const ageHours = (now.getTime() - timestamp) / 36e5;
  if (ageHours < 0) return 30;
  if (ageHours <= 24) return 30;
  if (ageHours <= 72) return 20;
  if (ageHours <= 168) return 10;
  return 0;
}

export function getCategoryBoost(video) {
  const values = [...(video?.category || []), ...(video?.tags || [])];
  return values.reduce((score, value) => Math.max(score, CATEGORY_BOOSTS.get(String(value)) || 0), 0);
}

export function getDailyJitter(video, domain = "", date = new Date()) {
  const day = toDateKey(date);
  const seed = `${domain}|${video?.id || video?.slug || video?.title || ""}|${day}`;
  return hashString(seed) % 9;
}

export function getHotScore(video, options = {}) {
  const now = options.now || new Date();
  const domain = options.domain || "";
  const totalViews = getTotalViews(video);
  const freshnessBoost = getFreshnessBoost(video, now);
  const categoryBoost = getCategoryBoost(video);
  const dailyJitter = getDailyJitter(video, domain, now);

  return Math.log10(totalViews + 1) * 40 + freshnessBoost + categoryBoost + dailyJitter;
}

export function rankVideos(videos, mode = "daily", options = {}) {
  const scored = (Array.isArray(videos) ? videos : []).map((video) => ({
    video,
    totalViews: getTotalViews(video),
    timestamp: getVideoTimestamp(video),
    categoryBoost: getCategoryBoost(video),
    dailyJitter: getDailyJitter(video, options.domain || "", options.now || new Date()),
    hotScore: getHotScore(video, options)
  }));

  const sorted = scored.sort((a, b) => compareRankedVideos(a, b, mode));
  return sorted.map((item) => item.video);
}

function compareRankedVideos(a, b, mode) {
  if (mode === "latestHot") {
    return b.timestamp - a.timestamp || b.hotScore - a.hotScore || fallbackCompare(a, b);
  }

  if (mode === "mostViewed") {
    return b.totalViews - a.totalViews || b.hotScore - a.hotScore || fallbackCompare(a, b);
  }

  if (mode === "featured") {
    const scoreA = a.categoryBoost + a.dailyJitter;
    const scoreB = b.categoryBoost + b.dailyJitter;
    return scoreB - scoreA || b.hotScore - a.hotScore || fallbackCompare(a, b);
  }

  return b.hotScore - a.hotScore || fallbackCompare(a, b);
}

function fallbackCompare(a, b) {
  return b.timestamp - a.timestamp || String(a.video?.id || "").localeCompare(String(b.video?.id || ""));
}

function toDateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
