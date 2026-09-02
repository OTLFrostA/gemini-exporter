# 🌌 Gemini Exporter

<p align="left">
  <b>English</b> | <a href="./README_zh.md">简体中文</a>
</p>

<p align="left">
  <a href="https://chromewebstore.google.com/detail/gemini-exporter/ldpbiafkgjlaooeplkiooljccpalpkgf?utm_source=github&utm_medium=readme&utm_campaign=github_repo" target="_blank">
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
- 📦 **Multiple Export Formats**:
  - **Markdown (`.md`)**: Beautiful formatting, syntax-highlighted code blocks, math equations, collapsible thinking details (`<details>`), and web citations.
  - **JSON (OpenAI Format)**: Ready-to-use format for LLM fine-tuning pipelines and third-party tools.
  - **JSON (Raw / Complete Metadata)**: Complete structured payload containing raw timestamps and conversation metadata.
- 🖼️ **Full Support for Attachments & High-Res Images**:
  - Automatically detects and downloads user-uploaded files (PDFs, DOCX, ZIPs, etc.) and AI-generated high-resolution images across all conversation turns.
  - Assets are neatly organized into an `assets/` subfolder with relative references preserved in Markdown.
- ⚡ **High-Concurrency Streaming & Interruption Recovery**:
  - Sliding window worker pool for ultra-fast concurrent downloads with real-time fluid progress tracking.
  - **Crash & Interruption Recovery Banner**: Automatically detects unfinished export sessions and offers 1-click resumption.
- 👥 **Multi-Account Switching Support**:
  - Seamlessly switch between multiple logged-in Google accounts (`u0`, `u1`, `u2`, etc.) with independent local storage, conversation lists, and export tracking per account.
- 📥 **Google Takeout Integration & Legacy Chat Recovery (Takeout ZIP Import)**:
  - Directly load your Google Takeout archive (`takeout-*.zip`) to recover legacy conversations truncated by Gemini's cloud UI pagination limits.
  - **Offline Media Fallback Pool**: Automatically indexes offline media from the ZIP, seamlessly replacing any failed online asset downloads (e.g., due to expired tokens or 403 errors).
- 🏷️ **Multi-Tier Title Arbitration (`TITLE_SOURCE_PRIORITY`)**:
  - Smart title resolution hierarchy (RPC > DOM > Takeout > Sniff > Legacy) preventing brand name pollution ("Google Gemini") and preserving genuine conversation titles.
- 🔄 **Smart Incremental Sync & Change Detection**:
  - Locally records conversation IDs, update timestamps, and message counts.
  - Supports "Skip already exported" mode. When an existing conversation receives new replies, it is automatically flagged as "Needs Re-export" for ultra-fast incremental backups.
- ⚡ **Zero-Configuration Ready**:
  - No official Gemini API key required. No account passwords exposed. Simply browse Google Gemini as usual, and session state is automatically detected.

---

## 📥 Installation

Compatible with all modern Chromium-based browsers (**Google Chrome**, **Microsoft Edge**, **Brave**, **Arc**, **Vivaldi**, etc.).

### Method 1: Install from Chrome Web Store (Recommended)

Install directly from the official Chrome Web Store with one click:

👉 **[Get Gemini Exporter on Chrome Web Store](https://chromewebstore.google.com/detail/gemini-exporter/ldpbiafkgjlaooeplkiooljccpalpkgf?utm_source=github&utm_medium=readme&utm_campaign=github_repo)**

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
2. In the Workbench:
   - Click **"Sync Latest"** for fast incremental sync, or **"Deep Scan"** to gather your entire chat history.
   - Select the conversations you want to export (supports *Select All*, *Unexported Only*, *Updated Only*, and real-time search).
   - Configure options: download assets, package as ZIP, custom folder, etc.
   - Click **"Export Selected → ZIP"** (or Folder) to archive your chats.

### 3. Google Takeout Import & Legacy Chat Recovery
For heavy users with thousands of conversations, Google's web interface enforces a sliding window ceiling (~600–650 chats). You can recover and archive your complete legacy history using official Google Takeout:
1. Visit **[Google Takeout](https://takeout.google.com)**, deselect all, and check only **Gemini**. Create and download the exported `takeout-*.zip` archive.
2. Open the Gemini Exporter **Workbench (Options)**, navigate to the **"Google Takeout Import"** section, and select or drag-and-drop the ZIP file.
3. The extension instantly parses all prompt histories and conversation indexes completely inside your browser's local sandbox.
4. **Offline Media Fallback Pool**: If cloud assets encounter 403 or expired token errors during export, the extension automatically retrieves the original images and attachments from the Takeout archive, ensuring 100% complete backups.

---

## 🛡️ Architecture & Layered Design

The extension follows a clean, decoupled layered architecture with zero external telemetry:

```
src/core/                 Pure logic layer (no DOM dependencies)
  ├── constants.js        Allowed formats, storage keys, default constants
  ├── formatStore.js      Format normalization & validation
  ├── tabService.js       Centralized Gemini Tab discovery & communication
  └── exporter/
      ├── zipWriter.js    JSZip stream packaging writer
      └── fsWriter.js     FileSystem Access API writer & dirHandle directory builder

src/ui/                   Workbench UI Layer (Decoupled Views & Controllers)
  ├── state/
  │   └── conversationsStore.js   Multi-account storage & signature tracking
  ├── views/
  │   ├── listView.js             Conversation table rendering & selection
  │   ├── logView.js              Real-time log buffer & filtering
  │   ├── accountView.js          Account slot dropdown rendering
  │   └── dialogView.js           Interruption recovery banner & dialogs
  └── controllers/
      ├── exportController.js     Export pipeline orchestration
      ├── syncController.js       Incremental & full sync management
      ├── takeoutController.js    Takeout ZIP import & chat merging
      └── dirHandleController.js  FileSystem Access API IndexedDB persistence

Content & Core Engine
  ├── utils.js            Single source of truth for string sanitization & title resolution
  ├── gemini_parser.js    Pure batchexecute RPC response parser
  ├── gemini_client.js    Gemini batchexecute API network client
  ├── takeout_engine.js   Takeout ZIP parsing & offline media matching
  ├── export_engine.js    High-concurrency batch export pipeline
  └── storage_service.js  Chrome storage multi-slot persistence
```

- **Credential Interception**: Intercepts the anti-CSRF token (`at`) and session identifier (`f.sid`) from native network requests in the MAIN world, avoiding raw Cookie exposure.
- **Local Packaging**: All chat content and binary images are compressed and saved directly in the browser via JSZip and modern web APIs, requiring zero excessive browser permissions.

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
  - **Recommendation**: The extension features **real-time streaming persistence** and a **Stop Sync** button to ensure all retrieved conversations are safely saved. We recommend using **"Sync Latest"** for regular incremental backups, and using Google Takeout for comprehensive archiving of older history.

---

## ⚠️ Disclaimer

- **Gemini Exporter** is an independent, open-source personal data archiving tool maintained by individual developers. It is **not affiliated with, sponsored by, or endorsed by Google LLC or Google Gemini**.
- "Google" and "Gemini" are registered trademarks of Google LLC.
- This project is intended for personal data backup, study, and research purposes only. Users are solely responsible for ensuring compliance with applicable terms of service.
