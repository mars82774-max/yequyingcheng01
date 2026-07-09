import { activeAdItems, adsConfig, normalizeAds, SITE_CODE } from "./adsConfig.js";
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

function renderHeroAdCarousel() {
  const viewport = window.matchMedia("(max-width: 760px)").matches ? "mobile" : "desktop";
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
  const featuredVideos = (videos.length ? videos : mockVideos).slice(0, 5);
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
  const body = `
    ${renderAdMedia(ad)}
    ${options.native ? `<strong>${escapeHtml(ad.title)}</strong>` : ""}
  `;
  const link = ad.linkUrl || ad.link;
  if (!link) {
    return `<div class="ad-slot ${options.className || ""}" data-slot="${escapeHtml(ad.slotKey)}">${body}</div>`;
  }
  return `<a class="ad-slot ${options.className || ""}" data-slot="${escapeHtml(ad.slotKey)}" href="${escapeHtml(link)}" target="${escapeHtml(ad.target || "_blank")}" rel="noreferrer">${body}</a>`;
}

function renderAdSlide(ad, active) {
  const body = `
    ${renderAdMedia(ad)}
    <div class="ad-slide-caption">
      <strong>${escapeHtml(ad.title)}</strong>
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
    return `<div class="ad-empty"><strong>${escapeHtml(ad.title)}</strong><span>廣告素材待設定</span></div>`;
  }
  if (isVideoAsset(image)) {
    return `<video src="${escapeHtml(image)}" autoplay muted loop playsinline preload="metadata" onerror="this.closest('.ad-slide,.ad-slot')?.classList.add('ad-media-error')"></video>`;
  }
  return `<img src="${escapeHtml(image)}" alt="${escapeHtml(ad.title)}" loading="lazy" onerror="this.closest('.ad-slide,.ad-slot')?.classList.add('ad-media-error')" />`;
}

function isVideoAsset(url) {
  return /\.(mp4|webm|ogg)(?:[?#].*)?$/i.test(String(url));
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

function render() {
  const videos = filteredVideos();
  const featured = state.selected || videos[0] || mockVideos[0];
  const mobileTop = renderAdSlot("ad_mobile_top", { className: "ad-mobile-top" });
  const leaderboard = renderAdSlot("ad_desktop_leaderboard", { className: "ad-leaderboard" });
  const heroFeatured = renderFeaturedVideosPanel(videos);
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
        </div>
        ${heroFeatured}
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
                <h3 class="video-title"><a href="${videoPath(video)}">${escapeHtml(video.title)}</a></h3>
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

  startAdCarousels();
  startVideoCarousels();
}

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
