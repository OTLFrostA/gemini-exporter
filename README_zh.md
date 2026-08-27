# 🌌 Gemini Exporter - Batch Export Chats (Free)

<p align="left">
  <a href="./README.md">English</a> | <b>简体中文</b>
</p>

<p align="left">
  <a href="https://chromewebstore.google.com/detail/gemini-exporter/ldpbiafkgjlaooeplkiooljccpalpkgf" target="_blank">
    <img src="https://img.shields.io/badge/Chrome%20%E5%BA%94%E7%94%A8%E5%95%86%E5%BA%97-Gemini%20Exporter-blue?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome 网上应用店">
  </a>
</p>

> **强大、隐私安全、完全开源的 Google Gemini 对话批量导出与归档 Chrome 扩展。**  
> 一键将你的全部 Gemini 历史对话导出为 Markdown、JSON（支持 OpenAI 格式）、TXT 或打包为包含图片附件的 ZIP 归档，无缝迁移至 Obsidian、Notion、Logseq 等本地知识库。

---

## 🌟 核心特性 (Features)

- 🔒 **100% 本地运行与隐私零泄露**：
  - 核心逻辑完全在浏览器本地沙箱中执行，**绝不上报任何凭据、Cookie 或对话文本至外部服务器**。
- 📊 **专属批量工作台 (Options Workbench)**：
  - 沉浸式深色模式管理面板，支持查看全部已同步对话列表。
  - 支持按状态过滤：全部、已导出、未导出、有更新待重新导出、失败记录。
  - 完整支持 **中英双语 (Bilingual UI)**，界面右上角可一键切换语言。
- 📦 **多格式自由导出**：
  - **Markdown (`.md`)**：完美排版，代码高亮，公式支持。
  - **JSON**：包含完整上下文与元数据的原生结构。
  - **JSON (OpenAI 格式)**：便于将对话直接喂给微调管道或第三方 LLM 工具。
  - **纯文本 (`.txt`)**：轻量易读。
- 🖼️ **完整支持图片与文件附件下载**：
  - 自动嗅探并下载对话中的用户上传附件（PDF、DOCX、ZIP 等）以及 AI 生成图片（高清晰度源图）。
  - 图片与附件自动规整至 `assets/` 资源目录并于 Markdown 中建立相对引用。
- 🔄 **智能增量同步与变更感知**：
  - 本地记录每一个对话的唯一 ID、更新时间与消息总数。
  - 支持“跳过已导出记录”，当旧对话产生新回复时自动标记为“需要重新导出”，实现极致省时的增量备份。
- ⚡ **无感就绪**：
  - 无需申请官方 API Key，无需暴露 Google 账号密码；正常浏览 Gemini 页面即可全自动嗅探会话态并就绪。

---

## 📥 安装指南 (Installation)

适用于所有基于 Chromium 内核的现代浏览器（**Google Chrome**, **Microsoft Edge**, **Brave**, **Arc**, **Vivaldi** 等）。

### 方式一：加载解压扩展（推荐）

1. 下载或克隆本项目至本地：
   ```bash
   git clone https://github.com/OTLFrostA/gemini-exporter.git
   ```
2. 打开浏览器的扩展管理页面：
   - **Chrome**: 在地址栏输入 `chrome://extensions/`
   - **Edge**: 在地址栏输入 `edge://extensions/`
3. 开启右上角（或左侧）的 **“开发者模式” (Developer mode)**。
4. 点击左上角的 **“加载已解压的扩展程序” (Load unpacked)**。
5. 选择下载或克隆下来的项目文件夹，完成安装。

---

## 🚀 使用指南 (Usage)

### 1. 快速单篇导出 (Popup)
1. 在浏览器中打开并登录 [Google Gemini](https://gemini.google.com)。
2. 点击右上角扩展栏的 **Gemini Exporter** 图标打开弹窗。
3. 选择导出格式（Markdown / JSON / TXT），点击 **“只导当前页”** 即可瞬间将当前活跃对话下载至本地。

### 2. 批量导出与增量同步 (Workbench)
1. 在弹窗中点击 **“去工作台选 批量导出”**（或直接右键插件图标选择“选项”）。
2. 在工作台中：
   - 点击 **“重新 sync”** 或 **“强制从 Gemini 页拉取”**，工作台会自动汇总左侧所有历史对话。
   - 勾选你需要导出的对话（支持“全选”、“只选未导出”、“只选已更新”）。
   - 按需配置导出选项：是否下载图片、是否打包为单个 ZIP、目标子文件夹等。
   - 点击 **“开始批量导出”**，静候浏览器自动批量保存文件。

---

## 🛡️ 架构与安全性 (Architecture & Security)

### 工作原理
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
[ 本地磁盘保存 (Markdown + Assets ZIP) ]
```

- **凭据捕获**：通过主世界（MAIN world）轻量拦截原生网络请求中携带的防 CSRF 标记（`at`）与会话 ID（`f.sid`），规避 Cookie 泄露。
- **本地落盘**：所有对话内容与二进制图片均在本地浏览器中由 JSZip 直接打包下载，不经过任何中转后端。

## 🔒 隐私政策

Gemini Exporter 坚持以隐私安全为核心原则：
- **100% 本地沙箱运行**：所有会话处理、图片下载与压缩均在浏览器本地进行，零外部遥测与追踪。
- **绝不上报凭据**：绝不收集、存储或传输您的 Google 账号信息、Cookie 或对话文本。

详细条款请参阅 [隐私权政策文件 (PRIVACY_POLICY.md)](./PRIVACY_POLICY.md)。

---

## 📄 开源许可证 (License)

本项目遵循 **[MIT License](./LICENSE)** 开源。

本项目使用的第三方开源组件：
- **[JSZip](https://stuk.github.io/jszip/)** (v3.10.1) - Dual-licensed under MIT / GPLv3. 详情请参阅 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

---

## 📌 已知问题与接口限制 (Known Issues & Limitations)

- **Google Gemini 官方会话列表的拉取上限（约 600~650 条）**：
  - **现象**：当用户的 Gemini 账号历史会话超过 600 条时，全量拉取通常会在约 600~650 条处停止，无法继续向更早的历史翻页；
  - **原因定位（Google 接口缺陷）**：经深入协议逆向分析，Google Gemini 网页端的列表接口（`MaZiqc`）采用了无状态累计游标机制，游标 Token 每遍历一条对话会累积约 14 字节的状态信息。当遍历到约 650 条时，Token 长度将达到约 9KB，直接触碰 Google 服务端网关的参数大小上限，被 Google 后端抛出 `BardErrorInfo 1096` 异常强制阻断（**注：即使在 Google Gemini 官方网页上手动滚动侧边栏，滑到底部同样会因此卡死崩溃**）；
  - **建议**：插件支持**实时流式保存**与**终止同步**功能，拉取到的会话均会安全持久化。建议用户定期使用**“同步最新会话”**功能进行日常增量备份；更久远的历史数据可通过 Google Takeout 进行补充归档。

---

## ⚠️ 免责声明 (Disclaimer)

- **Gemini Exporter** 是一个由个人开发者维护的开源个人数据备份与知识归档工具，与 **Google** 或 **Google Gemini** 无任何官方关联、赞助或背书。
- “Google”与“Gemini”是 Google LLC 的商标。
- 本项目仅供个人学习、技术研究及私有数据归档使用，请勿用于任何商业倒卖或违反服务条款的行为。使用者应对其使用行为自行承担全部合规责任。
