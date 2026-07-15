import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mockVideos } from "../src/mockVideos.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const siteUrl = "https://yequyingcheng01.pages.dev";
const recommendationLimit = 8;
const maxRelatedCandidates = 240;
const writeConcurrency = Number(process.env.BUILD_WRITE_CONCURRENCY || 40);
const buildStartedAt = Date.now();
const baiduAnalytics = `<script>
      var _hmt = _hmt || [];
      (function() {
        var hm = document.createElement("script");
        hm.src = "https://hm.baidu.com/hm.js?5b6cebb258a2c2e6a3ef4e7ac9988fa6";
        var s = document.getElementsByTagName("script")[0];
        s.parentNode.insertBefore(hm, s);
      })();
    </script>`;

console.log("[build] start");
console.log(`[build] total videos: ${mockVideos.length}`);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const entry of ["src", "assets", "admin"]) {
  await cp(join(root, entry), join(dist, entry), { recursive: true });
}

console.log("[build] preparing indexes");
const buildIndex = prepareVideoIndex(mockVideos);
console.log("[build] indexes ready");

const sourceIndex = await readFile(join(root, "index.html"), "utf-8");
const seoLinks = mockVideos
  .map((video) => `<a href="/video/${encodeURIComponent(video.id)}/">${escapeHtml(video.title)}</a>`)
  .join("\n      ");
await writeFile(join(dist, "index.html"), sourceIndex.replace("<!-- SEO_LINKS -->", seoLinks), "utf-8");

await writeVideoPages();

console.log("[build] generating tag pages");
let tagPageCount = 0;
for (const [tag, videos] of buildIndex.videosByTag) {
  await writeHtml(`tag/${tag}/index.html`, renderListingPage(`標籤：${tag}`, videos, `/tag/${encodeURIComponent(tag)}/`));
  tagPageCount += 1;
}

console.log("[build] generating category pages");
let categoryPageCount = 0;
for (const [category, videos] of buildIndex.videosByCategory) {
  await writeHtml(`category/${category}/index.html`, renderListingPage(`分類：${category}`, videos, `/category/${encodeURIComponent(category)}/`));
  categoryPageCount += 1;
}

console.log("[build] writing sitemap");
await writeFile(join(dist, "robots.txt"), renderRobots(), "utf-8");
await writeFile(join(dist, "sitemap.xml"), renderSitemap(), "utf-8");

console.log(`[build] video pages: ${mockVideos.length}`);
console.log(`[build] tag pages: ${tagPageCount}`);
console.log(`[build] category pages: ${categoryPageCount}`);
console.log(`[build] completed in ${((Date.now() - buildStartedAt) / 1000).toFixed(1)} seconds`);
console.log("Built static site to dist");

async function writeVideoPages() {
  let nextProgress = 100;
  for (let index = 0; index < mockVideos.length; index += writeConcurrency) {
    const batch = mockVideos.slice(index, index + writeConcurrency);
    await Promise.all(batch.map((video) => writeHtml(`video/${video.id}/index.html`, renderVideoPage(video))));
    const done = Math.min(index + batch.length, mockVideos.length);
    while (done >= nextProgress) {
      console.log(`[build] generating video pages: ${nextProgress}/${mockVideos.length}`);
      nextProgress += 100;
    }
  }
  if (mockVideos.length === 0 || (nextProgress - 100) !== mockVideos.length) {
    console.log(`[build] generating video pages: ${mockVideos.length}/${mockVideos.length}`);
  }
}

