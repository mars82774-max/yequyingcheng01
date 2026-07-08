import { adsKey, json, normalizeAds, SITE_CODE } from "../../_lib/ads.js";
import { isAuthorized } from "../../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  if (!(await isAuthorized(request, env))) return json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const siteCode = url.searchParams.get("siteCode") || SITE_CODE;
  const stored = env.ADS_KV ? await env.ADS_KV.get(adsKey(siteCode), "json") : null;
  return json({ siteCode, ads: normalizeAds(stored, siteCode) });
}

export async function onRequestPut({ request, env }) {
  if (!(await isAuthorized(request, env))) return json({ error: "Unauthorized" }, { status: 401 });
  if (!env.ADS_KV) return json({ error: "ADS_KV binding is not configured" }, { status: 500 });

  const body = await request.json().catch(() => ({}));
  const siteCode = body.siteCode || SITE_CODE;
  const ads = normalizeAds(body.ads, siteCode);
  await env.ADS_KV.put(adsKey(siteCode), JSON.stringify(ads));
  return json({ siteCode, ads });
}
