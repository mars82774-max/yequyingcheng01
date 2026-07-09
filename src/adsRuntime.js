import { activeAdItems, adsConfig, normalizeAds, SITE_CODE } from "./adsConfig.js";

const slots = [...document.querySelectorAll("[data-ad-slot]")];

if (slots.length) {
  renderSlots();
}

async function renderSlots() {
  const ads = await loadAds();
  const viewport = window.matchMedia("(max-width: 760px)").matches ? "mobile" : "desktop";
  slots.forEach((slotElement) => {
    const slotKey = slotElement.dataset.adSlot;
    const slot = ads.find((item) => item.slotKey === slotKey);
    const items = slot ? activeAdItems(slot, viewport) : [];
    if (!slot || !items.length) {
      slotElement.remove();
      return;
    }
    slotElement.innerHTML = renderAdSlot(slot, items);
  });
  startAdCarousels();
}

async function loadAds() {
  try {
    const response = await fetch(`/api/ads?siteCode=${encodeURIComponent(SITE_CODE)}`);
    if (!response.ok) throw new Error(`Ads API ${response.status}`);
    const payload = await response.json();
    return normalizeAds(payload.ads);
  } catch {
    return normalizeAds(adsConfig);
  }
}

function renderAdSlot(slot, items) {
  if (items.length === 1 || !slot.carousel) {
    return renderAdItem({ ...items[0], slotKey: slot.slotKey });
  }

  return `
    <div class="ad-slot ad-carousel" data-carousel data-interval="${Number(slot.intervalMs || 5000)}" data-slot="${escapeHtml(slot.slotKey)}">
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

function renderAdItem(ad) {
  const body = renderAdMedia(ad);
  const link = ad.linkUrl || ad.link;
  if (!link) return `<div class="ad-slot" data-slot="${escapeHtml(ad.slotKey)}">${body}</div>`;
  return `<a class="ad-slot" data-slot="${escapeHtml(ad.slotKey)}" href="${escapeHtml(link)}" target="${escapeHtml(ad.target || "_blank")}" rel="noreferrer">${body}</a>`;
}

function renderAdSlide(ad, active) {
  const body = `${renderAdMedia(ad)}<div class="ad-slide-caption"><strong>${escapeHtml(ad.title)}</strong></div>`;
  const className = `ad-slide ${active ? "active" : ""}`;
  const link = ad.linkUrl || ad.link;
  if (!link) return `<div class="${className}" data-slot="${escapeHtml(ad.slotKey)}">${body}</div>`;
  return `<a class="${className}" data-slot="${escapeHtml(ad.slotKey)}" href="${escapeHtml(link)}" target="${escapeHtml(ad.target || "_blank")}" rel="noreferrer">${body}</a>`;
}

function renderAdMedia(ad) {
  const image = ad.imageUrl || ad.image;
  if (!image) {
    return `<div class="ad-empty"><strong>${escapeHtml(ad.title)}</strong><span>Ad creative not configured</span></div>`;
  }
  if (/\.(mp4|webm|ogg)(?:[?#].*)?$/i.test(String(image))) {
    return `<video src="${escapeHtml(image)}" autoplay muted loop playsinline preload="metadata" onerror="this.closest('.ad-slide,.ad-slot')?.classList.add('ad-media-error')"></video>`;
  }
  return `<img src="${escapeHtml(image)}" alt="${escapeHtml(ad.title)}" loading="lazy" onerror="this.closest('.ad-slide,.ad-slot')?.classList.add('ad-media-error')" />`;
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
