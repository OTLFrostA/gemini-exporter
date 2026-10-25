# Chrome Web Store Publication & Permissions Justification

This document tracks and maintains all required metadata, permissions justification, and privacy declarations for submitting **Gemini Exporter** to the Chrome Web Store.

---

## 📋 General Information

- **Extension Name**: Gemini Exporter - Save All Your Chats
- **Chinese Extension Name**: Gemini Exporter - 保存所有对话
- **Summary / Short Description**: 100% Free & open-source • 100% local, no tracking • One-click export all chats • PDF, HTML & Markdown • Hands-off background export
- **Chinese Short Description**: 100% 免费开源 • 100% 本地处理，无追踪 • 一键导出所有对话 • PDF、HTML 与 Markdown • 自动后台导出，无需手动操作
- **Category**: Productivity / Tools
- **Default Language**: English (Supported: English, 简体中文)
- **Manifest Version**: 3
- **Privacy Policy URL**: [PRIVACY_POLICY.md](./PRIVACY_POLICY.md)
- **Support / Repository**: https://github.com/OTLFrostA/gemini-exporter

---

## 🔒 Permissions Justification (Single-Purpose Policy)

Chrome Web Store enforces a strict single-purpose policy requiring explicit justifications for all requested permissions in `manifest.json`:

| Permission | Justification / Usage in Extension |
| :--- | :--- |
| **`storage`** | Stores user configuration settings (selected export format, toggle states) and local conversation records and export history to enable fast incremental sync across sessions without re-querying all conversations. |
| **`scripting`** | Registers and activates source scripts for platforms whose optional site access has been granted. |
| **`activeTab`** | Lets the explicitly opened popup inspect the current tab to identify the conversation to export. |
| **`unlimitedStorage`** | Required to persist conversation lists and metadata indexes for power users who have hundreds or thousands of Gemini conversations in their local browser sandbox. |

---

## 🌐 Host Permissions Justification

All platform hosts are **optional** in the release manifest. Onboarding and
**Site access** request the conversation and attachment sites only for selected
platforms. Already authorized platforms are hidden from the request list;
unchecking a choice does not revoke previously granted access.

| Platform | Optional host patterns | Justification |
| :--- | :--- | :--- |
| **Gemini** | `gemini.google.com`, `*.googleusercontent.com`, `*.usercontent.google.com`, `drive.google.com`, `lh3.google.com`, `*.gstatic.com` | Read requested conversations and retrieve associated images/files directly from Google. |
| **ChatGPT (experimental)** | `chatgpt.com`, `chat.openai.com`, `images.openai.com` | Identify the signed-in account/workspace and retrieve requested conversations and images. |
| **Claude (experimental)** | `claude.ai` | Identify the current organization and retrieve requested conversations and attachments. |
| **Grok (experimental)** | `grok.com`, `assets.grok.com` | Retrieve requested conversations and available attachments using the signed-in Grok tab. |

Use the release `manifest.json` as the authoritative permission list; temporary
required permissions used for local staging must never enter a store package.

---

## 🛡️ Privacy & Compliance Declarations

- **100% Client-Side Execution**: All parsing, image bundling, Markdown generation, and ZIP compression occur purely within the local browser sandbox.
- **No Remote Telemetry**: Zero analytics, zero third-party tracking, zero external servers.
- **No Credential Harvesting**: Never reads, stores, or transmits Google account passwords or authentication Cookies.

---

## Product screenshots

README/store screenshots in `store_assets/` were captured on October 25, 2026
from version 2.0.0 in real Chrome on port 9222, using synced Gemini conversations.
Workbench and Site access images are 1280 × 800; the actual action popup is
360 × 296. The dark image shows local-folder settings before folder authorization,
with Live Save off. Capture Site access before granting optional platform access.

## 🏷️ Title & Promotional Assets Policy Compliance (Red Nickel Prevention)

In compliance with Chrome Web Store Developer Program Policies (*Ensuring Responsible Marketing and Monetization - Impersonation and Intellectual Property*):
- **No Ranking or Status Claims**: The extension name, description, and promotional assets (`store_assets/promo_marquee_1400x560.png`, `store_assets/promo_tile_440x280.png`) must NEVER contain promotional buzzwords, ranking claims, or deceptive status indicators such as `Free`, `100% Free`, `#1`, `Best`, `Top`, `New`, `Recommended`, or `Premium`.
- **Factual & Feature-Oriented**: Titles and descriptions focus strictly on factual functionality (e.g., `Save All Your Chats`, `Client-Side • Unlimited • Offline`).

