import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mockVideos } from "../src/mockVideos.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const siteUrl = "https://yequyingcheng01.pages.dev";

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const entry of ["src", "assets"]) {
  await cp(join(root, entry), join(dist, entry), { recursive: true });
}

const sourceIndex = await readFile(join(root, "index.html"), "utf-8");
const seoLinks = mockVideos
  .map((video) => `<a href="/video/${encodeURIComponent(video.id)}/">${escapeHtml(video.title)}</a>`)
  .join("\n      ");
await writeFile(join(dist, "index.html"), sourceIndex.replace("<!-- SEO_LINKS -->", seoLinks), "utf-8");

for (const video of mockVideos) {
  await writeHtml(`video/${video.id}/index.html`, renderVideoPage(video));
}

for (const tag of unique(mockVideos.flatMap((video) => publicTags(video)))) {
  const videos = mockVideos.filter((video) => publicTags(video).includes(tag));
  await writeHtml(`tag/${tag}/index.html`, renderListingPage(`標籤：${tag}`, videos, `/tag/${encodeURIComponent(tag)}/`));
}

for (const category of unique(mockVideos.flatMap((video) => video.category))) {
  const videos = mockVideos.filter((video) => video.category.includes(category));
  await writeHtml(`category/${category}/index.html`, renderListingPage(`分類：${category}`, videos, `/category/${encodeURIComponent(category)}/`));
}

await writeFile(join(dist, "robots.txt"), renderRobots(), "utf-8");
await writeFile(join(dist, "sitemap.xml"), renderSitemap(), "utf-8");

console.log("Built static site to dist");

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
  return (video.tags || []).filter((tag) => tag && !isCatalogCode(tag));
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
  </head>
  <body>
    <header class="topbar">
      <a class="brand" href="/"><img src="/assets/brands/yequyingcheng/logo.svg" alt="夜趣影城" /></a>
      <nav class="navlinks" aria-label="主要導覽">
        <a href="/">首頁</a>
        <a href="/sitemap.xml">Sitemap</a>
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
  const tags = publicTags(video);
  const description = `${video.title}，分類包含 ${video.category.join("、")}，標籤包含 ${tags.join("、")}。`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: video.title,
    description,
    thumbnailUrl: video.cover || "/assets/brands/yequyingcheng/og-image.png",
    uploadDate: video.date,
    embedUrl: video.embed_url || undefined,
    genre: video.category,
    keywords: tags.join(", ")
  };

  return pageShell({
    title: `${video.title} | 夜趣影城`,
    description,
    path,
    image: video.cover || "/assets/brands/yequyingcheng/og-image.png",
    jsonLd,
    body: `<main>
      <article class="seo-detail">
        <p class="eyebrow">Video Detail</p>
        <h1>${escapeHtml(video.title)}</h1>
        <p class="summary">${escapeHtml(description)}</p>
        <div class="meta-row">
          <span>${escapeHtml(video.date)}</span>
          ${video.category.map((category) => `<a href="/category/${encodeURIComponent(category)}/">${escapeHtml(category)}</a>`).join("")}
        </div>
        <div class="chips">
          ${tags.map((tag) => `<a href="/tag/${encodeURIComponent(tag)}/">${escapeHtml(tag)}</a>`).join("")}
        </div>
        <div class="hero-player seo-player">
          ${renderEmbedPlayer(video)}
        </div>
      </article>
    </main>`
  });
}

function renderEmbedPlayer(video) {
  if (!video.embed_url) {
    return `<div class="player-empty"><img src="/assets/brands/yequyingcheng/logo-icon.svg" alt="" /><strong>影片即將上架</strong><span>此影片正在整理中，請先瀏覽其他精選內容。</span></div>`;
  }

  return `<div class="player-shell">
    <iframe
      src="${escapeHtml(video.embed_url)}"
      title="${escapeHtml(video.title)}"
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      allowfullscreen
      referrerpolicy="no-referrer"
      loading="eager"
    ></iframe>
    <div class="player-fallback-action">
      <span>若播放器未顯示，請改用新視窗播放。</span>
      <a class="ghost-action" href="${escapeHtml(video.embed_url)}" target="_blank" rel="noreferrer">開啟播放器</a>
    </div>
  </div>`;
}

function renderListingPage(title, videos, path) {
  const description = `${title}，共 ${videos.length} 部影片。`;
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
          <span>${videos.length} 部影片</span>
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
      <div class="poster-fallback ${["gold", "sangria", "violet", "smoke"][index % 4]}"><span>${String(index + 1).padStart(2, "0")}</span></div>
      <span class="play-dot">播放</span>
    </a>
    <div class="card-body">
      <h3><a href="/video/${encodeURIComponent(video.id)}/">${escapeHtml(video.title)}</a></h3>
      <p>${escapeHtml(video.date)} · ${escapeHtml(video.provider)}</p>
      <div class="chips">${publicTags(video).slice(0, 4).map((tag) => `<a href="/tag/${encodeURIComponent(tag)}/">${escapeHtml(tag)}</a>`).join("")}</div>
    </div>
  </article>`;
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
    ...unique(mockVideos.flatMap((video) => publicTags(video))).map((tag) => `/tag/${encodeURIComponent(tag)}/`),
    ...unique(mockVideos.flatMap((video) => video.category)).map((category) => `/category/${encodeURIComponent(category)}/`)
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${siteUrl}${url}</loc></url>`).join("\n")}
</urlset>
`;
}
