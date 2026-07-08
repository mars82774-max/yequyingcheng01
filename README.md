# Yequyingcheng Cloudflare Pages Project

This is a static frontend project for Yequyingcheng. It is ready for Cloudflare Pages deployment and currently uses `mockVideos` as its data source. It does not include real ad-network integrations and does not require a Cloudflare API token.

## Local Development

```bash
npm run dev
```

Default local URL:

```text
http://localhost:4173
```

## Static Build

```bash
npm run build
```

Build output:

```text
dist
```

## SEO Output

`npm run build` generates:

- `/video/<id>/index.html`: static detail page for each video
- `/tag/<tag>/index.html`: static tag archive pages
- `/category/<category>/index.html`: static category archive pages
- `/sitemap.xml`
- `/robots.txt`

These pages include crawlable titles, descriptions, categories, tags, static links, and VideoObject structured data for search engines such as Google and Baidu.

## Cloudflare Pages Settings

- Project name: `yequyingcheng01`
- Production branch: `main`
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variables: `None`

## Project Rules

- Brand assets are stored in: `assets/brands/yequyingcheng/`
- Image paths use web-relative paths, for example `/assets/brands/yequyingcheng/logo.svg`
- Video data currently comes from `src/mockVideos.js`
- Do not handle Cloudflare account login
- Do not request a Cloudflare API token
- Do not change DNS
- Do not add real ad-network integrations
