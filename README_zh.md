# 🌌 Gemini Exporter

<p align="left">
  <a href="./README.md">English</a> | <b>简体中文</b>
</p>

<p align="left">
  <a href="https://chromewebstore.google.com/detail/gemini-exporter/ldpbiafkgjlaooeplkiooljccpalpkgf?utm_source=github&utm_medium=readme_zh&utm_campaign=github_repo" target="_blank">
    <img src="https://img.shields.io/badge/Chrome%20%E5%BA%94%E7%94%A8%E5%95%86%E5%BA%97-Gemini%20Exporter-blue?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome 网上应用店">
  </a>
</p>

> **强大、隐私安全、完全开源的 Google Gemini 对话批量导出与归档 Chrome 扩展。**  
> 一键将你的全部 Gemini 历史对话导出为 Markdown、JSON（支持 OpenAI 格式）或打包为包含图片附件的 ZIP 归档，无缝迁移至 Obsidian、Notion、Logseq 等本地知识库。

---

## 🌟 核心特性 (Features)

- 🔒 **100% 本地运行与隐私零泄露**：
  - 核心逻辑完全在浏览器本地沙箱中执行，**绝不上报任何凭据、Cookie 或对话文本至外部服务器**。
- 📊 **专属批量工作台 (Options Workbench)**：
  - 沉浸式深色模式管理面板，支持查看全部已同步对话列表。
  - 支持按状态过滤：全部、已导出、未导出、有更新待重新导出、失败记录。
  - 完整支持 **中英双语 (Bilingual UI)**，界面右上角可一键切换语言。
- 🧭 **交互式新手引导教程 (Interactive Onboarding Tour)**：
  - 专为初次使用设计的 4 步沉浸式导览。通过翠绿色高对比度状态指示灯与平滑视图滚动，一步步引导完成同步数据、勾选对话、格式设置与一键导出，并支持状态持久化只弹一次。
- 📦 **多格式自由导出**：
  - **Markdown (`.md`)**：完美排版，代码高亮，公式渲染，支持思考过程折叠（`<details>`）与网络参考来源标注。
  - **JSON (OpenAI 格式)**：标准化对话格式，便于将数据直接喂给大模型微调或第三方评测工具。
  - **JSON (原始结构)**：包含完整上下文与会话元数据（可在开发者模式下开启）。
- 🖼️ **完整支持高清晰度图片、深度研究报告与多回合附件下载**：
  - 自动嗅探并下载对话中的用户上传附件（PDF、DOCX、ZIP 等）以及 AI 生成图片（高清晰度源图），严格保障多轮生图的文件名全局唯一。
  - **深度研究报告智能去重**：完美解析 Gemini 2.0 深度研究报告，多轮次间去重挂载完整报告正文，附件不膨胀。
  - 图片与附件自动规整至 `assets/` 资源目录并于 Markdown 中建立相对引用。
- ⚡ **事件驱动异步流水线 (`AsyncQueue`) 与服务保活**：
  - 采用生产-消费者 Promise 通知模型的 `AsyncQueue` 附件下载队列，彻底淘汰 100ms 忙轮询定时器，零延迟且无 CPU 浪费。
  - **MV3 Service Worker 专属心跳保活**：在长耗时批量拉取与全量地毯扫描期间自动派发轻量保活心跳，彻底解决 Chrome MV3 后台在 30 秒无交互后强制挂起 Service Worker 导致任务被杀的痛点。
  - **会话中断自愈横幅**：自动感知未完成的导出任务，支持一键恢复未导出项。
- 👥 **多账号便捷切换与状态强隔离 (Multi-Account)**：
  - 完美支持同时登录多个 Google 账号（`u0`, `u1`, `u2` 等），每个账号插槽独立隔离本地存储、会话索引、Takeout 媒体池与中止控制器（`__bgAborts`）。
- 📥 **Google Takeout 深度联动与远古对话找回 (Takeout ZIP Import)**：
  - 支持直接导入 Google Takeout 导出的 `takeout-*.zip`，利用本地 JSZip 沙盒秒级解析 `MyActivity.html`，找回云端侧边栏分页截断而无法扫到的远古历史对话。
  - **离线媒体智能兜底池**：自动索引 ZIP 内的所有图片与附件，当云端 API 附件下载遇到 Token 过期或 403 时，自动回退到 Takeout 离线池无损补全！
- 🚨 **Google 滑动窗口限制感知与引导弹窗 (Wall Detection Modal)**：
  - 全量扫描触达 Google 服务端游标硬上限（~500–650 条截断或 429 频率受限，`BardErrorInfo 1096`）时，自动触发友好引导弹窗，一键跳转 Google Takeout 导入或导出页面，并具备新手教程级单次免打扰防护。
