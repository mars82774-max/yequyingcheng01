export const MEDIA_WORKER_BASE_URL = "https://media-playback-canary.media-canary-ba50f59c.workers.dev";

const MEDIA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isMediaWorkerVideo(video = {}) {
  const sourceType = video.source_type || video.sourceType || video.type;
  return sourceType === "media-worker" && MEDIA_ID_PATTERN.test(String(video.media_video_id || video.video_id || video.id || ""));
}

export function mediaVideoId(video = {}) {
  return String(video.media_video_id || video.video_id || video.id || "").trim();
}

export function mediaWorkerUrl(path, baseUrl = MEDIA_WORKER_BASE_URL) {
  return new URL(path, baseUrl).toString();
}

export function mediaMetadataUrl(videoId, baseUrl = MEDIA_WORKER_BASE_URL) {
  return mediaWorkerUrl(`/media/${encodeURIComponent(videoId)}/metadata`, baseUrl);
}

export function mediaCoverUrl(videoId, baseUrl = MEDIA_WORKER_BASE_URL) {
  return mediaWorkerUrl(`/media/${encodeURIComponent(videoId)}/cover`, baseUrl);
}

export function mediaManifestUrl(videoOrId, baseUrl = MEDIA_WORKER_BASE_URL) {
  const videoId = typeof videoOrId === "string" ? videoOrId : mediaVideoId(videoOrId);
  return mediaWorkerUrl(`/media/${encodeURIComponent(videoId)}/master.m3u8`, baseUrl);
}

export async function getMetadata(videoId, options = {}) {
  if (!MEDIA_ID_PATTERN.test(String(videoId || ""))) throw new Error("invalid_video_id");
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 8000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(mediaMetadataUrl(videoId, options.baseUrl), {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`metadata_${response.status}`);
    return normalizeMediaMetadata(await response.json(), options.baseUrl);
  } finally {
    clearTimeout(timeout);
  }
}

export const fetchMediaMetadata = getMetadata;
export const getCoverUrl = mediaCoverUrl;
export const getManifestUrl = mediaManifestUrl;

export function normalizeMediaMetadata(payload, baseUrl = MEDIA_WORKER_BASE_URL) {
  const videoId = String(payload?.video_id || "").trim();
  const title = String(payload?.title || "").replace(/\s+/g, " ").trim();
  const cover = String(payload?.cover || "").trim();
  const status = String(payload?.status || "").trim();
  if (!MEDIA_ID_PATTERN.test(videoId) || !title || status !== "READY") throw new Error("invalid_metadata");
  return {
    video_id: videoId,
    title,
    cover: cover ? mediaWorkerUrl(cover, baseUrl) : mediaCoverUrl(videoId, baseUrl),
    status
  };
}

export function applyMediaMetadata(video, metadata) {
  if (!metadata) return { ...video, mediaStatus: "unavailable" };
  return {
    ...video,
    id: metadata.video_id,
    slug: metadata.video_id,
    title: metadata.title,
    thumbnail: metadata.cover,
    cover: metadata.cover,
    cover_source: metadata.cover,
    mediaStatus: metadata.status,
    mediaManifest: mediaManifestUrl(metadata.video_id)
  };
}
