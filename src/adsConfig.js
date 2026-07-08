export const SITE_CODE = "yequyingcheng01";

export const adsConfig = [
  {
    siteCode: SITE_CODE,
    slotKey: "ad_mobile_top",
    enabled: false,
    title: "頂部手機廣告",
    image: "",
    link: "",
    target: "_blank",
    desktopEnabled: false,
    mobileEnabled: true,
    startAt: "",
    endAt: "",
    sort: 1
  },
  {
    siteCode: SITE_CODE,
    slotKey: "ad_desktop_leaderboard",
    enabled: false,
    title: "桌機橫幅廣告",
    image: "",
    link: "",
    target: "_blank",
    desktopEnabled: true,
    mobileEnabled: false,
    startAt: "",
    endAt: "",
    sort: 2
  },
  {
    siteCode: SITE_CODE,
    slotKey: "ad_hero_side",
    enabled: true,
    title: "首頁主視覺廣告位",
    image: "",
    link: "",
    target: "_blank",
    desktopEnabled: true,
    mobileEnabled: true,
    startAt: "",
    endAt: "",
    sort: 3
  },
  {
    siteCode: SITE_CODE,
    slotKey: "ad_player_below",
    enabled: false,
    title: "播放器下方廣告",
    image: "",
    link: "",
    target: "_blank",
    desktopEnabled: true,
    mobileEnabled: true,
    startAt: "",
    endAt: "",
    sort: 4
  },
  {
    siteCode: SITE_CODE,
    slotKey: "ad_inline_banner",
    enabled: false,
    title: "內容中段橫幅廣告",
    image: "",
    link: "",
    target: "_blank",
    desktopEnabled: true,
    mobileEnabled: true,
    startAt: "",
    endAt: "",
    sort: 5
  },
  {
    siteCode: SITE_CODE,
    slotKey: "ad_native_card",
    enabled: false,
    title: "原生廣告卡",
    image: "",
    link: "",
    target: "_blank",
    desktopEnabled: true,
    mobileEnabled: true,
    startAt: "",
    endAt: "",
    sort: 6
  },
  {
    siteCode: SITE_CODE,
    slotKey: "ad_sidebar",
    enabled: false,
    title: "側欄廣告",
    image: "",
    link: "",
    target: "_blank",
    desktopEnabled: true,
    mobileEnabled: false,
    startAt: "",
    endAt: "",
    sort: 7
  }
];

export function normalizeAds(input) {
  const source = Array.isArray(input) ? input : [];
  const bySlot = new Map(source.map((item) => [item.slotKey, item]));
  return adsConfig
    .map((fallback) => sanitizeAd({ ...fallback, ...(bySlot.get(fallback.slotKey) || {}) }))
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

export function isAdActive(ad, viewport = "desktop", now = new Date()) {
  if (!ad?.enabled) return false;
  if (viewport === "mobile" && !ad.mobileEnabled) return false;
  if (viewport === "desktop" && !ad.desktopEnabled) return false;
  if (ad.startAt && new Date(ad.startAt) > now) return false;
  if (ad.endAt && new Date(ad.endAt) < now) return false;
  return true;
}