- 🏷️ **单一数据源权威架构 (SSoT Architecture)**：
  - **权威路径消毒与防穿透 (`sanitizeRelativePath`)**：严格防御跨目录穿越（`..`）与 Windows 保留设备名（`CON`, `PRN`, `AUX`, `NUL` 等），全面统一 ZIP 与本地文件系统写入安全。
  - **多层级权威标题决议 (`TITLE_SOURCE_PRIORITY`)**：智能多源标题判定与优先级防污染机制，彻底剔除 Google Gemini 品牌词干扰，精准保护原始真实标题。
  - **双端确定性排序 (`compareConversations`)**：内容脚本抓取层与工作台视图层 100% 采用同一套基准排序仲裁器，彻底终结会话列表跳动与排序漂移。
- 🔄 **智能增量同步与变更感知**：
  - 本地记录每一个对话的唯一 ID、更新时间与消息总数。
  - 支持“跳过已导出”，当旧对话产生新回复时自动标记为“有更新”，实现极致省时的增量备份。
- ⚡ **无感就绪与凭据自愈**：
  - 无需申请官方 API Key，无需暴露 Google 账号密码；正常浏览 Gemini 页面即可通过主世界沙盒全自动嗅探会话凭据（`at`, `bl`），并在遇到 HTTP 400 异常时自动刷新凭据完成自愈重试。

---

## 📥 安装指南 (Installation)

适用于所有基于 Chromium 内核的现代浏览器（**Google Chrome**, **Microsoft Edge**, **Brave**, **Arc**, **Vivaldi** 等）。

### 方式一：Chrome 网上应用店一键安装（官方推荐）

通过 Chrome 官方商店一键获取最新正式版：