async function writeHtml(relativePath, html) {
  const target = join(dist, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, html, "utf-8");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isCatalogCode(value) {
  return /^[A-Z]{2,6}(?:-\d{2,5})?$/.test(String(value).trim());
}

function publicTags(video) {
  return unique((video.tags || []).filter((tag) => tag && !isCatalogCode(tag)).map(normalizeText));
}

function publicCategories(video) {
  return unique((video.category || []).map(normalizeText));
}

function displayTags(video) {
  const categories = new Set(publicCategories(video).map((value) => value.toLowerCase()));
  return publicTags(video).filter((tag) => !categories.has(tag.toLowerCase()));
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function catalogCode(video) {
  const candidates = [
    video?.catalogCode,
    video?.code,
    video?.productCode,
    video?.title,
    ...(video?.tags || []),
    video?.cover,
    video?.cover_source,
    video?.source_url
  ];
  for (const value of candidates) {
    const match = String(value || "").toUpperCase().match(/\b[A-Z]{2,8}[-_ ]?\d{2,6}\b/);
    if (match) return match[0].replace(/[ _]/g, "-");
  }
  return "";
}

function catalogPrefixFromCode(code) {
  return String(code || "").split("-")[0] || "";
}

function videoDateValue(video) {
  const raw = video?.date || video?.publishedAt || video?.createdAt || video?.updatedAt || "";
  const time = Date.parse(String(raw).replaceAll("-", "/"));
  return Number.isNaN(time) ? 0 : time;
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isAdVideo(video) {
  return Boolean(video?.isAd || video?.ad || video?.slotKey || video?.adSlot || video?.type === "ad");
}

function prepareVideoIndex(videos) {
  const metaById = new Map();
  const videosByCategory = new Map();
  const videosByTag = new Map();
  const videosByCatalogPrefix = new Map();
  const indexableVideos = videos.filter((video) => video?.id && !isAdVideo(video));

  for (const video of indexableVideos) {
    const code = catalogCode(video);
    const meta = {
      categories: publicCategories(video),
      tags: displayTags(video),
      code,
      prefix: catalogPrefixFromCode(code),
      dateValue: videoDateValue(video)
    };
    metaById.set(video.id, meta);
    for (const category of meta.categories) addToMapList(videosByCategory, category, video);
    for (const tag of meta.tags) addToMapList(videosByTag, tag, video);
    if (meta.prefix) addToMapList(videosByCatalogPrefix, meta.prefix, video);
  }

  const latestVideos = sortNewest(indexableVideos, metaById);
  sortMapListsByNewest(videosByCategory, metaById);
  sortMapListsByNewest(videosByTag, metaById);
  sortMapListsByNewest(videosByCatalogPrefix, metaById);

  return {
    metaById,
    videosByCategory,
    videosByTag,
    videosByCatalogPrefix,
    latestVideos
  };
}

function addToMapList(map, key, video) {
  if (!key) return;
  const list = map.get(key);
  if (list) {
    list.push(video);
  } else {
    map.set(key, [video]);
  }
}

function sortMapListsByNewest(map, metaById) {
  for (const [key, videos] of map) {
    map.set(key, sortNewest(videos, metaById));
  }
}

function sortNewest(videos, metaById = buildIndex?.metaById) {
  return [...videos].sort((a, b) => {
    const metaA = metaById?.get(a.id);
    const metaB = metaById?.get(b.id);
    const dateDiff = (metaB?.dateValue ?? videoDateValue(b)) - (metaA?.dateValue ?? videoDateValue(a));
    if (dateDiff) return dateDiff;
    return String(b?.id || "").localeCompare(String(a?.id || ""));
  });
}

function sharedScore(current, candidate) {
  const currentMeta = buildIndex.metaById.get(current.id);
  const candidateMeta = buildIndex.metaById.get(candidate.id);
  if (!currentMeta || !candidateMeta) return 0;
  const currentTags = new Set([...currentMeta.categories, ...currentMeta.tags].map((value) => value.toLowerCase()));
  const candidateTags = [...candidateMeta.categories, ...candidateMeta.tags].map((value) => value.toLowerCase());
  const sharedTags = candidateTags.filter((tag) => currentTags.has(tag)).length;
  const seriesScore = currentMeta.prefix && currentMeta.prefix === candidateMeta.prefix ? 20 : 0;
  return sharedTags * 6 + seriesScore;
}

function sortStable(videos, seed, scoreFn) {
  return [...videos].sort((a, b) => {
    const scoreDiff = scoreFn(b) - scoreFn(a);
    if (scoreDiff) return scoreDiff;
    const dateDiff = (buildIndex.metaById.get(b.id)?.dateValue ?? videoDateValue(b)) - (buildIndex.metaById.get(a.id)?.dateValue ?? videoDateValue(a));
    if (dateDiff) return dateDiff;
    return stableHash(`${seed}:${a.id}`) - stableHash(`${seed}:${b.id}`);
  });
}

function takeUnique(source, limit, used) {
  const picked = [];
  for (const video of source) {
    if (!video?.id || used.has(video.id) || isAdVideo(video)) continue;
    used.add(video.id);
    picked.push(video);
    if (picked.length >= limit) break;
  }
  return picked;
}

function recommendationSections(video) {
  const used = new Set([video.id]);
  const meta = buildIndex.metaById.get(video.id);
  const candidates = relatedCandidates(video, meta);
  const prefix = meta?.prefix || "";
  const sections = [];

  const related = takeUnique(
    sortStable(candidates, `${video.id}:related`, (candidate) => sharedScore(video, candidate)),
    recommendationLimit,
    used
  );
  if (related.length) sections.push({ title: "相關影片", videos: related });

  if (prefix) {
    const sameSeries = takeUnique(
      buildIndex.videosByCatalogPrefix.get(prefix) || [],
      recommendationLimit,
      used
    );
    if (sameSeries.length) sections.push({ title: "同系列作品", videos: sameSeries });
  }

  const latest = takeUnique(
    buildIndex.latestVideos,
    recommendationLimit,
    used
  );
  if (latest.length) sections.push({ title: "最新更新", videos: latest });

  if (!sections.length) {
    const fallback = takeUnique(
      buildIndex.latestVideos,
      recommendationLimit,
      used
    );
    if (fallback.length) sections.push({ title: "猜你喜歡", videos: fallback });
  }

  return sections;
}

function relatedCandidates(video, meta) {
  if (!meta) return buildIndex.latestVideos.slice(0, maxRelatedCandidates);
  const candidates = [];
  const seen = new Set([video.id]);
  const add = (source) => {
    for (const candidate of source || []) {
      if (!candidate?.id || seen.has(candidate.id) || isAdVideo(candidate)) continue;
      seen.add(candidate.id);
      candidates.push(candidate);
      if (candidates.length >= maxRelatedCandidates) return;
    }
  };

  if (meta.prefix) add(buildIndex.videosByCatalogPrefix.get(meta.prefix));
  for (const category of meta.categories) {
    add(buildIndex.videosByCategory.get(category));
    if (candidates.length >= maxRelatedCandidates) break;
  }
  for (const tag of meta.tags) {
    add(buildIndex.videosByTag.get(tag));
    if (candidates.length >= maxRelatedCandidates) break;
  }
  if (!candidates.length) add(buildIndex.latestVideos);
  return candidates;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pageShell({ title, description, path, body, image = "/assets/brands/yequyingcheng/og-image.png", jsonLd }) {
  const canonical = `${siteUrl}${path}`;
  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${image}" />
    <link rel="icon" href="/assets/brands/yequyingcheng/favicon.svg" />
    <link rel="stylesheet" href="/src/styles.css" />
    ${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ""}
    <script type="module" src="/src/adsRuntime.js"></script>
    ${baiduAnalytics}
  </head>
  <body>
    <header class="topbar">
      <a class="brand" href="/"><img src="/assets/brands/yequyingcheng/logo.svg" alt="夜趣影城" /></a>
      <nav class="navlinks" aria-label="主要導覽">
        <a href="/">首頁</a>
      </nav>
    </header>
    ${body}
    <footer>
      <img src="/assets/brands/yequyingcheng/logo-icon.svg" alt="" />
      <span>夜趣影城</span>
    </footer>
  </body>
</html>`;
}

function renderVideoPage(video) {
  const path = `/video/${encodeURIComponent(video.id)}/`;
  const categories = publicCategories(video);
  const tags = displayTags(video);
  const embedUrl = playableEmbedUrl(video.embed_url);
  const visibleDescription = cleanVideoDescription(video);
  const metaDescription = visibleDescription || video.title;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: video.title,
    description: metaDescription,
    thumbnailUrl: video.cover || "/assets/brands/yequyingcheng/og-image.png",
    uploadDate: video.date,
    embedUrl: embedUrl || undefined,
    genre: video.category,
    keywords: tags.join(", ")
  };

  return pageShell({
    title: `${video.title} | 夜趣影城`,
    description: metaDescription,
    path,
    image: video.cover || "/assets/brands/yequyingcheng/og-image.png",
    jsonLd,
    body: `<main>
      <article class="seo-detail">
        <p class="eyebrow">Video Detail</p>
        <h1 class="video-detail-title">${escapeHtml(video.title)}</h1>
        ${visibleDescription ? `<p class="summary video-detail-description">${escapeHtml(visibleDescription)}</p>` : ""}
        ${renderDetailMeta(video, categories, tags)}
        <div class="hero-player seo-player">
          ${renderEmbedPlayer(video)}
        </div>
        <div data-ad-slot="ad_player_below"></div>
        ${renderVideoInfo(video, categories, tags, visibleDescription)}
        ${renderRecommendationSections(video)}
      </article>
    </main>`
  });
}

function renderDetailMeta(video, categories, tags) {
  const date = normalizeText(video.date);
  const chips = [
    date ? `<span>${escapeHtml(date)}</span>` : "",
    ...categories.map((category) => `<a href="/category/${encodeURIComponent(category)}/">${escapeHtml(category)}</a>`),
    ...tags.map((tag) => `<a href="/tag/${encodeURIComponent(tag)}/">${escapeHtml(tag)}</a>`)
  ].filter(Boolean);

  return chips.length ? `<div class="meta-row detail-meta">${chips.join("")}</div>` : "";
}

function renderVideoInfo(video, categories, tags, description) {
  const code = catalogCode(video);
  const rows = [
    ["Code", code],
    ["Date", normalizeText(video.date)],
    ["Type", normalizeText(video.type === "iframe" ? "Video" : video.type)],
    ["Category", categories.join(" / ")],
    ["Tags", tags.join(" / ")]
  ].filter(([, value]) => value);

  if (!rows.length && !description) return "";

  return `
    <section class="video-info-panel" aria-label="Video information">
      <div class="section-heading compact">
        <div>
          <p class="eyebrow">Info</p>
          <h2>影片資訊</h2>
        </div>
      </div>
      ${rows.length ? `<dl class="video-info-grid">${rows.map(([label, value]) => `
        <div>
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value)}</dd>
        </div>
      `).join("")}</dl>` : ""}
      ${description ? `<p class="video-info-description">${escapeHtml(description)}</p>` : ""}
    </section>
  `;
}

function renderRecommendationSections(video) {
  const sections = recommendationSections(video);
  if (!sections.length) return "";

  return `
    <section class="detail-recommendations" aria-label="Recommendations">
      ${sections.map((section) => `
        <div class="recommendation-section">
          <div class="section-heading compact">
            <div>
              <p class="eyebrow">Recommended</p>
              <h2>${escapeHtml(section.title)}</h2>
            </div>
          </div>
          <div class="video-grid recommendation-grid">
            ${section.videos.map((item, index) => renderSeoCard(item, index)).join("")}
          </div>
        </div>
      `).join("")}
    </section>
  `;
}

function cleanVideoDescription(video) {
  const title = String(video?.title || "").trim();
  let description = String(video?.description || "").trim();
  if (!description || description === title) return "";

  if (title && description.startsWith(title)) {
    description = description.slice(title.length).trim();
    description = description.replace(/^[，,。.\s:：-]+/, "").trim();
  }

  description = description
    .replace(/分類包含[^。.!！?？]*[。.!！?？]?/g, "")
    .replace(/標籤包含[^。.!！?？]*[。.!！?？]?/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!description || description === title || description.length < 20) return "";
  return description.length > 120 ? `${description.slice(0, 120).trim()}...` : description;
}

function renderEmbedPlayer(video) {
  const embedUrl = playableEmbedUrl(video.embed_url);
  if (!embedUrl) {
    return `<div class="player-empty"><img src="/assets/brands/yequyingcheng/logo-icon.svg" alt="" /><strong>影片即將上架</strong><span>此影片正在整理中，請先瀏覽其他精選內容。</span></div>`;
  }

  return `<div class="player-shell">
    <iframe
      src="${escapeHtml(embedUrl)}"
      title="${escapeHtml(video.title)}"
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      allowfullscreen
      referrerpolicy="no-referrer"
      loading="eager"
    ></iframe>
    <div class="player-fallback-action">
      <span>若播放器未顯示，請稍後再試。</span>
    </div>
  </div>`;
}

function playableEmbedUrl(url) {
  if (!url) return "";
  const id = String(url).match(/[?&]id=([^&]+)/)?.[1];
  if (String(url).includes("a-big.com/player") && id) {
    return `https://mmsi01.com/e/${encodeURIComponent(id)}`;
  }
  return url;
}

function renderListingPage(title, videos, path) {
  const description = `${title} 精選影片列表。`;
  return pageShell({
    title: `${title} | 夜趣影城`,
    description,
    path,
    body: `<main>
      <section class="library">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Archive</p>
            <h1>${escapeHtml(title)}</h1>
          </div>
        </div>
        <div class="video-grid">
          ${videos.map((video, index) => renderSeoCard(video, index)).join("")}
        </div>
      </section>
    </main>`
  });
}

function renderSeoCard(video, index) {
  return `<article class="video-card">
    <a class="thumb" href="/video/${encodeURIComponent(video.id)}/">
      ${video.cover ? `<img src="${escapeHtml(video.cover)}" alt="${escapeHtml(video.title)}" loading="lazy" />` : `<div class="poster-fallback ${["gold", "sangria", "violet", "smoke"][index % 4]}"><span>${String(index + 1).padStart(2, "0")}</span></div>`}
      <span class="play-dot">播放</span>
    </a>
    <div class="card-body">
      <h3 class="video-title"><a href="/video/${encodeURIComponent(video.id)}/">${escapeHtml(video.title)}</a></h3>
      <p>${escapeHtml(videoCardLabel(video))}</p>
      <div class="chips">${displayTags(video).slice(0, 4).map((tag) => `<a href="/tag/${encodeURIComponent(tag)}/">${escapeHtml(tag)}</a>`).join("")}</div>
    </div>
  </article>`;
}

function videoCardLabel(video) {
  return video?.type === "iframe" ? "影音" : video?.category?.[0] || "精選";
}

function renderRobots() {
  return `User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`;
}

function renderSitemap() {
  const urls = [
    "/",
    ...mockVideos.map((video) => `/video/${encodeURIComponent(video.id)}/`),
    ...[...buildIndex.videosByTag.keys()].map((tag) => `/tag/${encodeURIComponent(tag)}/`),
    ...[...buildIndex.videosByCategory.keys()].map((category) => `/category/${encodeURIComponent(category)}/`)
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${siteUrl}${url}</loc></url>`).join("\n")}
</urlset>
`;
}
