# 🌌 Gemini Exporter

<p align="left">
  <b>English</b> | <a href="./README_zh.md">简体中文</a>
</p>

<p align="left">
  <a href="https://chromewebstore.google.com/detail/gemini-exporter/ldpbiafkgjlaooeplkiooljccpalpkgf?utm_source=github&utm_medium=readme_en&utm_campaign=github_repo" target="_blank">
    <img src="https://img.shields.io/badge/Chrome%20Web%20Store-Gemini%20Exporter-blue?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome Web Store">
  </a>
</p>

> **A powerful, privacy-first, fully open-source Chrome extension to batch export and archive your Google Gemini conversations.**  
> Export all your chat history with one click into Markdown, JSON (including OpenAI-compatible format), or a ZIP bundle with images and attachments. Seamlessly migrate your conversations into Obsidian, Notion, Logseq, and other local personal knowledge bases.

---

## 🌟 Key Features

- 🔒 **100% Client-Side & Zero Privacy Leakage**:
  - All processing runs completely inside your browser's local sandbox. **Never sends credentials, cookies, or chat messages to any third-party server.**
- 📊 **Dedicated Batch Workbench (Options Page)**:
  - An intuitive dark-themed dashboard to view, filter, and manage all your synced conversations.
  - Filter chats by status: *All*, *Exported*, *Needs Re-export*, *Unexported*, or *Failed*.
  - Full **Bilingual Support (English / 简体中文)** with a 1-click language switcher in the header.
- 🧭 **Interactive Guided Onboarding Tour**:
  - A friendly, 4-step visual walkthrough for first-time users. Highlights synchronization, conversation selection, export configuration, and final export with high-contrast indicator badges and auto-completion persistence.
- 📦 **Multiple Export Formats**:
  - **Markdown (`.md`)**: Beautiful formatting, syntax-highlighted code blocks, math equations, collapsible thinking details (`<details>`), and web citations.
  - **JSON (OpenAI Format)**: Ready-to-use format for LLM fine-tuning pipelines and third-party tools.
  - **JSON (Raw / Complete Metadata)**: Complete structured payload containing raw timestamps and conversation metadata.
- 🖼️ **Full Support for Attachments, Deep Research Reports & High-Res Imagen Assets**:
  - Automatically detects and downloads user-uploaded files (PDFs, DOCX, ZIPs, etc.) and AI-generated high-resolution Imagen pictures with globally unique asset filenames.
  - **Deep Research Deduplication**: Smartly parses and mounts multi-turn Gemini 2.0 Deep Research report documents without duplicating attachments across turns.
  - Assets are neatly organized into an `assets/` subfolder with relative references preserved in Markdown.
- ⚡ **Event-Driven Async Pipeline (`AsyncQueue`) & Keepalive Resilience**:
  - Replaces busy polling with an event-driven `AsyncQueue` worker pool for ultra-fast, CPU-efficient concurrent attachment downloading.
  - **MV3 Service Worker Keepalive Heartbeat**: Dispatches lightweight keepalive pings during long batch exports and deep scans, preventing Chrome from suspending the background worker mid-session.
  - **Crash & Interruption Recovery Banner**: Automatically detects unfinished export sessions and offers 1-click resumption.
- 👥 **Multi-Account Switching & Complete State Isolation**:
  - Seamlessly switch between multiple logged-in Google accounts (`u0`, `u1`, `u2`, etc.) with independent local storage, conversation lists, Takeout media caches, and per-slot abort controllers (`__bgAborts`).
- 📥 **Google Takeout Integration & Legacy Chat Recovery (Takeout ZIP Import)**:
  - Directly load your Google Takeout archive (`takeout-*.zip`) to recover legacy conversations truncated by Gemini's cloud UI pagination limits.
  - **Offline Media Fallback Pool**: Automatically indexes offline media from the ZIP, seamlessly replacing any failed online asset downloads (e.g., due to expired tokens or 403 errors).
- 🚨 **Google Sliding Window Wall Detection & Takeout Limit Modal**:
  - Automatically detects when a full scan hits Google's server-side ~500–650 cursor pagination wall (`BardErrorInfo 1096` or HTTP 429), popping up a helpful guidance modal to direct users to Google Takeout import with single-time tutorial dismissal protection.
- 🏷️ **Single Source of Truth (SSoT) Architecture**:
  - **Path Traversal Defense (`sanitizeRelativePath`)**: Authoritative path sanitizer preventing directory traversal (`..`) and Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, etc.) across ZIP and FileSystem writers.
  - **Unified Title Arbitration (`TITLE_SOURCE_PRIORITY`)**: Strict multi-tier hierarchy (RPC > DOM > Takeout > Sniff > Legacy) preventing brand name pollution ("Google Gemini") and preserving genuine conversation titles.
  - **Deterministic Sorting (`compareConversations`)**: Completely unified conversation sorting algorithm between content scripts and UI workbench, eliminating list jitter and sorting drift.
