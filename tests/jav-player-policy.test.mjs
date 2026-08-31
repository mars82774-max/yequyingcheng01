import test from "node:test";
import assert from "node:assert/strict";
import { mockVideos } from "../src/mockVideos.js";
import {
  displayCoverUrl,
  isPublicVideo,
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

test("a-big sw.php routes through J-AV SW with query parameters intact", () => {
  const result = playableEmbedUrl(validPlayer, {});
  const parsed = new URL(result);

  assert.equal(parsed.origin + parsed.pathname, "https://j-av.com/player/twvid/sw.php");
  assert.equal(parsed.searchParams.get("id"), "hzispx063q8i");
  assert.equal(parsed.searchParams.get("image"), "https://pics.dmm.co.jp/mono/movie/adult/aldn590/aldn590pl.jpg");
  assert.equal(result.includes("mmsi01.com"), false);
  assert.equal(result.includes("mmsi02.com"), false);
});

test("a-big sw.php preserves additional safe query parameters", () => {
  const player = `${validPlayer}&quality=auto&caption=zh-TW`;
  const result = playableEmbedUrl(player, {});
  const parsed = new URL(result);

  assert.equal(parsed.hostname, "j-av.com");
  assert.equal(parsed.searchParams.get("id"), "hzispx063q8i");
  assert.equal(parsed.searchParams.get("image"), "https://pics.dmm.co.jp/mono/movie/adult/aldn590/aldn590pl.jpg");
  assert.equal(parsed.searchParams.get("quality"), "auto");
  assert.equal(parsed.searchParams.get("caption"), "zh-TW");
});

test("fl.php records are hidden from public playback", () => {
  const player = "https://a-big.com/player/twvid/fl.php?id=v4u3thbfgnay&image=https://pics.dmm.co.jp/mono/movie/adult/atid691/atid691pl.jpg";
  const validation = validatePlayerUrl(player, {});

  assert.equal(validation.valid, false);
  assert.equal(validation.reason, "fl_hidden");
  assert.equal(playableEmbedUrl(player, {}), "");
  assert.equal(isPublicVideo({ embed_url: player }), false);
});

test("current J-AV fl.php records are also hidden", () => {
  const player = "https://j-av.com/player/twvid/fl.php?id=v4u3thbfgnay&image=https://pics.dmm.co.jp/mono/movie/adult/atid691/atid691pl.jpg";

  assert.equal(validatePlayerUrl(player, {}).reason, "fl_hidden");
  assert.equal(playableEmbedUrl(player, {}), "");
  assert.equal(isPublicVideo({ embed_url: player }), false);
});

test("current J-AV sw.php URLs remain unchanged", () => {
  const player = "https://j-av.com/player/twvid/sw.php?id=abblfwmdc98g&image=https://pics.dmm.co.jp/mono/movie/adult/h_139doks668/h_139doks668pl.jpg";
  const result = playableEmbedUrl(player, {});

  assert.equal(result, player);
});

test("catalog public counts exclude all FL records", () => {
  const counts = mockVideos.reduce((acc, video) => {
    const path = new URL(video.embed_url).pathname.toLowerCase();
    acc.total += 1;
    if (path.endsWith("/sw.php")) acc.sw += 1;
    if (path.endsWith("/fl.php")) acc.fl += 1;
    if (isPublicVideo(video)) acc.public += 1;
    return acc;
  }, { total: 0, sw: 0, fl: 0, public: 0 });

  assert.deepEqual(counts, { total: 2583, sw: 2207, fl: 376, public: 2207 });
  assert.equal(isPublicVideo(mockVideos.find((video) => video.id === "entry260805-122000")), false);
  assert.equal(isPublicVideo(mockVideos.find((video) => video.id === "entry260803-124354")), true);
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
  assert.match(playableEmbedUrl(normal.embed_url, normal), /^https:\/\/j-av\.com\/player\/twvid\/sw\.php\?/);
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
