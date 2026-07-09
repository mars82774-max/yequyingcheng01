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

export const defaultAds = slotDefaults.map(([slotKey, title, enabled, desktopEnabled, mobileEnabled, sort]) => ({
  siteCode: SITE_CODE,
  slotKey,
  title,
  enabled,
  carousel: true,
  intervalMs: 5000,
  sort,
  items: defaultItemsBySlot[slotKey] || [
    {
      id: `${slotKey}_001`,
      enabled,
      title,
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

export function adsKey(siteCode = SITE_CODE) {
  return `ads:${siteCode}`;
}

export function normalizeAds(input, siteCode = SITE_CODE) {
  const source = Array.isArray(input) ? input : [];
  const bySlot = new Map(source.map((item) => [item?.slotKey, item]).filter(([slotKey]) => slotKey));
  return defaultAds
    .map((fallback) => sanitizeAdSlot({ ...fallback, ...(bySlot.get(fallback.slotKey) || {}), siteCode }))
    .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));
}

export function sanitizeAdSlot(slot) {
  const fallback = defaultAds.find((item) => item.slotKey === slot?.slotKey) || defaultAds[0];
  const legacyItem = legacySlotToItem(slot, fallback);
  const sourceItems = hasLegacyItemFields(slot) ? [legacyItem] : Array.isArray(slot?.items) ? slot.items : [legacyItem];

  return {
    siteCode: String(slot?.siteCode || SITE_CODE),
    slotKey: String(slot?.slotKey || fallback.slotKey),
    title: String(slot?.title || fallback.title || ""),
    enabled: Boolean(slot?.enabled),
    carousel: slot?.carousel === undefined ? true : Boolean(slot.carousel),
    intervalMs: Math.max(1000, Number(slot?.intervalMs || 5000)),
    sort: Number(slot?.sort || fallback.sort || 0),
    items: sourceItems.map((item, index) => sanitizeAdItem(item, fallback, index))
  };
}

export function sanitizeAdItem(item, fallbackSlot = {}, index = 0) {
  return {
    id: String(item?.id || `${fallbackSlot.slotKey || "ad"}_${Date.now()}_${index + 1}`),
    enabled: Boolean(item?.enabled),
    title: String(item?.title || fallbackSlot.title || ""),
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

function legacySlotToItem(slot, fallback) {
  const fallbackItem = fallback?.items?.[0] || {};
  return {
    id: `${slot?.slotKey || fallback.slotKey}_001`,
    enabled: Boolean(slot?.enabled),
    title: slot?.title || fallback.title,
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
  return ["image", "link", "imageUrl", "linkUrl", "target", "desktopEnabled", "mobileEnabled", "startAt", "endAt"].some((field) =>
    Object.prototype.hasOwnProperty.call(slot || {}, field)
  );
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
