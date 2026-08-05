import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { mockVideos } from "../src/mockVideos.js";
import { isJavArticleUrl, isValidCoverUrl, validatePlayerUrl } from "../src/videoUrls.js";
import { parseJavVideoHtml } from "./video-sources/j-av.mjs";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "src", "mockVideos.js");
const dryRun = ["1", "true", "yes"].includes(String(process.env.REPAIR_DRY_RUN || "").toLowerCase());
const limit = Number(process.env.REPAIR_LIMIT || 0);
const delayMs = Number(process.env.REPAIR_DELAY_MS || 250);

const before = scanAbnormal(mockVideos);
const targets = limit > 0 ? before.items.slice(0, limit) : before.items;
const byId = new Map(mockVideos.map((video) => [video.id, video]));
const repaired = [];
const unresolved = [];

console.log(`[repair:j-av] dryRun=${dryRun}`);
console.log(`[repair:j-av] total=${mockVideos.length}`);
console.log(`[repair:j-av] abnormalBefore=${before.count}`);
console.log(`[repair:j-av] targets=${targets.length}`);

for (const target of targets) {
  const sourceUrl = target.sourceUrl || target.source_url || "";
  if (!sourceUrl) {
    unresolved.push({ id: target.id, title: target.title, reason: "missing_source_url" });
    continue;
  }

  try {
    const html = await fetchWithCurl(sourceUrl);
    const parsed = parseJavVideoHtml(html, sourceUrl, {
      defaultCategory: target.category || [],
      defaultTags: target.tags || [],
      sourceName: target.sourceName || target.provider || "j-av"
    });
    const updated = mergeRepair(target, parsed);
    byId.set(target.id, updated);
    repaired.push({
      id: target.id,
      title: target.title,
      cover: updated.cover,
      embed_url: updated.embed_url
    });
    console.log(`[repair:j-av] fixed id=${target.id} title=${target.title}`);
  } catch (error) {
    unresolved.push({ id: target.id, title: target.title, reason: error?.message || String(error) });
    console.log(`[repair:j-av] unresolved id=${target.id} reason=${error?.message || error}`);
  }

  await sleep(delayMs);
}

const merged = mockVideos.map((video) => byId.get(video.id) || video);
const after = scanAbnormal(merged);

console.log(`[repair:j-av] repaired=${repaired.length}`);
console.log(`[repair:j-av] unresolved=${unresolved.length}`);
console.log(`[repair:j-av] abnormalAfter=${after.count}`);
console.log("[repair:j-av] repairedItems=" + JSON.stringify(repaired, null, 2));
console.log("[repair:j-av] unresolvedItems=" + JSON.stringify(unresolved, null, 2));

if (!dryRun) {
  await writeFile(output, `export const mockVideos = ${JSON.stringify(merged, null, 2)};\n`, "utf8");
  console.log(`[repair:j-av] wrote=${output}`);
}

function mergeRepair(original, parsed) {
  const sourceUrl = original.sourceUrl || original.source_url || parsed.sourceUrl || parsed.source_url || "";
  const playerCandidate = parsed.playUrl || parsed.embed_url || "";
  const coverCandidate = parsed.thumbnail || parsed.cover || parsed.cover_source || "";
  const playerValid = validatePlayerUrl(playerCandidate, { ...original, sourceUrl, source_url: sourceUrl }).valid;
  const coverValid = isValidCoverUrl(coverCandidate);
  const currentPlayerValid = validatePlayerUrl(original.playUrl || original.embed_url || "", original).valid;
  const currentCoverValid = isValidCoverUrl(original.thumbnail || original.cover || original.cover_source || "");
  const nextPlayer = currentPlayerValid ? (original.playUrl || original.embed_url || "") : (playerValid ? playerCandidate : "");
  const nextCover = currentCoverValid ? (original.thumbnail || original.cover || original.cover_source || "") : (coverValid ? coverCandidate : "");

  return {
    ...original,
    sourceUrl,
    source_url: sourceUrl,
    playUrl: nextPlayer,
    embed_url: nextPlayer,
    thumbnail: nextCover,
    cover_source: nextCover,
    cover: nextCover,
    slug: original.slug || original.id,
    title: original.title || parsed.title,
    publishedAt: original.publishedAt || original.date || parsed.publishedAt || parsed.date || "",
    date: original.date || original.publishedAt || parsed.date || parsed.publishedAt || "",
    category: Array.isArray(original.category) ? original.category : parsed.category || [],
    tags: Array.isArray(original.tags) && original.tags.length ? original.tags : parsed.tags || [],
    type: original.type || "iframe",
    provider: original.provider || original.sourceName || "j-av"
  };
}

function scanAbnormal(videos) {
  const items = videos.filter((video) => isAbnormalVideo(video));
  return { count: items.length, items };
}

function isAbnormalVideo(video) {
  const cover = video.cover || video.coverUrl || video.thumbnail || video.image || video.cover_source || "";
  const player = video.playUrl || video.playerUrl || video.embedUrl || video.iframeUrl || video.videoUrl || video.embed_url || "";
  return !isValidCoverUrl(cover)
    || !validatePlayerUrl(player, video).valid
    || isJavArticleUrl(player);
}

async function fetchWithCurl(url) {
  const { stdout } = await execFileAsync("curl.exe", [
    "--silent",
    "--show-error",
    "--location",
    "--max-time",
    "30",
    "--user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    "--header",
    "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "--header",
    "Accept-Language: zh-TW,zh;q=0.9,en;q=0.8",
    url
  ], {
    maxBuffer: 1024 * 1024 * 4,
    timeout: 35000
  });
  return stdout;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
