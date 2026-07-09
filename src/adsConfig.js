export const SITE_CODE = "yequyingcheng01";

const slotDefaults = [
  ["ad_mobile_top", "Mobile top ad", true, false, true, 1],
  ["ad_desktop_leaderboard", "Desktop leaderboard ad", true, true, false, 2],
  ["ad_hero_side", "Hero side ad", true, true, true, 3],
  ["ad_player_below", "Player below ad", false, true, true, 4],
  ["ad_inline_banner", "Inline banner ad", false, true, true, 5],
  ["ad_native_card", "Native card ad", false, true, true, 6],
  ["ad_sidebar", "Sidebar ad", false, true, false, 7]
];

const defaultItemsBySlot = {
  ad_mobile_top: [
    {
      id: "ad_mobile_top_001",
      enabled: true,
      title: "Mobile top test ad",
      subtitle: "",
      ctaText: "",
      imageUrl: "/assets/brands/yequyingcheng/og-image.png",
      linkUrl: "/",
      target: "_self",
      sort: 1,
      desktopEnabled: false,
      mobileEnabled: true,
      startAt: "",
      endAt: ""
    }
  ],
  ad_desktop_leaderboard: [
    {
      id: "ad_desktop_leaderboard_001",
      enabled: true,
      title: "Desktop leaderboard test ad 1",
      subtitle: "",
      ctaText: "",
      imageUrl: "/assets/brands/yequyingcheng/og-image.png",
      linkUrl: "/",
      target: "_self",
      sort: 1,
      desktopEnabled: true,
      mobileEnabled: false,
      startAt: "",
      endAt: ""
    },
    {
      id: "ad_desktop_leaderboard_002",
      enabled: true,
      title: "Desktop leaderboard test ad 2",
      subtitle: "",
      ctaText: "",
      imageUrl: "/assets/brands/yequyingcheng/logo.png",
      linkUrl: "/",
      target: "_self",
      sort: 2,
      desktopEnabled: true,
      mobileEnabled: false,
      startAt: "",
      endAt: ""
    }
  ]
};

export const adsConfig = slotDefaults.map(([slotKey, title, enabled, desktopEnabled, mobileEnabled, sort]) => ({
  siteCode: SITE_CODE,
  id: slotKey,
  slotKey,
  title,
  enabled,
  desktopEnabled,
  mobileEnabled,
  carousel: true,
  intervalMs: 5000,
  sort,
  items: defaultItemsBySlot[slotKey] || [
    {
      id: `${slotKey}_001`,
      enabled,
      title,
      subtitle: "",
      ctaText: "",
      imageUrl: "",
      linkUrl: "",
      target: "_blank",
      sort: 1,
      desktopEnabled,
      mobileEnabled,
      startAt: "",
      endAt: ""
    }
  ]
}));

export function normalizeAds(input) {
  const source = Array.isArray(input) ? input : [];
  const bySlot = new Map(source.map((item) => [item?.id || item?.slotKey, item]).filter(([slotKey]) => slotKey));
  return adsConfig
    .map((fallback) => sanitizeAdSlot({ ...fallback, ...(bySlot.get(fallback.slotKey) || {}) }))
    .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));
}

export function sanitizeAdSlot(slot) {
  const slotKey = slot?.slotKey || slot?.id;
  const fallback = adsConfig.find((item) => item.slotKey === slotKey || item.id === slotKey) || adsConfig[0];
  const legacyItem = legacySlotToItem(slot, fallback);
  const sourceItems = hasLegacyItemFields(slot) ? [legacyItem] : Array.isArray(slot?.items) ? slot.items : [];

  return {
    siteCode: String(slot?.siteCode || SITE_CODE),
    id: String(slot?.id || slot?.slotKey || fallback.slotKey),
    slotKey: String(slot?.slotKey || slot?.id || fallback.slotKey),
    title: String(slot?.title || fallback.title || ""),
    enabled: Boolean(slot?.enabled),
    desktopEnabled: slot?.desktopEnabled === undefined ? Boolean(fallback.desktopEnabled) : Boolean(slot.desktopEnabled),
    mobileEnabled: slot?.mobileEnabled === undefined ? Boolean(fallback.mobileEnabled) : Boolean(slot.mobileEnabled),
    carousel: slot?.carousel === undefined ? true : Boolean(slot.carousel),
    intervalMs: Math.max(1000, Number(slot?.intervalMs || 5000)),
    sort: Number(slot?.sort || fallback.sort || 0),
    items: sourceItems.map((item, index) => sanitizeAdItem(item, fallback, index))
  };
}

