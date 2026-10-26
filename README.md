# Product homepage — otlfrosta.com

A static, privacy-preserving landing page on the permanent `website` branch. Keep it separate from the extension's `main` branch.

## Messaging and layout

1. Free, open source, and **local-only processing**, no developer server for chat uploads, subscriptions or telemetry.
2. **Bulk export** of accessible Gemini history, using Sync All → select all → Export selected. Supported formats: Markdown, PDF, HTML, JSON. Original source files are included when still available.
3. **Background Live Save** that updates local Markdown backups after new Gemini replies while browsing.

Each benefit has one explanatory paragraph and one visual: a diagram, authentic workbench screenshot, or a Live Save conceptual diagram. The diagrams are illustrations, not screenshots. Do not make images clickable or show a test-account caption.

Preserve a practical FAQ with real current button names and content about batch exports, slow or interrupted exports, Skip exported, large Gemini histories, Google Takeout ZIP import, local privacy, formats/attachments, and current platform support. FAQ wording should match the published extension and user guide in `main`.

## Deploy via Cloudflare Pages

- Project: `otlfrosta-site`
- Repo: `OTLFrostA/gemini-exporter`
- Production branch: `website`
- Framework: None; build command: empty; output directory: `public`
- Domain: `otlfrosta.com` (with `www` redirected to apex)

The Cloudflare zone has **Web Analytics auto-injection enabled** (EU Lite mode excludes EU visitor metrics). The site uses no analytics cookies, local visitor IDs, or fingerprinting. `public/_headers` strictly allows only Cloudflare's beacon script and same-origin `/cdn-cgi/rum` reporting. No GA4 script, consent banner, external fonts, or extension telemetry. A tiny local first-party script (`public/utm.js`) copies inbound UTM values to both Chrome Web Store CTA URLs without network calls.

## X Bio short URL and attribution

- `https://otlfrosta.com/x` responds with HTTP 302 to `https://otlfrosta.com/?utm_source=twitter&utm_medium=social&utm_campaign=x_bio` via `public/_redirects`.
- The homepage CTA buttons read `utm_source`, `utm_medium`, and `utm_campaign` directly from the current URL and pass them through to the Chrome Web Store link. Values must be short ASCII campaign tokens. No cookies, local storage, or extra requests from **the UTM pass-through script itself**; Cloudflare's independently configured Web Analytics beacon is separate.
- When there are no incoming UTM parameters, existing default `utm_source=otlfrosta.com&utm_medium=website&utm_campaign=hero|footer` remains unchanged.
- For new source-specific entry points, define a new path rule in `public/_redirects`, no DNS record required. Do not change the extension `main` branch.

This tracks campaign-level Chrome Web Store visits and installs, not X post impressions or cross-site user identities.

## Separate privacy policies

- **Chrome Web Store Privacy Policy URL:** `https://otlfrosta.com/privacy` (`public/privacy.html`) describes the browser extension's local-only processing, local storage, permissions and source-service requests. It is linked from the homepage's extension privacy FAQ.
- **Website privacy:** `https://otlfrosta.com/website-privacy` (`public/website-privacy.html`) describes Cloudflare-hosted website analytics, infrastructure processing, and campaign URL pass-through. It is linked from the homepage footer.
- Both pages have English and Simplified Chinese sections and a two-link policy switcher (plain links; no JavaScript tabs).
- Keep extension claims aligned with `main/docs/PRIVACY_POLICY.md` when the extension changes, and website analytics claims aligned with Cloudflare's live RUM/EU Lite configuration. The two static pages are independent snapshots rather than a new build-time dependency.
- `public/privacy.css` styles both policy pages; it does not affect the homepage.
