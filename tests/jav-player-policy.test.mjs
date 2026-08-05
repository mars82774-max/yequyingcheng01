import test from "node:test";
import assert from "node:assert/strict";
import { mockVideos } from "../src/mockVideos.js";
import {
  displayCoverUrl,
  isJavArticleUrl,
  isValidCoverUrl,
  playableEmbedUrl,
  validatePlayerUrl
} from "../src/videoUrls.js";
import { parseJavVideoHtml } from "../scripts/video-sources/j-av.mjs";

const detailUrl = "https://j-av.com/video/index.php?entry=entry260717-071601";
const validPlayer = "https://a-big.com/player/twvid/sw.php?id=hzispx063q8i&image=https://pics.dmm.co.jp/mono/movie/adult/aldn590/aldn590pl.jpg";
const sampleHtml = `
  <html>
    <title>沉溺於內射快樂的老婆 三池小春 - J-AV</title>
    <div class="blog_subject"><a href="${detailUrl}"><b>沉溺於內射快樂的老婆 三池小春</b></a></div>
    <div class="blog_date">2026-7-17</div>
    <iframe data-lazy-src="../player/twvid/sw.php?id=hzispx063q8i&amp;image=https:\\/\\/pics.dmm.co.jp\\/mono\\/movie\\/adult\\/aldn590\\/aldn590pl.jpg"></iframe>
  </html>
`;

test("player URL does not fallback to detailUrl", () => {
  const result = validatePlayerUrl(detailUrl, { sourceUrl: detailUrl, detailUrl });

  assert.equal(result.valid, false);
  assert.equal(playableEmbedUrl(detailUrl, { sourceUrl: detailUrl, detailUrl }), "");
});

test("player URL cannot be a J-AV article page", () => {
  assert.equal(isJavArticleUrl(detailUrl), true);
  assert.equal(validatePlayerUrl(detailUrl, {}).reason, "jav_article_url");
});

test("missing player does not produce an iframe URL", () => {
  assert.equal(playableEmbedUrl("", { sourceUrl: detailUrl }), "");
});

test("missing cover does not affect player parsing", () => {
  const parsed = parseJavVideoHtml(sampleHtml.replace(/&amp;image=[^"']+/, ""), detailUrl, {
    defaultCategory: ["影音", "中文有碼"],
    defaultTags: ["影音", "中文有碼"],
    sourceName: "j-av"
  });

  assert.equal(parsed.cover, "");
  assert.equal(validatePlayerUrl(parsed.embed_url, parsed).valid, true);
});

test("normal video still has valid cover and player", () => {
  const normal = mockVideos.find((video) => video.id === "entry260712-145055");

  assert.ok(normal);
  assert.equal(isValidCoverUrl(normal.cover), true);
  assert.equal(validatePlayerUrl(normal.embed_url, normal).valid, true);
  assert.match(playableEmbedUrl(normal.embed_url, normal), /^https:\/\/mmsi01\.com\/e\//);
});

test("J-AV parser extracts current relative iframe and cover independently", () => {
  const parsed = parseJavVideoHtml(sampleHtml, detailUrl, {
    defaultCategory: ["影音", "中文有碼"],
    defaultTags: ["影音", "中文有碼"],
    sourceName: "j-av"
  });

  assert.equal(parsed.id, "entry260717-071601");
  assert.equal(parsed.title, "沉溺於內射快樂的老婆 三池小春");
  assert.equal(parsed.embed_url, validPlayer);
  assert.equal(parsed.cover, "https://pics.dmm.co.jp/mono/movie/adult/aldn590/aldn590pl.jpg");
});

test("repaired sample video has homepage cover and detail player", () => {
  const sample = mockVideos.find((video) => video.id === "entry260717-071601");

  assert.ok(sample);
  assert.equal(isValidCoverUrl(displayCoverUrl(sample)), true);
  assert.equal(validatePlayerUrl(sample.embed_url, sample).valid, true);
  assert.notEqual(sample.embed_url, sample.source_url);
});
