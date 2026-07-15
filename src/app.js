import { activeAdItems, adsConfig, normalizeAds, SITE_CODE } from "./adsConfig.js";
import { mockVideos } from "./mockVideos.js";
import { rankFeaturedVideos, rankVideos } from "./ranking.js";

const brand = {
  name: "夜趣影城",
  logo: "/assets/brands/yequyingcheng/logo.svg",
  icon: "/assets/brands/yequyingcheng/logo-icon.svg"
};

const HOT_RANKING_HOSTS = ["yeying", "yeyingcheng", "ye-ying", "yesakura", "sakura"];
const NATIVE_AD_INTERVAL = 6;
const AD_DEVICE_BREAKPOINT = 760;
const SIDEBAR_DESKTOP_BREAKPOINT = 1200;
const SHUFFLE_SESSION_KEY = "yequyingcheng.videoOrder.v1";
const isDevEnvironment = ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
const DEFAULT_NATIVE_CTA = "立即體驗";
const INVALID_AD_TITLES = new Set([
  "原生廣告卡",
  "側欄廣告",
  "頂部手機廣告",
  "桌機橫幅廣告",
  "內容中段橫幅廣告",
  "播放器下方廣告",
  "ad_native_card",
  "ad_sidebar",
  "ad_mobile_top",
  "ad_desktop_leaderboard",
  "ad_inline_banner",
  "ad_player_below",
  "Native card ad",
  "Sidebar ad",
  "Mobile top ad",
  "Desktop leaderboard ad",
  "Inline banner ad",
  "Player below ad"
]);

let state = {
  query: "",
  tag: "全部",
  selected: sessionVideos()[0] || mockVideos[0],
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
    debugAdState("API slot keys", (payload.ads || []).map((slot) => slot?.slotKey || slot?.id));
    debugAdState("API ad_sidebar raw", (payload.ads || []).find((slot) => (slot?.slotKey || slot?.id) === "ad_sidebar"));
    return normalizeAds(payload.ads);
  } catch (error) {
    debugAdState("API fallback reason", error);
    const fallbackAds = normalizeAds(adsConfig);
    debugAdState("API slot keys", fallbackAds.map((slot) => slot.slotKey));
    debugAdState("API ad_sidebar raw", fallbackAds.find((slot) => slot.slotKey === "ad_sidebar"));
    return fallbackAds;
  }
}

function uniqueTags() {
  const tags = new Set(["全部"]);
  mockVideos.forEach((video) => publicTags(video).forEach((tag) => tags.add(tag)));
  return [...tags];
}

function filteredVideos() {
  const keyword = state.query.trim().toLowerCase();
  return sessionVideos().filter((video) => {
    const tags = publicTags(video);
    const text = [video.title, ...video.category, ...tags].join(" ").toLowerCase();
    const tagMatched = state.tag === "全部" || tags.includes(state.tag) || video.category.includes(state.tag);
    return tagMatched && (!keyword || text.includes(keyword));
  });
}

function sessionVideos() {
  const byId = new Map(mockVideos.map((video) => [video.id, video]));
  return sessionVideoOrder().map((id) => byId.get(id)).filter(Boolean);
}

function sessionVideoOrder() {
  const currentIds = mockVideos.map((video) => video.id);
  try {
    const stored = JSON.parse(sessionStorage.getItem(SHUFFLE_SESSION_KEY) || "[]");
    if (isValidVideoOrder(stored, currentIds)) return stored;
  } catch {
    // Continue with a fresh order when sessionStorage cannot be read.
  }

  const shuffled = fisherYates([...currentIds]);
  try {
    sessionStorage.setItem(SHUFFLE_SESSION_KEY, JSON.stringify(shuffled));
  } catch {
    // Browsing can continue even when sessionStorage cannot be written.
  }
  return shuffled;
}

