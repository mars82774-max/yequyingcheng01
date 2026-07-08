import { adsConfig, isAdActive, normalizeAds, SITE_CODE } from "./adsConfig.js";
import { mockVideos } from "./mockVideos.js";

const brand = {
  name: "夜趣影城",
  logo: "/assets/brands/yequyingcheng/logo.svg",
  icon: "/assets/brands/yequyingcheng/logo-icon.svg"
};

let state = {
  query: "",
  tag: "全部",
  selected: mockVideos[0],
  ads: adsConfig
};

const app = document.querySelector("#app");

init();

async function init() {
  state.ads = await loadAds();
  render();
}

async function loadAds() {
  try {
    const response = await fetch(`/api/ads?siteCode=${encodeURIComponent(SITE_CODE)}`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Ads API ${response.status}`);
    const payload = await response.json();
    return normalizeAds(payload.ads);
  } catch {
    return normalizeAds(adsConfig);
  }
}

function uniqueTags() {
  const tags = new Set(["全部"]);
  mockVideos.forEach((video) => publicTags(video).forEach((tag) => tags.add(tag)));
  return [...tags];
}

function filteredVideos() {
  const keyword = state.query.trim().toLowerCase();
  return mockVideos.filter((video) => {
    const tags = publicTags(video);
    const text = [video.title, ...video.category, ...tags].join(" ").toLowerCase();
    const tagMatched = state.tag === "全部" || tags.includes(state.tag) || video.category.includes(state.tag);
    return tagMatched && (!keyword || text.includes(keyword));
  });
}

function isCatalogCode(value) {
  return /^[A-Z]{2,6}(?:-\d{2,5})?$/.test(String(value).trim());
}

function publicTags(video) {
  return (video.tags || []).filter((tag) => tag && !isCatalogCode(tag));
}

function videoPath(video) {
  return `/video/${encodeURIComponent(video.id)}/`;
}

function tagPath(tag) {
  return `/tag/${encodeURIComponent(tag)}/`;
}

function cardArt(video, index) {
  if (video.cover) {
    return `<img src="${video.cover}" alt="${escapeHtml(video.title)}" loading="lazy" />`;
  }
  const tone = ["gold", "sangria", "violet", "smoke", "ember", "midnight"][index % 6];
  return `<div class="poster-fallback ${tone}"><span>${String(index + 1).padStart(2, "0")}</span></div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderAdSlot(slotKey, options = {}) {
  const viewport = window.matchMedia("(max-width: 760px)").matches ? "mobile" : "desktop";
  const ads = state.ads
    .filter((ad) => ad.slotKey === slotKey && isAdActive(ad, viewport))
    .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));
  if (!ads.length) return "";

  return ads.map((ad) => renderAd(ad, options)).join("");
}

function renderAd(ad, options = {}) {
  const label = options.native ? "AD" : "Advertisement";
  const image = ad.image
    ? `<img src="${escapeHtml(ad.image)}" alt="${escapeHtml(ad.title)}" loading="lazy" />`
    : `<div class="ad-empty"><strong>${escapeHtml(ad.title)}</strong><span>廣告素材待設定</span></div>`;
  const body = `
    <span class="ad-label">${label}</span>
    ${image}
    ${options.native ? `<strong>${escapeHtml(ad.title)}</strong>` : ""}
  `;
  if (!ad.link) {
    return `<div class="ad-slot ${options.className || ""}" data-slot="${escapeHtml(ad.slotKey)}">${body}</div>`;
  }
  return `<a class="ad-slot ${options.className || ""}" data-slot="${escapeHtml(ad.slotKey)}" href="${escapeHtml(ad.link)}" target="${escapeHtml(ad.target || "_blank")}" rel="noreferrer">${body}</a>`;
}

function renderPlayer(video) {
  const embedUrl = playableEmbedUrl(video.embed_url);
  if (!embedUrl) {
    return `
      <div class="player-empty">
        <img src="${brand.icon}" alt="" />
        <strong>影片即將上架</strong>
        <span>此影片正在整理中，請先瀏覽其他精選內容。</span>
      </div>
    `;
  }

  return `
    <div class="player-shell">
      <iframe
        src="${escapeHtml(embedUrl)}"
        title="${escapeHtml(video.title)}"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowfullscreen
        referrerpolicy="no-referrer"
        loading="eager"
      ></iframe>
      <div class="player-fallback-action">
        <span>若播放器未顯示，請改用新視窗播放。</span>
        <a class="ghost-action" href="${escapeHtml(embedUrl)}" target="_blank" rel="noreferrer">開啟播放器</a>
      </div>
    </div>
  `;
}

function playableEmbedUrl(url) {
  if (!url) return "";
  const id = String(url).match(/[?&]id=([^&]+)/)?.[1];
  if (String(url).includes("a-big.com/player") && id) {
    return `https://mmsi01.com/e/${encodeURIComponent(id)}`;
  }
  return url;
}

function render() {
  const videos = filteredVideos();
  const featured = state.selected || videos[0] || mockVideos[0];
  const mobileTop = renderAdSlot("ad_mobile_top", { className: "ad-mobile-top" });
  const leaderboard = renderAdSlot("ad_desktop_leaderboard", { className: "ad-leaderboard" });
  const heroAd = renderAdSlot("ad_hero_side", { className: "ad-hero" });
  const inlineAd = renderAdSlot("ad_inline_banner", { className: "ad-inline" });
  const nativeAd = renderAdSlot("ad_native_card", { className: "ad-native", native: true });

  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="/" aria-label="${brand.name}">
        <img src="${brand.logo}" alt="${brand.name}" />
      </a>
      <nav class="navlinks" aria-label="主要導覽">
        <a href="#featured">精選</a>
        <a href="#library">片庫</a>
      </nav>
      <label class="search">
        <span>搜尋</span>
        <input id="searchInput" type="search" placeholder="輸入片名、分類或標籤" value="${escapeHtml(state.query)}" />
      </label>
    </header>

    <main>
      ${mobileTop}
      ${leaderboard}
      <section id="featured" class="hero">
        <div class="hero-copy">
          <p class="eyebrow">夜趣特選</p>
          <h1>夜趣特選</h1>
          <p class="summary">提供優質影片，陪你度過每個夜晚</p>
          <div class="meta-row">
            <span>${escapeHtml(featured.date || "未標日期")}</span>
            ${featured.category.map((cat) => `<a href="/category/${encodeURIComponent(cat)}/">${escapeHtml(cat)}</a>`).join("")}
          </div>
        </div>
        ${heroAd}
      </section>

      ${inlineAd}

      <section id="tags" class="tag-strip" aria-label="標籤篩選">
        ${uniqueTags().map((tag) => `<button class="${tag === state.tag ? "active" : ""}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")}
      </section>

      <section id="library" class="library">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Library</p>
            <h2>最新片庫</h2>
          </div>
          <span>${videos.length} 部影片</span>
        </div>
        <div class="video-grid">
          ${videos.map((video, index) => `
            ${index === 2 ? nativeAd : ""}
            <article class="video-card" data-video="${video.id}">
              <a class="thumb" href="${videoPath(video)}">
                ${cardArt(video, index)}
                <span class="play-dot">播放</span>
              </a>
              <div class="card-body">
                <h3><a href="${videoPath(video)}">${escapeHtml(video.title)}</a></h3>
                <p>${escapeHtml(video.date || "未標日期")} · ${escapeHtml(video.provider || "精選")}</p>
                <div class="chips">
                  ${publicTags(video).slice(0, 4).map((tag) => `<a href="${tagPath(tag)}">${escapeHtml(tag)}</a>`).join("")}
                </div>
              </div>
            </article>
          `).join("") || `<p class="empty">沒有符合條件的影片，請換一個標籤或關鍵字。</p>`}
        </div>
      </section>
    </main>

    <footer>
      <img src="${brand.icon}" alt="" />
      <span>${brand.name}</span>
    </footer>
  `;

  bindEvents();
}

function bindEvents() {
  document.querySelector("#searchInput")?.addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });

  document.querySelectorAll("[data-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tag = button.dataset.tag;
      render();
    });
  });

  document.querySelectorAll("[data-video], [data-play]").forEach((node) => {
    node.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      const id = node.dataset.video || node.dataset.play;
      state.selected = mockVideos.find((video) => video.id === id) || state.selected;
      window.scrollTo({ top: 0, behavior: "smooth" });
      render();
    });
  });
}
