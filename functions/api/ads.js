import { adsKey, json, normalizeAds, SITE_CODE } from "../_lib/ads.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const siteCode = url.searchParams.get("siteCode") || SITE_CODE;
  let ads = normalizeAds([], siteCode);

  if (env.ADS_KV) {
    const stored = await env.ADS_KV.get(adsKey(siteCode), "json");
    ads = normalizeAds(stored, siteCode);
  }

  return json({ siteCode, ads });
}
