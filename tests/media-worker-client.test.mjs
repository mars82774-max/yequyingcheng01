import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMediaMetadata,
  getCoverUrl,
  getManifestUrl,
  isMediaWorkerVideo,
  mediaVideoId,
  normalizeMediaMetadata,
  normalizePublicCatalog
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

test("public media catalog exposes only safe card fields", () => {
  const records = normalizePublicCatalog([
    {
      video_id: "DEMO-LIST-001",
      title: "Demo Listing",
      cover: "/media/DEMO-LIST-001/cover",
      source_type: "media-worker"
    }
  ]);

  assert.equal(records.length, 1);
  assert.deepEqual(Object.keys(records[0]).sort(), [
    "catalogDriven",
    "category",
    "cover",
    "cover_source",
    "date",
    "id",
    "mediaManifest",
    "mediaStatus",
    "slug",
    "source_type",
    "tags",
    "thumbnail",
    "title",
    "type",
    "video_id"
  ].sort());
  assert.equal(records[0].id, "DEMO-LIST-001");
  assert.equal(records[0].title, "Demo Listing");
  assert.equal(records[0].cover, "https://media-playback-canary.media-canary-ba50f59c.workers.dev/media/DEMO-LIST-001/cover");
  assert.equal(records[0].mediaManifest, "https://media-playback-canary.media-canary-ba50f59c.workers.dev/media/DEMO-LIST-001/master.m3u8");
  assert.equal("r2_prefix" in records[0], false);
  assert.equal("manifest_object" in records[0], false);
  assert.equal("key_secret_name" in records[0], false);
});

test("public media catalog rejects unsafe or incomplete records", () => {
  assert.throws(() => normalizePublicCatalog([{ video_id: "DEMO-LIST-001", title: "", cover: "", source_type: "media-worker" }]), /invalid_catalog_record/);
  assert.throws(() => normalizePublicCatalog([{ video_id: "DEMO-LIST-001", title: "Demo", cover: "", source_type: "legacy" }]), /invalid_catalog_record/);
});
