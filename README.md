# Yequyingcheng Cloudflare Pages Project

Static frontend plus a lightweight Cloudflare Pages Functions ad admin for Yequyingcheng.

## Local Development

```bash
npm run dev
```

Default local URL:

```text
http://localhost:4173
```

The local static dev server does not emulate Cloudflare KV or Pages Functions. If `/api/ads` is unavailable, the frontend uses `src/adsConfig.js` defaults.

## Static Build

```bash
npm run build
```

Build output:

```text
dist
```

## Cloudflare Pages Settings

- Project name: `yequyingcheng01`
- Production branch: `main`
- Build command: `npm run build`
- Build output directory: `dist`
- Framework preset: `None`

## Cloudflare Functions And KV

This project uses Cloudflare Pages Functions:

- `GET /api/ads?siteCode=yequyingcheng01`: public read-only ad config
- `POST /api/admin/login`: admin login
- `POST /api/admin/logout`: admin logout
- `GET /api/admin/ads?siteCode=yequyingcheng01`: authenticated ad config read
- `PUT /api/admin/ads`: authenticated ad config write

Create a KV namespace and bind it to Pages:

```text
Binding name: ADS_KV
```

Set this Pages environment variable:

```text
ADMIN_PASSWORD=<your admin password>
```

Do not put the admin password or Cloudflare API token in frontend code.

`wrangler.example.toml` includes a KV binding template. Copy it to `wrangler.toml` only if you deploy with Wrangler. In the Cloudflare dashboard, configure the same binding name `ADS_KV`.

## Admin

Admin page:

```text
/admin
```

The first version supports:

- Login with `ADMIN_PASSWORD`
- List all ad slots
- Enable or disable ads
- Image URL input
- Link URL input
- Target setting
- Desktop and mobile visibility
- Start and end time
- Sort order
- Save to Cloudflare KV

Ad slots:

- `ad_mobile_top`
- `ad_desktop_leaderboard`
- `ad_hero_side`
- `ad_player_below`
- `ad_inline_banner`
- `ad_native_card`
- `ad_sidebar`

## Frontend Ad Behavior

- Frontend reads `/api/ads?siteCode=yequyingcheng01`
- If the API fails, it falls back to `src/adsConfig.js`
- Disabled ads are not rendered and do not leave blank space
- Mobile ads are regular in-flow blocks and do not cover bottom navigation
- Ads display `Advertisement` or `AD`
- Native ad card displays an `AD` label

## Project Rules

- Brand assets are stored in `assets/brands/yequyingcheng/`
- Image paths use web-relative paths
- Video data currently comes from `src/mockVideos.js`
- No real ad-network integrations
- No third-party CMS
- No DNS changes
