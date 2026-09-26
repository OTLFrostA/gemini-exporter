# Chrome Web Store 隐私说明（草案 / DRAFT）

> **状态：DRAFT —— 待用户确认后才能用于商店上架。本文件不是最终发布文案。**
>
> - 现有 `docs/PRIVACY_POLICY.md`（2026-08）写于 PDF 导出功能之前，上架前需与本草案对齐合并。
> - "零外部请求"声明以 D8-B 的实测证据为准（本草案写作时 D8-B 仍在进行中）。

<p align="left">
<b>English</b> | <a href="#chrome-网上应用店隐私说明草案">简体中文</a>
</p>

---

## Privacy disclosure draft (for the Chrome Web Store listing)

**What Gemini Exporter does.** Gemini Exporter is a single-purpose, open-source browser extension: it exports your own Google Gemini conversation history into local files on your computer (Markdown, JSON, TXT, PDF, or ZIP archives).

**What data the extension handles.**
- Your Gemini conversation content (messages, timestamps) — read from the Gemini page you already have open, only when you start an export.
- Attachments referenced by those conversations: images you uploaded, AI-generated images, and attached files — downloaded to your machine as part of the export you requested.
- Local preferences: export format, ZIP toggle, language, and a local index of already-exported conversations (to skip duplicates).

**Where your data goes: nowhere.** All parsing, rendering, PDF compilation, and ZIP packaging happen locally in your browser.
- The PDF engine (Typst) runs as WebAssembly inside a local, sandboxed extension page. Your conversation text is passed to it as structured data — it is never sent anywhere.
- No external network requests: *[待 D8-B 实测证据确认后改写为最终表述：扩展在导出全流程中不发起任何外部网络请求。]*
- We do not operate any server. We do not collect, upload, sell, or analyze your conversations, attachments, account information, or credentials.

**Fonts and PDF export.** To render CJK text in PDFs, the extension may ask your permission to read the *names/metadata of fonts already installed on your device* (the browser's Local Font Access API). This is used only to pick a local font for rendering; font files and your data never leave your machine. A small bundled math font (`NewCMMath-Regular.otf`, GUST Font License) ships with the extension so math formulas render without depending on host fonts.

**Permissions and why they are needed.**

| Permission | Purpose |
|---|---|
| `storage` / `unlimitedStorage` | Save your export preferences and the local already-exported index. |
| Host access to `gemini.google.com`, `*.googleusercontent.com`, `drive.google.com`, `lh3.google.com` | Read your conversation list/content and download attachments you choose to export. |

**Third-party components.** This extension bundles: Typst compiler WebAssembly + JS glue (`@myriaddreamin/typst.ts` ecosystem, Apache-2.0), JSZip (MIT/GPLv3), and the NewCMMath font (GUST Font License). Full notices: `THIRD_PARTY_NOTICES.md` in the repository.

**Open source.** The full source code is public at <https://github.com/OTLFrostA/gemini-exporter> — anyone can verify these claims.

**Contact.** Questions: <https://github.com/OTLFrostA/gemini-exporter/issues>

---

<h2 id="chrome-网上应用店隐私说明草案">Chrome 网上应用店隐私说明（草案）</h2>

**本扩展的作用。** Gemini Exporter 是单一用途的开源浏览器扩展：把你自己的 Google Gemini 对话历史导出为本机文件（Markdown、JSON、TXT、PDF 或 ZIP 压缩包）。

**扩展会处理哪些数据。**
- 你的 Gemini 对话内容（消息、时间戳）——仅在你主动发起导出时，从你已打开的 Gemini 页面读取。
- 对话关联的附件：你上传的图片、AI 生成的图片、附加文件——作为你要求的导出的一部分下载到本机。
- 本地偏好：导出格式、ZIP 开关、语言、已导出对话的本地索引（用于增量跳过）。

**数据去向：哪儿也不去。** 解析、渲染、PDF 编译、ZIP 打包全部在本机浏览器内完成。
- PDF 引擎（Typst）以 WebAssembly 形式运行在本地沙箱扩展页面中；对话文本以结构化数据传入，不发送到任何地方。
- 零外部请求：*[待 D8-B 实测证据确认后改写为最终表述：扩展在导出全流程中不发起任何外部网络请求。]*
- 我们不运营任何服务器；不收集、不上传、不出售、不分析你的对话、附件、账号信息或凭证。

**字体与 PDF 导出。** 为在 PDF 中渲染中文，扩展可能会请求读取*你设备上已安装字体的名称/元数据*（浏览器的 Local Font Access API），仅用于挑选本地字体参与渲染；字体文件和你的数据不会离开本机。扩展自带一个小型数学字体（`NewCMMath-Regular.otf`，GUST Font License），保证公式渲染不依赖宿主字体。

**权限与用途。**

| 权限 | 用途 |
|---|---|
| `storage` / `unlimitedStorage` | 保存导出偏好与已导出的本地索引。 |
| 主机权限 `gemini.google.com`、`*.googleusercontent.com`、`drive.google.com`、`lh3.google.com` | 读取对话列表/内容、下载你要导出的附件。 |

**第三方组件。** 本扩展捆绑：Typst 编译器 WebAssembly + JS 胶水（`@myriaddreamin/typst.ts` 生态，Apache-2.0）、JSZip（MIT/GPLv3）、NewCMMath 字体（GUST Font License）。完整声明见仓库 `THIRD_PARTY_NOTICES.md`。

**开源。** 完整源码公开：<https://github.com/OTLFrostA/gemini-exporter>，任何人可验证以上声明。

**联系方式。** 问题反馈：<https://github.com/OTLFrostA/gemini-exporter/issues>

---

## 上架前 checklist（给发布者）

- [] D8-B 的 0 外部请求实测证据落定后，把两处改写为最终表述
- [] 与 `docs/PRIVACY_POLICY.md` 合并为一份对外隐私政策（或确认商店列表直接引用它）
- [] 用户确认本草案措辞（尤其是字体读取与 PDF 本地编译的描述）
