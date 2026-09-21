# Chrome Web Store Publication & Permissions Justification

This document tracks and maintains all required metadata, permissions justification, and privacy declarations for submitting **Gemini Exporter** to the Chrome Web Store.

---

## 📋 General Information

- **Extension Name**: Gemini Exporter
- **Summary / Short Description**: Open-source & private: bulk export Google Gemini chats & Takeout archives to Markdown, JSON or ZIP with images. 100% client-side.
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
| **`storage`** | Stores user configuration settings (selected export format, toggle states) and local conversation index metadata (`gemini_conversations`, `exportedIds`) to enable fast incremental sync across sessions without re-querying all conversations. |
| **`unlimitedStorage`** | Required to persist conversation lists and metadata indexes for power users who have hundreds or thousands of Gemini conversations in their local browser sandbox. |

---

## 🌐 Host Permissions Justification

| Host Pattern | Justification / Usage |
| :--- | :--- |
| **`https://gemini.google.com/*`** | Core target host. Required to inspect the conversation DOM, establish messaging with Gemini web app, and synchronize user-initiated chat exports. |
| **`https://*.googleusercontent.com/*`** | Required to fetch user-uploaded attachments (PDFs, docs) and AI-generated image blobs displayed within conversation turns for offline packaging. |

---

## 🛡️ Privacy & Compliance Declarations

- **100% Client-Side Execution**: All parsing, image bundling, Markdown generation, and ZIP compression occur purely within the local browser sandbox.
- **No Remote Telemetry**: Zero analytics, zero third-party tracking, zero external servers.
- **No Credential Harvesting**: Never reads, stores, or transmits Google account passwords or authentication Cookies.

---

## 🏷️ Title & Promotional Assets Policy Compliance (Red Nickel Prevention)

In compliance with Chrome Web Store Developer Program Policies (*Ensuring Responsible Marketing and Monetization - Impersonation and Intellectual Property*):
- **No Ranking or Status Claims**: The extension name, description, and promotional assets (`store_assets/promo_marquee_1400x560.png`, `store_assets/promo_tile_440x280.png`) must NEVER contain promotional buzzwords, ranking claims, or deceptive status indicators such as `Free`, `100% Free`, `#1`, `Best`, `Top`, `New`, `Recommended`, or `Premium`.
- **Factual & Feature-Oriented**: Titles and descriptions focus strictly on factual functionality (e.g., `Bulk Export All Chats`, `Client-Side • Unlimited • Offline`).

