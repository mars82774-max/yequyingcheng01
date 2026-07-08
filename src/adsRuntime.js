import { adsConfig, isAdActive, normalizeAds, SITE_CODE } from "./adsConfig.js";

const slots = [...document.querySelectorAll("[data-ad-slot]")];

if (slots.length) {
  renderSlots();
}

async function renderSlots() {
  const ads = await loadAds();
  const viewport = window.matchMedia("(max-width: 760px)").matches ? "mobile" : "desktop";
  slots.forEach((slot) => {
    const slotKey = slot.dataset.adSlot;
    const match = ads
      .filter((ad) => ad.slotKey === slotKey && isAdActive(ad, viewport))
      .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))[0];
    if (!match) {
      slot.remove();
      return;
    }
    slot.innerHTML = renderAd(match);
  });
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

function renderAd(ad) {
  const image = ad.image
    ? `<img src="${escapeHtml(ad.image)}" alt="${escapeHtml(ad.title)}" loading="lazy" />`
    : `<div class="ad-empty"><strong>${escapeHtml(ad.title)}</strong><span>廣告素材待設定</span></div>`;
  const body = `<span class="ad-label">Advertisement</span>${image}`;
  if (!ad.link) return `<div class="ad-slot" data-slot="${escapeHtml(ad.slotKey)}">${body}</div>`;
  return `<a class="ad-slot" data-slot="${escapeHtml(ad.slotKey)}" href="${escapeHtml(ad.link)}" target="${escapeHtml(ad.target || "_blank")}" rel="noreferrer">${body}</a>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
