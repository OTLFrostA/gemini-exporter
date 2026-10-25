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

No external scripts, analytics, tracking, or fonts. HTML/CSS and local SVG/PNG only.
