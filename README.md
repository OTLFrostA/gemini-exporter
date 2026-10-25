# Product homepage

Minimal, brand-neutral product landing page: https://otlfrosta.com.

The site lives entirely on the permanent `website` branch. Do not merge website code into the extension's `main` branch.

## Positioning

The website communicates exactly three primary benefits:

1. 100% free, open source, and local processing without a developer-operated conversation storage service.
2. One batch export of synced Gemini conversations, including available images/attachments; Markdown, HTML, PDF and JSON.
3. Live Save automatically updates Markdown backups in an authorized local folder after new Gemini replies.

Gemini is available in the published extension. ChatGPT, Claude and Grok remain experimental and must not be marketed as released until verified. No offline or browser-closed autosaving is promised.

## Local preview

```sh
git fetch origin website
git switch website
cd public
python3 -m http.server 8000
```

## Cloudflare Pages

- Project: `otlfrosta-site`
- GitHub repo: `OTLFrostA/gemini-exporter`
- Production branch: `website` (NOT `main`)
- Framework preset: None
- Build command: empty
- Root directory: `/`
- Output directory: `public`
- Custom domains: `otlfrosta.com`, `www.otlfrosta.com` (301 to apex)

The static page loads no JavaScript, external fonts, analytics, or trackers. The hero image is an actual Chrome screenshot from a test account, with no email addresses or conversation bodies. See `main:docs/product-screenshots.md` for capture notes. Privacy and product documentation are linked to the extension's main branch.