export function sanitizeAdItem(item, fallbackSlot = {}, index = 0) {
  return {
    id: String(item?.id || `${fallbackSlot.slotKey || "ad"}_${Date.now()}_${index + 1}`),
    enabled: item?.enabled === undefined ? true : Boolean(item.enabled),
    title: String(item?.title ?? ""),
    subtitle: String(item?.subtitle || ""),
    ctaText: String(item?.ctaText || ""),
    imageUrl: String(item?.imageUrl || item?.image || ""),
    linkUrl: String(item?.linkUrl || item?.link || ""),
    target: item?.target === "_self" ? "_self" : "_blank",
    sort: Number(item?.sort || index + 1),
    desktopEnabled: item?.desktopEnabled === undefined ? Boolean(fallbackSlot.items?.[0]?.desktopEnabled) : Boolean(item.desktopEnabled),
    mobileEnabled: item?.mobileEnabled === undefined ? Boolean(fallbackSlot.items?.[0]?.mobileEnabled) : Boolean(item.mobileEnabled),
    startAt: String(item?.startAt || ""),
    endAt: String(item?.endAt || "")
  };
}

export function activeAdItems(slot, viewport = "desktop", now = new Date()) {
  if (!slot?.enabled) return [];
  if (viewport === "mobile" && slot.mobileEnabled === false) return [];
  if (viewport === "desktop" && slot.desktopEnabled === false) return [];
  return (Array.isArray(slot.items) ? slot.items : [])
    .filter((item) => isAdItemActive(item, viewport, now))
    .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));
}

export function isAdItemActive(item, viewport = "desktop", now = new Date()) {
  if (!item?.enabled) return false;
  if (viewport === "mobile" && !item.mobileEnabled) return false;
  if (viewport === "desktop" && !item.desktopEnabled) return false;
  if (item.startAt && new Date(item.startAt) > now) return false;
  if (item.endAt && new Date(item.endAt) < now) return false;
  return true;
}

export function isAdActive(ad, viewport = "desktop", now = new Date()) {
  if (Array.isArray(ad?.items)) return activeAdItems(ad, viewport, now).length > 0;
  return isAdItemActive(ad, viewport, now);
}

function legacySlotToItem(slot, fallback) {
  const fallbackItem = fallback?.items?.[0] || {};
  return {
    id: `${slot?.slotKey || slot?.id || fallback.slotKey}_001`,
    enabled: slot?.enabled === undefined ? true : Boolean(slot.enabled),
    title: slot?.title || fallback.title,
    subtitle: slot?.subtitle || fallbackItem.subtitle || "",
    ctaText: slot?.ctaText || fallbackItem.ctaText || "",
    imageUrl: slot?.imageUrl || slot?.image || fallbackItem.imageUrl || "",
    linkUrl: slot?.linkUrl || slot?.link || fallbackItem.linkUrl || "",
    target: slot?.target || fallbackItem.target || "_blank",
    sort: 1,
    desktopEnabled: slot?.desktopEnabled === undefined ? fallbackItem.desktopEnabled : slot.desktopEnabled,
    mobileEnabled: slot?.mobileEnabled === undefined ? fallbackItem.mobileEnabled : slot.mobileEnabled,
    startAt: slot?.startAt || "",
    endAt: slot?.endAt || ""
  };
}

function hasLegacyItemFields(slot) {
  return ["image", "link", "imageUrl", "linkUrl", "subtitle", "ctaText", "target", "startAt", "endAt"].some((field) =>
    Object.prototype.hasOwnProperty.call(slot || {}, field)
  );
}