👉 **[前往 Chrome 应用商店安装 Gemini Exporter](https://chromewebstore.google.com/detail/gemini-exporter/ldpbiafkgjlaooeplkiooljccpalpkgf?utm_source=github&utm_medium=readme_zh&utm_campaign=github_repo)**

### 方式二：加载解压扩展（开发者 / 源码安装）

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
3. 选择导出格式（Markdown / JSON），点击 **“只导当前页”** 即可瞬间将当前活跃对话下载至本地。

### 2. 批量导出与增量同步 (Workbench)
1. 在弹窗中点击 **“去工作台选 批量导出”**（或直接右键插件图标选择“选项”）。
2. 初次打开时，可跟随 **“交互式新手引导教程”** 沉浸式熟悉工作台核心操作。
3. 在工作台中：
   - 点击 **“同步最新会话”**（快速增量同步）或 **“全量拉取历史”**（地毯式扫描所有历史），自动汇总左侧所有历史对话。
   - 勾选你需要导出的对话（支持“全选”、“只选未导出”、“只选已更新”，以及搜索栏实时过滤）。
   - 按需配置导出选项：是否下载附件、是否打包为单个 ZIP、目标本地文件夹（通过 FileSystem Access API 直接落盘）等。
   - 点击 **“导出选中 → ZIP”**（或文件夹），静候浏览器自动批量保存文件。

### 3. Google Takeout 历史归档导入与远古对话找回 (Takeout Import)
对于拥有成百上千条历史记录的深度用户，Google 云端界面存在滑动窗口限制（约 600~650 条）。您可以通过官方 Takeout 轻松实现全量远古归档：
1. 前往 **[Google Takeout (Google 导出)](https://takeout.google.com)**，取消全选，仅勾选 **Gemini**，生成并下载 `takeout-*.zip` 压缩包。
2. 打开本插件的 **批量工作台 (Options)**，找到 **“Google Takeout 导入”** 区域，点击选择或直接拖拽 ZIP 归档文件（或在全量同步触碰上限时直接点击弹窗中的“导入 Takeout”）。
3. 扩展将在浏览器本地内存中秒级解析全部历史 Prompt 与会话记录，并自动与本地数据库进行去重合并。
4. **离线媒体智能兜底池**：导出时若云端图片/附件因 Token 过期出现 403 失败，插件将全自动从 Takeout 离线池中调取原图，确保归档 100% 零缺失！

---

## 🛡️ 架构与核心模块 (Architecture & Layered Design)

本插件采用严格的 4 层模块化分层架构，跨 Chrome MV3 边界清晰解耦，零外部遥测与数据上报：

```
src/
  background/                  后台服务工作线程 (Extension Service Worker)
    background.js              MV3 Service Worker、保活心跳与消息路由中心

  content/                     页面注入内容脚本子系统 (Content Script)
    content.js                 页面 DOM 观测、会话同步协调器与浮动 Badge
    content.css                同步状态指示器与悬浮 Badge 样式
    bootstrap.js               页面 Token 初始化与凭据引导
    hookCredentials.js         主世界（MAIN world）安全沙盒网络拦截与凭据提取
    domScraper.js              实时页面 DOM 兜底解析器
    assetFetcher.js            高清晰度媒体与二进制 Blob 流式抓取器

  core/                        纯领域逻辑与解析导出引擎（与 DOM 彻底解耦）
    api/
      geminiClient.js          batchexecute RPC 请求客户端、HTTP 400 凭据自愈与重试
      geminiParser.js          协议反序列化、对话轮次提取、附件与标题决议
    engine/
      exportEngine.js          事件驱动 AsyncQueue 高并发流式导出调度器
      takeoutEngine.js         Google Takeout 归档秒级解析器与多账号离线媒体池
      chatFormatter.js         Markdown、JSON、OpenAI 规范格式化渲染器
      writers/
        zipWriter.js           JSZip 流式打包写入器
        fsWriter.js            FileSystem Access API 目录树落盘写入器
    storage/
      storageService.js        多账号插槽隔离与 chrome.storage 持久化抽象
      formatStore.js           导出格式校验与用户偏好持久化
    utils/
      utils.js                 单一数据源（SSoT）：路径防穿透消毒、标题仲裁、排序比对
      constants.js             枚举常量、格式定义、存储键名
      tabService.js            Gemini 标签页发现、路由与安全通信降级
      i18n.js                  中英双语词典与动态国际化引擎

  ui/                          工作台用户界面子系统 (Workbench UI)
    options/                   批量工作台页面与核心协调器
    popup/                     浏览器右上角快捷弹窗与控制器
    tour/                      交互式新手引导导览组件与高对比度指示灯样式
    state/
      conversationsStore.js    响应式会话数据仓储与多账号状态管理
    views/
      listView.js              高性能虚拟表格渲染与多模式勾选视图
      logView.js               实时诊断日志缓冲与级别过滤视图
      accountView.js           多账号 Slot 切换下拉视图
      dialogView.js            会话中断恢复横幅与引导弹窗组件
    controllers/
      exportController.js      导出任务状态机并发调度门面
      syncController.js        增量同步与全量地毯式扫描调度
      takeoutController.js     Takeout ZIP 解析导入与数据合流调度
      dirHandleController.js   FileSystem Access API IndexedDB 授权持久化
```

### 核心架构铁律
1. **Core 核心层零 DOM 依赖**：核心解析、格式化、路径消毒与排序比对等算法无任何 DOM 依赖，在 Node.js 单测、Web Worker 和扩展页面中行为 100% 绝对一致。
2. **严格的 UI 视图分离**：`state` 负责存储联动与响应式订阅，`views` 负责纯 HTML 视图渲染，`controllers` 封装完整业务编排，`options.js` 仅作为轻量装配门面。
3. **单一数据源（SSoT）**：所有跨目录防穿越路径消毒（`sanitizeRelativePath`）、文件名过滤、会话排序仲裁（`compareConversations`）与标题决议逻辑均收口于 `src/core/utils/utils.js`。
4. **沙盒化凭据通道**：`hookCredentials.js` 在宿主页面主世界运行，内部所有拦截逻辑均被独立沙盒保护，扩展代码任何异常绝不干扰 Google Gemini 原生业务操作。

---

## 🧪 双层测试体系与工程质量保障 (Two-Tier Testing)

本项目建立了严格的双层质量门禁保障体系：

### 第一层：CI 自动化门禁测试 (Tier 1: Fast & Headless)
- **执行命令**：`npm test`（对应 `python tests/run_tests.py && npx playwright test`）
- **覆盖范围**：包含 22 个单元测试套件与 14 个无头 Playwright 端到端用例（约 18 秒极速执行完成），自包含且不依赖外网或真实账号，GitHub Actions 门禁强制全绿拦截。

### 第二层：真实调试 Chrome 全流程实跑测试 (Tier 2: Live Debug Staging)
- **执行命令**：`npm run test:live`（对应 `python scripts/test_live_chat_and_export.py`）
- **适用场景**：调试底层 Protobuf/JSPB 协议解析、Takeout 导入、网络拦截或版本发布前。
- **动态数据集时效门禁**：通过 9222 远程调试端口连接真实 Chrome，并在自动化开发协作中严格执行 2 分钟新鲜度门禁校验，杜绝测试数据老化造假。

---

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
  - **建议**：插件具备**实时流式保存**、**智能触顶感知与引导弹窗**以及**终止同步**功能，拉取到的会话均会安全持久化。建议用户定期使用**“同步最新会话”**功能进行日常增量备份；更久远的历史数据可通过 Google Takeout 进行完整无损补全。

---

## ⚠️ 免责声明 (Disclaimer)

- **Gemini Exporter** 是一个由个人开发者维护的开源个人数据备份与知识归档工具，与 **Google** 或 **Google Gemini** 无任何官方关联、赞助或背书。
- “Google”与“Gemini”是 Google LLC 的商标。
- 本项目仅供个人学习、技术研究及私有数据归档使用，请勿用于任何商业倒卖或违反服务条款的行为。使用者应对其使用行为自行承担全部合规责任。
