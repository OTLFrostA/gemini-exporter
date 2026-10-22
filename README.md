# 🌌 Gemini Exporter - Save All Your Chats

<p align="left">
  <b>English</b> | <a href="./README_zh.md">简体中文</a>
</p>

<p align="left">
  <a href="https://chromewebstore.google.com/detail/gemini-exporter/ldpbiafkgjlaooeplkiooljccpalpkgf?utm_source=github&utm_medium=readme_en&utm_campaign=github_repo">
    <img src="https://img.shields.io/badge/Chrome%20Web%20Store-Gemini%20Exporter-blue?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome Web Store">
  </a>
  <img src="https://img.shields.io/badge/Version-2.0.0-orange.svg?style=for-the-badge" alt="Version: 2.0.0">
  <img src="https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge" alt="License: MIT">
</p>

![Cumulative Chrome Web Store installs](https://raw.githubusercontent.com/OTLFrostA/gemini-exporter/stats/stats/install-growth.svg)

> **Your AI conversations are worth keeping.** Gemini Exporter is a **free, open-source, privacy-first** Chrome extension for saving your Google Gemini chats as files you control. Export one chat or a batch, keep local Markdown notes updated, and import older conversations from Google Takeout.

**No account registration, API key, cloud backup service, analytics, or tracking.** Export processing and storage happen on your device; reading current conversations uses your existing signed-in Gemini browser session.

## ✨ Features

- **One-click or batch export:** Save the current conversation from the popup, or scan, search, select, and export many conversations in the Workbench.
- **Four export formats:** Markdown (`.md`), HTML (`.html`), PDF (`.pdf`), and structured JSON (`.json`).
- **Two delivery choices:** Download with your browser or write directly to an authorized local folder. When a browser download contains multiple files, the extension **automatically creates a ZIP**; ZIP is not a separate format to select.
- **Live Save for Markdown:** Automatically update conversation notes in your chosen local folder after Gemini completes a reply.
- **Incremental sync and backup:** Scan conversations accessible to the signed-in account. Skip an already-complete export only when its format matches and the known source has not changed.
- **Google Takeout import:** Import an original Takeout ZIP to complement conversations accessible from the Gemini website, including older history and available offline resources.
- **Media-aware exports:** Preserve supported images, generated images, files, and source references when available. Missing or expired resources are reported rather than silently promised.
- **Built for daily use:** English/简体中文 interface, dark/light themes, guided onboarding, export status indicators, and retry/diagnostic options.

## 📄 Choose an export format

| Format | Best for | Notes |
| --- | --- | --- |
| **Markdown** (`.md`) | Obsidian, Logseq, notes, and plain-text archives | Readable text with references to any exported local assets |
| **HTML** (`.html`) | Opening an archived conversation in a browser | Gemini-inspired layout, math rendering, and light/dark viewing; exported media can live alongside it |
| **PDF** (`.pdf`) | Reading, sharing, and long-term document archives | Generated locally with Typst/WASM; browser font access may be requested for installed fonts, especially CJK |
| **JSON** (`.json`) | Structured data backups and later processing | Machine-readable conversation archive |

The file layout depends on the conversation's available resources. For example, Markdown/HTML exports with images may include `assets/` and `files/` alongside the main file. A browser download containing more than one output file is packaged as a ZIP automatically; **Save to local folder** writes files into the selected directory without that browser-download ZIP step.

## 📥 Install

**[Get Gemini Exporter from the Chrome Web Store](https://chromewebstore.google.com/detail/gemini-exporter/ldpbiafkgjlaooeplkiooljccpalpkgf?utm_source=github&utm_medium=readme_en&utm_campaign=github_repo)**

Or install from source in a Chromium-based browser:

```bash
git clone https://github.com/OTLFrostA/gemini-exporter.git
cd gemini-exporter
npm install
npm run build
```

Open `chrome://extensions/` (or your browser's extension page), enable **Developer mode**, choose **Load unpacked**, and select the repository folder. Folder-writing features require browser support for the File System Access API.

## 🚀 How to use

### Export your current conversation

1. Open a conversation at [Google Gemini](https://gemini.google.com) while signed in.
2. Click the Gemini Exporter toolbar icon and choose **Markdown**, **PDF**, **HTML**, or **JSON**.
3. Click **Export Current Conversation**. Popup exports use browser download.

### Back up multiple conversations

1. Open the extension **Workbench** from the popup.
2. Click **Sync All** to discover the conversation history currently accessible from Gemini. This is a scan, not a finished file backup.
3. Search or filter the list, then select the conversations you want.
4. Choose a **format** and one of the two visible destinations: **Browser download** or **Save to local folder**.
5. Optionally keep **Skip exported** enabled, then click **Export selected**.

For large batches, **Save to local folder** is usually preferable: the browser-download option has to prepare a ZIP in memory when the export produces multiple files. Local folder access requires choosing and authorizing a directory first.

### Keep Markdown updated with Live Save

1. In the Workbench, select **Save to local folder** and click **Choose folder**.
2. Choose **Markdown (.md)** as the export format.
3. Turn on **Live Save** inside the local-folder card.
4. Continue chatting on Gemini. Completed replies can update the corresponding local Markdown archive.

**Important:** Live Save works only with **Markdown + Save to local folder + valid folder permission**. Switching to browser download or another format pauses Live Save without clearing your enabled preference. Reauthorize the folder if your browser asks after a restart.

### Import history from Google Takeout

1. Download a Gemini archive from [Google Takeout](https://takeout.google.com/settings/takeout/custom/gemini).
2. In the Workbench, select the intended account and use **Import Takeout** to pick the **original ZIP** (no manual extraction needed).
3. The importer merges supported historical conversations into the local archive; select and export them as usual.

Takeout complements online scanning. Neither online scanning nor Takeout guarantees that an expired online attachment can still be recovered.

## 🔄 Scan, export, and status are different things

- **Sync All** refreshes the local conversation catalog from history available through Gemini; previously saved local conversations are not discarded merely because they are missing from a new scan.
- **Export selected** produces actual backup files. The Workbench tracks successful exports, newer changes, failures, and resource issues so you can decide what needs another attempt.
- **Skip exported** applies only to a complete, matching-format export whose known source has not changed. Use the filter and status indicators to find conversations to revisit.

## 🔒 Privacy and scope

Gemini Exporter has **no backend backup account** and does not send conversations to a developer-operated cloud service. It runs inside your browser, reading Gemini data through your signed-in session and processing exported files locally. Google services may still be contacted to retrieve the conversations and attachments you request.

This version exports **Google Gemini** conversations. The modular codebase has room for other providers, but exporting ChatGPT, Claude, or Grok is **not** a current feature. Local copies are your responsibility to back up separately if you want protection against device loss.

See the [Privacy Policy](./docs/PRIVACY_POLICY.md) for details.

## 🧩 Architecture (v2)

The current implementation separates provider acquisition, trusted conversation facts, document composition, rendering, and delivery:

| Module | Responsibility |
| --- | --- |
| **L1** | Gemini client, parsers, source capture, Takeout import, and resource acquisition |
| **L2** | Trusted conversation/account domain, index/detail, and scan coverage |
| **L3a** | Persistent local storage, settings, and directory handles |
| **L3b** | Document AST and composition |
| **L4** | Markdown/HTML/JSON/PDF rendering, packaging, and file delivery |
| **Application / Runtime / UI** | Sync/export workflows, browser coordination, and the popup/Workbench |

For the current module boundaries, see [src/README.md](./src/README.md). Older architecture notes may describe previous versions.

## 🧪 Development and testing

```bash
npm install
npm run build                  # Build the extension
npm test                       # Type checking, unit tests, build, and headless E2E
npm run test:v2:unit-ports      # v2 module contract checks
npm run test:v2:unit-isolation  # v2 unit isolation checks
```

Live account testing is separate: `npm run test:tier2` uses a configured debug Chrome with a signed-in Gemini session. Tier 3 focuses on autonomous visual QA. See [tests/README.md](./tests/README.md) for setup, boundaries, and the latest procedures.

## ❓ FAQ

**Do I need an API key or paid Gemini subscription?** No. Use your existing Gemini session. What can be read depends on your account and Gemini's available history.

**Does the Workbench's Sync All button download every chat?** No. Sync discovers or refreshes the local catalog. Select conversations and export them to create files.

**Where is the ZIP option?** There is no separate ZIP export format in v2. Browser downloads are zipped automatically when multiple files need to be delivered; folder exports write the files directly.

**Can Live Save export PDF or HTML continuously?** No. Live Save currently writes Markdown to an authorized local folder; other formats or browser download pause it.

**What if some attachments are expired?** Export results may indicate missing or expired resources. Gemini Exporter cannot reconstruct files that the source no longer makes available.

## 📜 License and disclaimer

Released under the [MIT License](./LICENSE). Gemini Exporter is an independent open-source project and is **not affiliated with, sponsored by, or endorsed by Google**. Google and Gemini are trademarks of Google LLC.
