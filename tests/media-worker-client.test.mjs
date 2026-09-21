import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMediaMetadata,
  getCoverUrl,
  getManifestUrl,
  isMediaWorkerVideo,
  mediaVideoId,
  normalizeMediaMetadata
} from "../src/mediaWorkerClient.js";

test("media-worker records use generic source_type and video_id", () => {
  const record = { source_type: "media-worker", video_id: "MEDIA-123" };

  assert.equal(isMediaWorkerVideo(record), true);
  assert.equal(mediaVideoId(record), "MEDIA-123");
  assert.equal(getCoverUrl("MEDIA-123"), "https://media-playback-canary.media-canary-ba50f59c.workers.dev/media/MEDIA-123/cover");
  assert.equal(getManifestUrl("MEDIA-123"), "https://media-playback-canary.media-canary-ba50f59c.workers.dev/media/MEDIA-123/master.m3u8");
});

test("media-worker metadata supplies title and cover without internal storage fields", () => {
  const metadata = normalizeMediaMetadata({
    video_id: "MEDIA-123",
    title: "Catalog Supplied Title",
    cover: "/media/MEDIA-123/cover",
    status: "READY"
  });
  const resolved = applyMediaMetadata({ source_type: "media-worker", video_id: "MEDIA-123" }, metadata);

  assert.equal(resolved.title, "Catalog Supplied Title");
  assert.equal(resolved.cover, "https://media-playback-canary.media-canary-ba50f59c.workers.dev/media/MEDIA-123/cover");
  assert.equal(resolved.mediaManifest, "https://media-playback-canary.media-canary-ba50f59c.workers.dev/media/MEDIA-123/master.m3u8");
  assert.equal("r2_prefix" in resolved, false);
  assert.equal("key_secret_name" in resolved, false);
});

test("media-worker metadata failure does not fallback to video_id title", () => {
  assert.throws(() => normalizeMediaMetadata({ video_id: "MEDIA-123", title: "", cover: "", status: "READY" }), /invalid_metadata/);
});
