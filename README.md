# 🌌 Gemini Exporter

<p align="left">
  <b>English</b> | <a href="./README_zh.md">简体中文</a>
</p>

> **A powerful, privacy-first, fully open-source Chrome extension to batch export and archive your Google Gemini conversations.**  
> Export all your chat history with one click into Markdown, JSON (including OpenAI-compatible format), TXT, or a ZIP bundle with images and attachments. Seamlessly migrate your conversations into Obsidian, Notion, Logseq, and other local personal knowledge bases.

---

## 🌟 Key Features

- 🔒 **100% Client-Side & Zero Privacy Leakage**:
  - All processing runs completely inside your browser's local sandbox. **Never sends credentials, cookies, or chat messages to any third-party server.**
- 📊 **Dedicated Batch Workbench (Options Page)**:
  - An immersive dark-themed dashboard to view, filter, and manage all your synced conversations.
  - Filter chats by status: *All*, *Exported*, *Needs Re-export*, *Unexported*, or *Failed*.
  - Full **Bilingual Support (English / 简体中文)** with a 1-click language switcher in the header.
- 📦 **Multiple Export Formats**:
  - **Markdown (`.md`)**: Beautiful formatting, syntax highlighting for code blocks, and math equations.
  - **JSON**: Native structured format containing complete turn metadata and timestamps.
  - **JSON (OpenAI Format)**: Ready-to-use format for LLM fine-tuning pipelines and third-party tools.
  - **Plain Text (`.txt`)**: Lightweight, clean, and easily readable.
- 🖼️ **Full Support for Attachments & Images**:
  - Automatically detects and downloads user-uploaded files (PDFs, DOCX, ZIPs, etc.) and AI-generated high-resolution images.
  - Assets are neatly organized into an `assets/` subfolder with relative references preserved in Markdown.
- 🔄 **Smart Incremental Sync & Change Detection**:
  - Locally records conversation IDs, update timestamps, and message counts.
  - Supports "Skip already exported" mode. When an existing conversation receives new replies, it is automatically flagged as "Needs Re-export" for ultra-fast incremental backups.
- ⚡ **Zero-Configuration Ready**:
  - No official Gemini API key required. No account passwords exposed. Simply browse Google Gemini as usual, and session state is automatically detected.

---

## 📥 Installation

Compatible with all modern Chromium-based browsers (**Google Chrome**, **Microsoft Edge**, **Brave**, **Arc**, **Vivaldi**, etc.).

### Method 1: Load Unpacked Extension (Recommended)

1. Clone or download this repository to your local machine:
   ```bash
   git clone https://github.com/OTLFrostA/gemini-exporter.git
   ```
2. Open your browser's extension management page:
   - **Chrome**: Navigate to `chrome://extensions/`
   - **Edge**: Navigate to `edge://extensions/`
3. Enable **Developer mode** (toggle in the top-right or sidebar).
4. Click **Load unpacked** in the top-left corner.
5. Select the downloaded/cloned folder to finish installation.

---

## 🚀 Usage Guide

### 1. Quick Single-Chat Export (Popup)
1. Open and sign in to [Google Gemini](https://gemini.google.com).
2. Click the **Gemini Exporter** icon in your browser toolbar to open the popup.
3. Choose your desired format (Markdown / JSON / TXT), and click **"Export Current Page"** to download the active conversation instantly.

### 2. Batch Export & Incremental Sync (Workbench)
1. Click **"Go to Workbench"** in the popup (or right-click the extension icon and select "Options").
2. In the Workbench:
   - Click **"Sync (Incremental)"** or **"Deep Scan Gemini Page"** to gather your chat history.
   - Select the conversations you want to export (supports *Select All*, *Unexported Only*, *Updated Only*).
   - Configure options: download assets, package as ZIP, custom folder, etc.
   - Click **"Export Selected → ZIP"** (or Folder), and let the browser archive your chats.

---

## 🛡️ Architecture & Security

### How It Works
```
[ Gemini Web (gemini.google.com) ]
         │ (Hook Credentials & Session Sniffing)
         ▼
[ Content Script / Bootstrap ]
         │ (Page-Context Safe Messaging)
         ▼
[ Background Service Worker ]
         │ (Native batchexecute RPCs)
         ▼
[ Options Workbench UI / Local Storage / JSZip ]
         │ (File Generation & chrome.downloads)
         ▼
[ Local Disk Save (Markdown + Assets ZIP) ]
```

- **Credential Interception**: Intercepts the anti-CSRF token (`at`) and session identifier (`f.sid`) from native network requests in the MAIN world, avoiding raw Cookie exposure.
- **Local Packaging**: All chat content and binary images are compressed and saved directly in the browser via JSZip, with zero remote relay servers.

---

## 📄 Open Source License

This project is licensed under the **[MIT License](./LICENSE)**.

Third-party open-source components used in this project:
- **[JSZip](https://stuk.github.io/jszip/)** (v3.10.1) - Dual-licensed under MIT / GPLv3. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for details.

---

## ⚠️ Disclaimer

- **Gemini Exporter** is an independent, open-source personal data archiving tool maintained by individual developers. It is **not affiliated with, sponsored by, or endorsed by Google LLC or Google Gemini**.
- "Google" and "Gemini" are registered trademarks of Google LLC.
- This project is intended for personal data backup, study, and research purposes only. Users are solely responsible for ensuring compliance with applicable terms of service.