function isValidVideoOrder(order, ids) {
  if (!Array.isArray(order) || order.length !== ids.length) return false;
  const expected = new Set(ids);
  const seen = new Set();
  for (const id of order) {
    if (!expected.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

function fisherYates(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
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
  const viewport = currentAdViewport();
  const slot = state.ads.find((adSlot) => adSlot.slotKey === slotKey);
  if (!slot) return "";
  const items = activeAdItems(slot, viewport);
  if (!items.length) return "";

  return renderAdSlotComponent(slot, items, options);
}

function activeAds(slotKeys, viewport) {
  const allowedSlots = new Set(slotKeys);
  return state.ads.flatMap((slot) => {
    if (!allowedSlots.has(slot.slotKey)) return [];
    return activeAdItems(slot, viewport).map((item) => ({ ...item, slotKey: slot.slotKey, intervalMs: slot.intervalMs }));
  });
}

function activeAdSlotItems(slotKey) {
  const viewport = currentAdViewport();
  const slot = state.ads.find((adSlot) => adSlot.slotKey === slotKey);
  if (!slot) return [];
  return activeAdItems(slot, viewport).map((item) => ({ ...item, slotKey: slot.slotKey }));
}

function renderNativeAdCard(item) {
  if (!item) return "";
  return renderNativeAdItem(item, { className: "ad-native" });
}

function shouldInsertNativeAd(index, nativeItems) {
  return nativeItems.length > 0 && index > 0 && index % NATIVE_AD_INTERVAL === 0;
}

function nativeAdForInsert(index, nativeItems) {
  const insertIndex = Math.floor(index / NATIVE_AD_INTERVAL) - 1;
  return nativeItems[insertIndex % nativeItems.length];
}

function renderHeroAdCarousel() {
  const viewport = currentAdViewport();
  const ads = activeAds(["ad_hero_side", "ad_mobile_top", "ad_desktop_leaderboard"], viewport);
  if (!ads.length) return "";
  if (ads.length === 1) return renderAdItem(ads[0], { className: "ad-hero" });

  return `
    <div class="ad-slot ad-hero ad-carousel" data-carousel>
      <div class="ad-carousel-track">
        ${ads.map((ad, index) => renderAdSlide(ad, index === 0)).join("")}
      </div>
      <div class="ad-carousel-dots" aria-label="廣告輪播指示">
        ${ads.map((ad, index) => `<button type="button" class="${index === 0 ? "active" : ""}" data-carousel-dot="${index}" aria-label="切換到廣告 ${index + 1}"></button>`).join("")}
      </div>
    </div>
  `;
}

function renderFeaturedVideosPanel(videos) {
  const featuredVideos = rankFeaturedVideos(videos.length ? videos : mockVideos, {
    domain: rankingDomain(),
    limit: 5
  });
  return `
    <aside class="featured-panel featured-carousel" aria-label="精選影片輪播" data-video-carousel>
      <div class="featured-carousel-track">
        ${featuredVideos.map((video, index) => `
          <a class="featured-slide ${index === 0 ? "active" : ""}" href="${videoPath(video)}">
            ${cardArt(video, index)}
            <span class="play-dot">播放</span>
          </a>
        `).join("")}
      </div>
      <div class="featured-dots" aria-label="精選影片輪播指示">
        ${featuredVideos.map((video, index) => `<button type="button" class="${index === 0 ? "active" : ""}" data-video-carousel-dot="${index}" aria-label="切換到精選影片 ${index + 1}"></button>`).join("")}
      </div>
    </aside>
  `;
}

function isHotRankingSite() {
  const hostname = window.location.hostname.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const siteMode = String(params.get("siteMode") || "").toLowerCase();
  return siteMode === "hot" || HOT_RANKING_HOSTS.some((host) => hostname.includes(host));
}

function rankingDomain() {
  return window.location.hostname || "local";
}

function renderHotRankingModules(videos) {
  const sections = [
    ["今日熱門", "daily"],
    ["本週排行", "weekly"],
    ["最新熱播", "latestHot"],
    ["最多人觀看", "mostViewed"],
    ["精選推薦", "featured"]
  ];

  return `
    <section class="ranking-board" aria-label="熱門排行榜">
      ${sections
        .map(([title, mode]) => {
          const ranked = rankVideos(videos, mode, { domain: rankingDomain() }).slice(0, 5);
          return renderRankingSection(title, ranked);
        })
        .join("")}
    </section>
  `;
}

function renderRankingSection(title, videos) {
  if (!videos.length) return "";
  return `
    <section class="ranking-section">
      <div class="section-heading compact">
        <div>
          <p class="eyebrow">Ranking</p>
          <h2>${escapeHtml(title)}</h2>
        </div>
      </div>
      <div class="ranking-grid">
        ${videos.map((video, index) => renderVideoCard(video, index, `<span class="rank-badge">${index + 1}</span>`)).join("")}
      </div>
    </section>
  `;
}

function renderAdSlotComponent(slot, items, options = {}) {
  if (items.length === 1 || !slot.carousel) {
    return renderAdItem({ ...items[0], slotKey: slot.slotKey }, options);
  }

  return renderAdCarousel(slot, items, options);
}

function renderAdCarousel(slot, items, options = {}) {
  return `
    <div class="ad-slot ${options.className || ""} ad-carousel" data-carousel data-interval="${Number(slot.intervalMs || 5000)}" data-slot="${escapeHtml(slot.slotKey)}">
      <div class="ad-carousel-track">
        ${items.map((item, index) => renderAdSlide({ ...item, slotKey: slot.slotKey }, index === 0)).join("")}
      </div>
      <button class="ad-carousel-arrow prev" type="button" data-carousel-prev aria-label="Previous ad"></button>
      <button class="ad-carousel-arrow next" type="button" data-carousel-next aria-label="Next ad"></button>
      <div class="ad-carousel-dots" aria-label="Ad carousel controls">
        ${items.map((item, index) => `<button type="button" class="${index === 0 ? "active" : ""}" data-carousel-dot="${index}" aria-label="Show ad ${index + 1}"></button>`).join("")}
      </div>
    </div>
  `;
}

function renderAdItem(ad, options = {}) {
  if (options.native) return renderNativeAdItem(ad, options);

  const body = `
    ${renderAdMedia(ad)}
  `;
  const link = ad.linkUrl || ad.link;
  if (!link) {
    return `<div class="ad-slot ${options.className || ""}" data-slot="${escapeHtml(ad.slotKey)}">${body}</div>`;
  }
  return `<a class="ad-slot ${options.className || ""}" data-slot="${escapeHtml(ad.slotKey)}" href="${escapeHtml(link)}" target="${escapeHtml(ad.target || "_blank")}" rel="noreferrer">${body}</a>`;
}

function renderNativeAdItem(ad, options = {}) {
  const title = displayAdTitle(ad);
  const subtitle = cleanAdText(ad.subtitle);
  const ctaText = cleanAdText(ad.ctaText) || DEFAULT_NATIVE_CTA;
  const body = `
    <div class="ad-native-thumb">
      ${renderAdMedia(ad)}
      <span class="ad-native-label">廣告</span>
    </div>
    <div class="ad-native-body">
      <strong>${escapeHtml(title)}</strong>
      ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
      <span class="ad-native-cta">${escapeHtml(ctaText)}</span>
    </div>
  `;
  const link = ad.linkUrl || ad.link;
  if (!link) {
    return `<div class="ad-slot ${options.className || ""}" data-slot="${escapeHtml(ad.slotKey)}">${body}</div>`;
  }
  return `<a class="ad-slot ${options.className || ""}" data-slot="${escapeHtml(ad.slotKey)}" href="${escapeHtml(link)}" target="${escapeHtml(ad.target || "_blank")}" rel="noreferrer">${body}</a>`;
}

function renderAdSlide(ad, active) {
  const title = displayAdTitle(ad);
  const body = `
    ${renderAdMedia(ad)}
    <div class="ad-slide-caption">
      <strong>${escapeHtml(title)}</strong>
    </div>
  `;
  const className = `ad-slide ${active ? "active" : ""}`;
  const link = ad.linkUrl || ad.link;
  if (!link) {
    return `<div class="${className}" data-slot="${escapeHtml(ad.slotKey)}">${body}</div>`;
  }
  return `<a class="${className}" data-slot="${escapeHtml(ad.slotKey)}" href="${escapeHtml(link)}" target="${escapeHtml(ad.target || "_blank")}" rel="noreferrer">${body}</a>`;
}

function renderAdMedia(ad) {
  const image = ad.imageUrl || ad.image;
  if (!image) {
    return `<div class="ad-empty"><strong>${escapeHtml(displayAdTitle(ad))}</strong><span>廣告素材待設定</span></div>`;
  }
  if (isVideoAsset(image)) {
    return `<video src="${escapeHtml(image)}" autoplay muted loop playsinline preload="metadata" onerror="window.reportAdMediaError?.(this); this.closest('.ad-slide,.ad-slot')?.classList.add('ad-media-error')"></video>`;
  }
  return `<img src="${escapeHtml(image)}" alt="${escapeHtml(displayAdTitle(ad))}" loading="lazy" onerror="window.reportAdMediaError?.(this); this.closest('.ad-slide,.ad-slot')?.classList.add('ad-media-error')" />`;
}

function displayAdTitle(ad) {
  const title = cleanAdText(ad?.title);
  if (!title || INVALID_AD_TITLES.has(title)) return "推薦內容";
  return title;
}

function cleanAdText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isVideoAsset(url) {
  return /\.(mp4|webm|ogg)(?:[?#].*)?$/i.test(String(url));
}

function currentAdViewport() {
  return window.matchMedia(`(max-width: ${AD_DEVICE_BREAKPOINT}px)`).matches ? "mobile" : "desktop";
}

function isSidebarDesktop() {
  return window.innerWidth >= SIDEBAR_DESKTOP_BREAKPOINT;
}

function getActiveSidebarAdItems() {
  const slot = state.ads.find((adSlot) => adSlot.slotKey === "ad_sidebar");
  const desktop = isSidebarDesktop();
  const items = slot && desktop ? activeAdItems(slot, "desktop") : [];
  debugAdState("ad_sidebar filtered", {
    innerWidth: window.innerWidth,
    sidebarBreakpoint: SIDEBAR_DESKTOP_BREAKPOINT,
    deviceState: desktop ? "desktop" : "mobile",
    slot,
    items
  });
  return { slot, items };
}

function renderSidebarAd() {
  const { slot, items } = getActiveSidebarAdItems();
  if (!slot || !items.length) return "";
  return `
    <aside class="sidebar-ad-area" aria-label="Sidebar advertisement">
      ${renderAdSlotComponent(slot, items, { className: "ad-sidebar" })}
    </aside>
  `;
}

function debugAdState(label, value) {
  if (!isDevEnvironment) return;
  console.debug(`[ads] ${label}`, value);
}

window.reportAdMediaError = (media) => {
  const container = media?.closest?.("[data-slot]");
  console.error("[ads] media failed to load", {
    slotKey: container?.dataset?.slot || "",
    src: media?.currentSrc || media?.src || ""
  });
};

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
        <span>若播放器未顯示，請稍後再試。</span>
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

function renderVideoCard(video, index, extra = "") {
  return `
    <article class="video-card" data-video="${video.id}">
      <a class="thumb" href="${videoPath(video)}">
        ${cardArt(video, index)}
        ${extra}
        <span class="play-dot">播放</span>
      </a>
      <div class="card-body">
        <h3 class="video-title"><a href="${videoPath(video)}">${escapeHtml(video.title)}</a></h3>
        <p>${escapeHtml(videoCardLabel(video))}</p>
        <div class="chips">
          ${publicTags(video).slice(0, 4).map((tag) => `<a href="${tagPath(tag)}">${escapeHtml(tag)}</a>`).join("")}
        </div>
      </div>
    </article>
  `;
}

function videoCardLabel(video) {
  return video?.type === "iframe" ? "影音" : video?.category?.[0] || "精選";
}

function render() {
  const videos = filteredVideos();
  const featured = state.selected || videos[0] || mockVideos[0];
  const mobileTop = renderAdSlot("ad_mobile_top", { className: "ad-mobile-top" });
  const leaderboard = renderAdSlot("ad_desktop_leaderboard", { className: "ad-leaderboard" });
  const heroFeatured = renderFeaturedVideosPanel(videos);
  const inlineAd = renderAdSlot("ad_inline_banner", { className: "ad-inline" });
  const nativeItems = activeAdSlotItems("ad_native_card");
  const hotRankingModules = isHotRankingSite() ? renderHotRankingModules(videos) : "";
  const sidebarAd = renderSidebarAd();
  const layoutClass = sidebarAd ? "front-layout has-sidebar" : "front-layout";
  debugAdState("viewport", {
    innerWidth: window.innerWidth,
    adDeviceBreakpoint: AD_DEVICE_BREAKPOINT,
    sidebarBreakpoint: SIDEBAR_DESKTOP_BREAKPOINT,
    adViewport: currentAdViewport(),
    sidebarViewport: isSidebarDesktop() ? "desktop" : "mobile"
  });

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
      <div class="${layoutClass}">
        <div class="main-content">
      <section id="featured" class="hero">
        <div class="hero-copy">
          <p class="eyebrow">夜趣特選</p>
          <h1>夜趣特選</h1>
          <p class="summary">提供優質影片，陪你度過每個夜晚</p>
        </div>
        ${heroFeatured}
      </section>

      ${inlineAd}
      ${hotRankingModules}

      <section id="tags" class="tag-strip" aria-label="標籤篩選">
        ${uniqueTags().map((tag) => `<button class="${tag === state.tag ? "active" : ""}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")}
      </section>

      <section id="library" class="library">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Library</p>
            <h2>最新片庫</h2>
          </div>
        </div>
        <div class="video-grid">
          ${videos.map((video, index) => `
            ${shouldInsertNativeAd(index, nativeItems) ? renderNativeAdCard(nativeAdForInsert(index, nativeItems)) : ""}
            ${renderVideoCard(video, index)}
          `).join("") || `<p class="empty">沒有符合條件的影片，請換一個標籤或關鍵字。</p>`}
        </div>
      </section>
        </div>
        ${sidebarAd}
      </div>
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

  startAdCarousels();
  startVideoCarousels();
}

let previousSidebarDesktop = isSidebarDesktop();
window.addEventListener("resize", () => {
  const nextSidebarDesktop = isSidebarDesktop();
  if (nextSidebarDesktop === previousSidebarDesktop) return;
  previousSidebarDesktop = nextSidebarDesktop;
  render();
});

function startAdCarousels() {
  document.querySelectorAll("[data-carousel]").forEach((carousel) => {
    const slides = [...carousel.querySelectorAll(".ad-slide")];
    const dots = [...carousel.querySelectorAll("[data-carousel-dot]")];
    if (slides.length < 2) return;
    let index = Math.max(0, slides.findIndex((slide) => slide.classList.contains("active")));
    let paused = false;
    const intervalMs = Math.max(1000, Number(carousel.dataset.interval || 5000));

    const show = (nextIndex) => {
      index = (nextIndex + slides.length) % slides.length;
      slides.forEach((slide, slideIndex) => slide.classList.toggle("active", slideIndex === index));
      dots.forEach((dot, dotIndex) => dot.classList.toggle("active", dotIndex === index));
    };

    dots.forEach((dot, dotIndex) => dot.addEventListener("click", () => show(dotIndex)));
    carousel.querySelector("[data-carousel-prev]")?.addEventListener("click", () => show(index - 1));
    carousel.querySelector("[data-carousel-next]")?.addEventListener("click", () => show(index + 1));
    carousel.addEventListener("mouseenter", () => {
      paused = true;
    });
    carousel.addEventListener("mouseleave", () => {
      paused = false;
    });
    window.setInterval(() => {
      if (!paused) show(index + 1);
    }, intervalMs);
  });
}

function startVideoCarousels() {
  document.querySelectorAll("[data-video-carousel]").forEach((carousel) => {
    const slides = [...carousel.querySelectorAll(".featured-slide")];
    const dots = [...carousel.querySelectorAll("[data-video-carousel-dot]")];
    if (slides.length < 2) return;
    let index = Math.max(0, slides.findIndex((slide) => slide.classList.contains("active")));

    const show = (nextIndex) => {
      index = nextIndex % slides.length;
      slides.forEach((slide, slideIndex) => slide.classList.toggle("active", slideIndex === index));
      dots.forEach((dot, dotIndex) => dot.classList.toggle("active", dotIndex === index));
    };

    dots.forEach((dot, dotIndex) => dot.addEventListener("click", () => show(dotIndex)));
    window.setInterval(() => show(index + 1), 5000);
  });
}
