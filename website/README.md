# Product landing page

Brand-neutral product landing page for `otlfrosta.com`. Static HTML/CSS, zero runtime JavaScript, no analytics, and no build dependencies.

## Preview locally

```sh
cd website/public
python3 -m http.server 8000
```

Open http://localhost:8000.

## Cloudflare Pages

- Repository: `OTLFrostA/gemini-exporter`
- Production branch: `main`
- Root directory: `/` (repository root)
- Framework: `None`
- Build command: leave blank
- Build output directory: `website/public`
- Optional build trigger path: `website/**`
- Custom domains: `otlfrosta.com` and `www.otlfrosta.com` (redirect `www` to apex after both are configured)

The website is isolated under `website/` and does not participate in the browser extension build. If desired, move this directory to a dedicated website repository later; no application dependencies need to move.

The screenshots in `website/public/assets` are copied from real, anonymized extension screenshots under `store_assets` in this repository, to keep the deployed site self-contained and avoid cross-origin asset requests.

## Content policy

Keep public platform claims in sync with the current Chrome Web Store release. ChatGPT, Claude, and Grok are experimental in source builds and should not be presented as published support until independently verified.