- 🔄 **Smart Incremental Sync & Change Detection**:
  - Locally records conversation IDs, update timestamps, and message counts.
  - Supports "Skip already exported" mode. When an existing conversation receives new replies, it is automatically flagged as "Needs Re-export" for ultra-fast incremental backups.
- ⚡ **Zero-Configuration Ready**:
  - No official Gemini API key required. No account passwords exposed. Simply browse Google Gemini as usual, and session credentials (`at`, `bl`) are automatically intercepted in a sandboxed MAIN-world hook with automatic HTTP 400 self-healing refresh.

---

## 📥 Installation

Compatible with all modern Chromium-based browsers (**Google Chrome**, **Microsoft Edge**, **Brave**, **Arc**, **Vivaldi**, etc.).

### Method 1: Install from Chrome Web Store (Recommended)

Install directly from the official Chrome Web Store with one click:

👉 **[Get Gemini Exporter on Chrome Web Store](https://chromewebstore.google.com/detail/gemini-exporter/ldpbiafkgjlaooeplkiooljccpalpkgf?utm_source=github&utm_medium=readme_en&utm_campaign=github_repo)**

### Method 2: Load Unpacked Extension (Developer / Source Code)

1. Clone this repository to your local machine:
   ```bash
   git clone https://github.com/OTLFrostA/gemini-exporter.git
   ```
2. Open your browser's extension management page:
   - **Chrome**: Navigate to `chrome://extensions/`
   - **Edge**: Navigate to `edge://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** in the top-left corner.
5. Select the cloned repository folder to finish installation.

---

## 🚀 Usage Guide

### 1. Quick Single-Chat Export (Popup)
1. Open and sign in to [Google Gemini](https://gemini.google.com).
2. Click the **Gemini Exporter** icon in your browser toolbar to open the popup.
3. Choose your desired format (Markdown / JSON), and click **"Export Current Page"** to download the active conversation instantly.

### 2. Batch Export & Incremental Sync (Workbench)
1. Click **"Go to Workbench"** in the popup (or right-click the extension icon and select "Options").
2. For first-time visitors, follow the **Interactive Onboarding Tour** to explore the main controls.
3. In the Workbench:
   - Click **"Sync Latest"** for fast incremental sync, or **"Deep Scan"** to gather your entire chat history.
   - Select the conversations you want to export (supports *Select All*, *Unexported Only*, *Updated Only*, and real-time search).
   - Configure options: download assets, package as ZIP, direct write to local folder via FileSystem API, etc.
   - Click **"Export Selected → ZIP"** (or Folder) to archive your chats.

### 3. Google Takeout Import & Legacy Chat Recovery
For heavy users with thousands of conversations, Google's web interface enforces a sliding window ceiling (~600–650 chats). You can recover and archive your complete legacy history using official Google Takeout:
1. Visit **[Google Takeout](https://takeout.google.com)**, deselect all, and check only **Gemini**. Create and download the exported `takeout-*.zip` archive.
2. Open the Gemini Exporter **Workbench (Options)**, navigate to the **"Google Takeout Import"** section, and select or drag-and-drop the ZIP file (or click "Import Takeout" directly from the Takeout Limit guidance modal).
3. The extension instantly parses all prompt histories and conversation indexes completely inside your browser's local sandbox.
4. **Offline Media Fallback Pool**: If cloud assets encounter 403 or expired token errors during export, the extension automatically retrieves original images and attachments from the Takeout archive, ensuring 100% complete backups.

---

## 🛡️ Architecture & Layered Design

Gemini Exporter enforces a strict 4-tier modular architecture across Chrome MV3 boundaries and domain responsibilities:

```
src/
  background/                  Extension Service Worker Subsystem
    background.js              MV3 Service Worker, keepalive heartbeat & session routing

  content/                     Injected Gemini Content Script Subsystem
    content.js                 In-page DOM observation & sync coordinator
    content.css                Sync status floating UI & badge styles
    bootstrap.js               Page token & credential bootstrap
    hookCredentials.js         MAIN world sandboxed network interceptor & credential bridge

  core/                        Pure Domain Logic & Engine (Decoupled from DOM)
    api/
      geminiClient.js          batchexecute RPC client, HTTP 400 auto-retry & token refresh
      geminiParser.js          Protocol parsing, turns, attachments & title extraction
    engine/
      exportEngine.js          Event-driven AsyncQueue export coordinator & streaming
      takeoutEngine.js         Google Takeout archive parser & isolated offline media pool
      chatFormatter.js         Markdown, JSON, OpenAI schema formatters
      assetFetcher.js          Media, images, and blob streaming fetcher
      domScraper.js            Live document fallback DOM scraper
      writers/
        zipWriter.js           JSZip in-memory zip packaging writer
        fsWriter.js            FileSystem Access API directory tree writer
    storage/
      storageService.js        Multi-account slot chrome.storage abstraction
      formatStore.js           Export format validation & persistence
    utils/
      utils.js                 Single Source of Truth: path sanitization, title arbitration, sorting
      constants.js             Enums, format definitions, storage keys
      tabService.js            Tab query, routing, and message failover
      i18n.js                  Bilingual dictionary & translation engine

  ui/                          User Interface Subsystem
    options/                   Workbench markup & options coordinator
    popup/                     Browser action popup markup & coordinator
    tour/                      Interactive onboarding tour guide & styling
    state/
      conversationsStore.js    Reactive conversation state & slot manager
    views/
      listView.js              Virtual conversation list & selection renderer
      logView.js               Diagnostic console log view
      accountView.js           Multi-account slot selector dropdown
      dialogView.js            Session recovery banner & modal dialogs
    controllers/
      exportController.js      Export execution & progress orchestration
      syncController.js        Incremental & deep history scan coordinator
      takeoutController.js     Takeout ZIP import & conflict resolution
      dirHandleController.js   FileSystem Access API IndexedDB persistence
```

### Key Engineering Invariants
1. **Core Zero DOM Dependencies**: Core parsing, formatting, path sanitization, and sorting logic have zero DOM dependencies, running identically in Node.js unit tests, Web Workers, and extension pages.
2. **Strict UI Separation**: `state` handles storage sync, `views` handles HTML rendering, `controllers` orchestrates workflows, and `options.js` acts as a thin coordinator.
3. **Single Source of Truth (SSoT)**: All path sanitization (`sanitizeRelativePath`), filename cleaning, sorting arbitration (`compareConversations`), and title resolution reside exclusively in `src/core/utils/utils.js`.
4. **Sandboxed Credential Bridge**: `hookCredentials.js` runs in the host page's MAIN world, sandboxing all interceptions so that extension errors never affect native Google Gemini operations.

---

## 🧪 Testing & Quality Architecture

The project adopts a rigorous **Two-Tier Testing Architecture**:

### Tier 1: Fast & Headless CI Gate
- **Execution Command**: `npm test` (or `python tests/run_tests.py && npx playwright test`)
- **Coverage**: 22 unit test suites and 14 headless Playwright E2E browser tests (~18 seconds total runtime). Fully self-contained with no external network or real Google credentials required. Enforced on all Pull Requests via GitHub Actions.

### Tier 2: Live Debug Staging Harness
- **Execution Command**: `npm run test:live` (or `python scripts/test_live_chat_and_export.py`)
- **Environment**: Connects to an active Chrome instance with remote debugging port 9222 (`./scripts/open_test_chrome.sh` / `open_test_chrome.ps1`).
- **Dynamic Dataset Freshness Gate**: Enforces a strict 2-minute dataset freshness gate during automated collaborative development to prevent stale test data reuse.

---

## 🔒 Privacy Policy

Gemini Exporter is built with privacy as a foundational principle:
- **100% Client-Side**: Operates entirely in your browser sandbox with zero remote telemetry, tracking, or data collection.
- **Zero Credential Transmission**: Never collects, stores, or transmits your Google account credentials, cookies, or conversation contents.

For our full policy, see [PRIVACY_POLICY.md](./PRIVACY_POLICY.md).

---

## 📄 Open Source License

This project is licensed under the **[MIT License](./LICENSE)**.

Third-party open-source components used in this project:
- **[JSZip](https://stuk.github.io/jszip/)** (v3.10.1) - Dual-licensed under MIT / GPLv3. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for details.

---

## 📌 Known Issues & Limitations

- **Google Gemini API Sliding Window Ceiling (~600–650 Conversations)**:
  - **Symptom**: For accounts with a large number of conversations, full sync typically stops after retrieving approximately 600–650 conversations, unable to paginate further into older history;
  - **Root Cause (Google API Defect)**: In-depth reverse engineering shows that Google Gemini's web conversation listing RPC (`MaZiqc`) uses an accumulative stateless cursor. The continuation token accumulates ~14 bytes of traversal state per conversation. Upon reaching ~650 conversations, the token size hits Google's ~9KB server-side API gateway parameter limit, causing Google to abort with `BardErrorInfo 1096` (**Note: even on the official `gemini.google.com` interface, manually scrolling down the sidebar will crash the page at the same threshold**);
  - **Recommendation**: The extension features **real-time streaming persistence**, an **automated Takeout Limit guidance modal**, and a **Stop Sync** button to ensure all retrieved conversations are safely saved. We recommend using **"Sync Latest"** for regular incremental backups, and using Google Takeout for comprehensive archiving of older history.

---

## ⚠️ Disclaimer

- **Gemini Exporter** is an independent, open-source personal data archiving tool maintained by individual developers. It is **not affiliated with, sponsored by, or endorsed by Google LLC or Google Gemini**.
- "Google" and "Gemini" are registered trademarks of Google LLC.
- This project is intended for personal data backup, study, and research purposes only. Users are solely responsible for ensuring compliance with applicable terms of service.
