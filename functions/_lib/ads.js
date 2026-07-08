export const SITE_CODE = "yequyingcheng01";

export const defaultAds = [
  ["ad_mobile_top", "頂部手機廣告", false, false, true, 1],
  ["ad_desktop_leaderboard", "桌機橫幅廣告", false, true, false, 2],
  ["ad_hero_side", "首頁主視覺廣告位", true, true, true, 3],
  ["ad_player_below", "播放器下方廣告", false, true, true, 4],
  ["ad_inline_banner", "內容中段橫幅廣告", false, true, true, 5],
  ["ad_native_card", "原生廣告卡", false, true, true, 6],
  ["ad_sidebar", "側欄廣告", false, true, false, 7]
].map(([slotKey, title, enabled, desktopEnabled, mobileEnabled, sort]) => ({
  siteCode: SITE_CODE,
  slotKey,
  enabled,
  title,
  image: "",
  link: "",
  target: "_blank",
  desktopEnabled,
  mobileEnabled,
  startAt: "",
  endAt: "",
  sort
}));

export function adsKey(siteCode = SITE_CODE) {
  return `ads:${siteCode}`;
}

export function normalizeAds(input, siteCode = SITE_CODE) {
  const source = Array.isArray(input) ? input : [];
  const bySlot = new Map(source.map((item) => [item.slotKey, item]));
  return defaultAds
    .map((fallback) => sanitizeAd({ ...fallback, ...(bySlot.get(fallback.slotKey) || {}), siteCode }))
    .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));
}

export function sanitizeAd(ad) {
  return {
    siteCode: String(ad.siteCode || SITE_CODE),
    slotKey: String(ad.slotKey || ""),
    enabled: Boolean(ad.enabled),
    title: String(ad.title || ""),
    image: String(ad.image || ""),
    link: String(ad.link || ""),
    target: ad.target === "_self" ? "_self" : "_blank",
    desktopEnabled: Boolean(ad.desktopEnabled),
    mobileEnabled: Boolean(ad.mobileEnabled),
    startAt: String(ad.startAt || ""),
    endAt: String(ad.endAt || ""),
    sort: Number(ad.sort || 0)
  };
}

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(init.headers || {})
    }
  });
}
