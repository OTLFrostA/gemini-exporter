# Product homepage

Static, brand-neutral landing page for https://otlfrosta.com.

All files for the website live on the permanent `website` branch. The browser extension's `main` branch intentionally contains no website source.

## Develop locally

```sh
git fetch origin website
git switch website
cd public
python3 -m http.server 8000
```

Visit http://localhost:8000. There is no dependency installation, build step, or runtime JavaScript.

## Cloudflare Pages

- GitHub repository: `OTLFrostA/gemini-exporter`
- Production branch: `website` (not `main`)
- Framework preset: None
- Build command: leave blank
- Root directory: `/`
- Build output directory: `public`
- Custom domain: `otlfrosta.com`
- Optional `www.otlfrosta.com` alias with redirect to apex

Push website-only updates to `website`; Cloudflare Pages automatically deploys that branch. Do not merge website commits into `main`.

## Content and privacy

The screenshots in `public/assets/` come from real desktop Chrome captures of the extension using a test/staging account. They contain synced test-account conversation titles, not anonymized fixture data. No conversation bodies or email addresses appear. The images are copied locally, avoiding cross-origin requests. See `main:docs/product-screenshots.md` for capture provenance. The dark image shows local-folder delivery selected, but Live Save is off and no folder has been authorized. The website does not load analytics, external scripts, or third-party fonts.

Keep marketing claims aligned with the published Chrome Web Store release. Gemini is published; ChatGPT, Claude, and Grok may be experimental in source builds and must not be presented as published support before verification.
