# 🌌 Gemini Exporter - Save All Your Chats

<p align="left">
  <a href="./README.md">English</a> | <b>简体中文</b>
</p>

<p align="left">
  <a href="https://chromewebstore.google.com/detail/gemini-exporter/ldpbiafkgjlaooeplkiooljccpalpkgf?utm_source=github&utm_medium=readme_zh&utm_campaign=github_repo">
    <img src="https://img.shields.io/badge/Chrome%20%E5%BA%94%E7%94%A8%E5%95%86%E5%BA%97-Gemini%20Exporter-blue?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome 应用商店">
  </a>
  <img src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-2.0.0-orange.svg?style=for-the-badge" alt="版本: 2.0.0">
  <img src="https://img.shields.io/badge/%E5%BC%80%E6%BA%90%E5%8D%8F%E8%AE%AE-MIT-green.svg?style=for-the-badge" alt="开源协议: MIT">
</p>

![Chrome 应用商店累计安装量](https://raw.githubusercontent.com/OTLFrostA/gemini-exporter/stats/stats/install-growth.svg)

> **你的 AI 对话，值得自己保存。** Gemini Exporter 是一款**免费、开源、注重隐私**的 Chrome 扩展，让你把 Google Gemini 对话保存为自己掌控的文件。既可导出当前对话，也能批量备份历史记录、持续保存 Markdown 笔记，并导入 Google Takeout 历史归档。

**无需注册账号、API Key、云备份服务；没有遥测或追踪。** 导出处理和文件存储在本地完成；读取 Gemini 对话时使用浏览器里现有的登录会话。

## ✨ 主要功能

- **单篇与批量导出**：从弹出窗口一键导出当前对话，或在工作台扫描、搜索、选择并批量导出。
- **四种格式**：Markdown（`.md`）、HTML（`.html`）、PDF（`.pdf`）和结构化 JSON（`.json`）。
- **两种保存方式**：使用**浏览器下载**，或直接**保存到本地文件夹**。浏览器下载涉及多个文件时会**自动打包为 ZIP**；ZIP 不再是需要单独选择的导出格式。
- **Markdown 实时保存**：Gemini 回复完成后，可自动更新已授权文件夹中的对应 Markdown 笔记。
- **增量扫描与跳过已导出**：扫描当前账号在 Gemini 端可访问的历史；只有上次完整导出、格式一致且已知来源未更新，才会跳过。
- **Google Takeout 导入**：直接导入原始 Takeout ZIP，补全网页版可访问历史之外的旧对话与可用的离线资源。
- **图片与附件归档**：尽可能保存可获取的图片、生成图、上传文件和来源引用；对缺失、失效资源明确提示。
- **日常使用体验**：中英双语、亮色/暗色主题、新手引导、导出状态、失败重试与诊断功能。

## 📄 导出格式与文件

| 格式 | 适用场景 | 说明 |
| --- | --- | --- |
| **Markdown**（`.md`） | Obsidian、Logseq、个人笔记和纯文本备份 | 可读文本，可引用导出的本地附件 |
| **HTML**（`.html`） | 离线用浏览器阅读对话 | Gemini 风格排版、数学公式及亮/暗主题；媒体资源可能单独存放 |
| **PDF**（`.pdf`） | 阅读、分享、长期文档归档 | 使用本地 Typst/WASM 生成；中日韩文字可能需要浏览器授权读取本机字体信息 |
| **JSON**（`.json`） | 结构化备份和后续程序处理 | 机器可读取的对话数据 |

实际文件结构取决于对话里的可用资源。例如，包含图片的 Markdown/HTML 可能附带 `assets/` 和 `files/`。浏览器下载产生多个文件时会自动 ZIP 打包；**保存到本地文件夹**则直接写入各个文件，不经过浏览器下载的 ZIP 步骤。

## 📥 安装

**[前往 Chrome 应用商店安装 Gemini Exporter](https://chromewebstore.google.com/detail/gemini-exporter/ldpbiafkgjlaooeplkiooljccpalpkgf?utm_source=github&utm_medium=readme_zh&utm_campaign=github_repo)**

也可以在 Chromium 系浏览器中通过源码安装：

```bash
git clone https://github.com/OTLFrostA/gemini-exporter.git
cd gemini-exporter
npm install
npm run build
```

打开 `chrome://extensions/`（或浏览器的扩展管理页面），开启**开发者模式**，选择**加载已解压的扩展程序**，选中仓库目录。直接写入文件夹的能力依赖浏览器对 File System Access API 的支持。

## 🚀 使用指南

### 导出当前对话

1. 登录并打开 [Google Gemini](https://gemini.google.com) 中的一篇对话。
2. 点击 Gemini Exporter 图标，选择 **Markdown**、**PDF**、**HTML** 或 **JSON**。
3. 点击**导出当前对话**。弹出窗口的单篇导出使用浏览器下载。

### 批量备份对话

1. 在插件弹出窗口进入**工作台**。
2. 点击**同步会话**，发现 Gemini 当前可访问的历史。注意：**扫描不等于文件已经备份完成**。
3. 搜索或筛选列表，勾选要导出的对话。
4. 选择**格式**和两种可见保存方式之一：**浏览器下载**或**保存到本地文件夹**。
5. 按需保留**跳过已导出**，再点击**导出选中**。

大量导出时更建议使用**保存到本地文件夹**：浏览器下载遇到多文件需要在内存中打包 ZIP。使用本地文件夹之前，需要先选择目录并授权。

### 开启 Markdown 实时保存

1. 在工作台选择**保存到本地文件夹**，点击**选择文件夹**并授权。
2. 将导出格式设为 **Markdown (.md)**。
3. 在文件夹卡片内打开**实时保存**。
4. 正常使用 Gemini；回复完成后可以自动更新对应的本地 Markdown 归档。

**注意：** 实时保存只在**Markdown + 保存到本地文件夹 + 目录授权有效**时生效。切换到浏览器下载或其他格式会暂停实时保存，但不会清除开启偏好。浏览器重启后如提示目录权限失效，请重新授权。

### 使用 Google Takeout 补全历史

1. 从 [Google Takeout](https://takeout.google.com/settings/takeout/custom/gemini) 下载 Gemini 归档。
2. 在工作台选定要归属的账号，点击**导入 Takeout**，选择**原始 ZIP**（无需手动解压）。
3. 插件将支持的历史会话合入本地归档；之后可在列表中选择并导出。

Takeout 用于补充在线扫描。无论网页扫描还是 Takeout，都不能保证恢复来源已经不再提供的过期附件。

## 🔄 扫描、导出与状态有什么区别？

- **同步会话**更新 Gemini 当前可访问的会话索引；新一轮扫描没看到的旧对话，不会因此从本地已保存的档案中自动删除。
- **导出选中**才会产生实际备份文件。工作台会呈现成功、有更新、失败及附件异常等状态，方便判断是否需要重新导出。
- **跳过已导出**仅对最近一次完整导出、格式一致且已知来源没有更新的会话生效；可以结合列表筛选与状态查看需要处理的记录。

## 🔒 隐私与功能边界

Gemini Exporter **没有开发者运营的云端备份账户**，也不会将用户对话上传到开发者服务器。扩展通过当前浏览器登录会话读取 Gemini 数据，在本机处理和导出。按需获取对话或附件时，仍然可能访问 Google 的服务。

当前版本实际支持的导出来源是 **Google Gemini**。底层架构预留了其他 AI 平台的空间，但**目前并不支持直接导出 ChatGPT、Claude 或 Grok**。本地备份仍需要你自行做好异地或其他设备备份，才能防范设备损坏和丢失。

具体说明见[隐私政策](./docs/PRIVACY_POLICY.md)。

## 🧩 v2 架构概览

当前版本将平台数据获取、可信会话事实、文档结构生成、格式渲染和文件交付分开：

| 模块 | 职责 |
| --- | --- |
| **L1** | Gemini 客户端、解析器、页面数据捕获、Takeout 导入、附件获取 |
| **L2** | 可信会话/账号领域、索引与详情、扫描覆盖范围 |
| **L3a** | 本地持久化、设置、文件夹句柄 |
| **L3b** | 文档 AST 与结构组合 |
| **L4** | Markdown/HTML/JSON/PDF 渲染、打包和文件交付 |
| **Application / Runtime / UI** | 扫描与导出工作流、浏览器协调、弹窗与工作台 |

最新模块职责以 [src/README.md](./src/README.md) 为准；部分旧架构文档可能还描述之前的版本。

## 🧪 开发与测试

```bash
npm install
npm run build                  # 构建扩展
npm test                       # 类型检查、单测、构建与无头 E2E
npm run test:v2:unit-ports      # v2 模块接口检查
npm run test:v2:unit-isolation  # v2 单测隔离检查
```

带真实账号的测试需要单独配置：`npm run test:tier2` 使用调试版 Chrome 和已登录的 Gemini 会话；Tier 3 用于自主视觉质检。详细操作与边界见 [tests/README.md](./tests/README.md)。

## ❓ 常见问题

**需要 API Key 或 Gemini 付费订阅吗？** 不需要。直接使用现有的 Gemini 登录会话；能读取多少历史取决于账号与 Gemini 当前提供的数据范围。

**点“同步会话”就备份好全部聊天了吗？** 不是。同步只负责发现或更新本地会话目录；需要勾选并执行导出，才会生成备份文件。

**ZIP 选项去哪里了？** v2 已取消独立的 ZIP 格式选项。浏览器下载涉及多个文件时自动 ZIP；保存到本地文件夹则直接落盘。

**实时保存可以输出 PDF 或 HTML 吗？** 目前不可以。实时保存仅支持 Markdown 和已授权的本地文件夹，切换到其他格式或浏览器下载会暂停。

**附件过期怎么办？** 导出状态可能会提示附件缺失或链接过期。如果 Gemini 来源已无法提供该文件，插件也无法凭空还原。

## 📜 开源协议与免责声明

本项目使用 [MIT License](./LICENSE) 开源。Gemini Exporter 是独立开发的开源工具，**与 Google 不存在隶属、赞助或背书关系**。Google 和 Gemini 为 Google LLC 的商标。
