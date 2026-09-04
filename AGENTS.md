# AI 助手与自动化协作指南 (AI Agent Guide & Rules)

本文件为所有协助开发与维护本项目（Gemini Exporter）的 AI Agent（包括 Antigravity、Claude Code、Cursor、Copilot、Codex 等）提供统一规范与操作准则。

---

## 一、核心工作流原则 (Core Principles)

1. **本地核心代码永远保持 main 的最新状态**：
   - 本地仓库主目录（Core Repo）始终停留在 `main` 分支并保持与远端最新状态同步。
   - 严禁在本地主目录的 `main` 分支上直接修改、提交或开发业务代码。

2. **使用 Git Worktree 进行功能迭代**：
   - 所有的功能开发、Bug 修复、重构与测试，必须基于 `main` 通过 `git worktree` 创建一个干净的独立工作副本和对应的新分支（如 `feature/...`、`fix/...`、`docs/...`）。
   - 在 worktree 中进行编码、测试与本地提交。

3. **严禁直接 Push 到 main，必须通过 PR 流程合并**：
   - **绝对禁止直接 push 到 `main` 分支**。
   - 开发与测试验证完成后，必须将特性分支推送到远程仓库，并通过 GitHub CLI (`gh pr create --base main`) 创建 Pull Request。
   - 待 CI 自动化校验通过并合并完成后，清理本地 worktree 副本与临时分支，并在主目录执行 `git pull --ff-only` 保持同步。

---

## 二、双层测试体系规范 (Two-Tier Testing Architecture)

本项目严格区分并建立了双层测试体系，任何 AI 在提交代码或宣称功能完成前，必须严格依照下述标准执行验证：

### 第一层：CI 自动化门禁测试 (Tier 1: Fast & Headless)
* **执行命令**：`npm test`（或 `python3 tests/run_tests.py && npx playwright test`）。
* **适用场景**：每次提交 PR 前在本地 worktree 中必须全绿通过，GitHub Actions 门禁对此强制校验。
* **特性**：轻量极速（~18 秒完成），包含 22 个单元测试套件与 14 个无头 Playwright 端到端用例，完全自包含，不依赖外网与真实 Google 账号。

### 第二层：真实调试 Chrome 全流程实跑测试 (Tier 2: Live Debug Staging)
* **执行命令**：`npm run test:live`（对应 `python3 scripts/test_live_chat_and_export.py`）。
* **适用场景**：修改了 Protobuf/JSPB 解析引擎、Google Takeout 导入逻辑、会话排序、网络请求拦截或发布新版本前。
* **环境准备**：需先通过 `./scripts/open_test_chrome.sh`（Windows 环境运行 `.\scripts\open_test_chrome.ps1` 或 `.\scripts\open_test_chrome.cmd`）启动开启 9222 调试端口的独立 Chrome 并登录测试账号。
* **AI 自动化执行铁律**：
  1. **必须生成真实对话（严禁滥用 `--skip-chat`）**：
     除非经用户明确许可进行纯离线单测调试，否则全流程测试必须**动态生成至少 2 个全新的技术主题，每个会话至少 5 轮递进式问答**，通过 CDP 真实驱动 Gemini 并等待全部流式回复落地。
  2. **必须实际检验导出 Markdown 文件内容（严禁仅凭内存判断）**：
     测试脚本会自动将导出的 ZIP 下载到磁盘并解压，必须逐字核对全部 5 轮提问与回答在 Markdown 文件中物理存在。
  3. **必须校验 Google Takeout 离线导入与合流**：
     测试流会自动读取预置的 `tests/fixtures/gemini_takeout_clean.zip`，检验离线图片附件池索引与线上活跃会话的合流去重。
  4. **必须通过全量导出规范断言**：
     解压目录必须通过 `tests/helpers/export_spec_asserter.py` 的 6 大维度检验：
     - `00_INDEX.md` 与 `meta.json` 索引文件合法；
     - YAML Frontmatter 7 个标准键必须全部闭合；
     - 角色标记 `## 👤 你` 与 `## 🤖 Gemini` 规范交替并附带时间戳；
     - **0 遥测噪点**：绝对无 Google JSPB 遥测单字（`google`, `c`, `S`, `6`, `.`），回答末尾绝无 `zh`/`en` 语言标记；
     - 图片附件在导出包中物理存在（非空）；
     - 黄金会话特征（Python 装饰器代码块、火星猫图片等）全部命中。

---

## 三、常用辅助命令速查

```bash
# 启动独立调试环境 Chrome (端口 9222)
./scripts/open_test_chrome.sh          # macOS / Linux
.\scripts\open_test_chrome.ps1         # Windows PowerShell
.\scripts\open_test_chrome.cmd         # Windows CMD

# 运行全量实跑测试 (发帖 2次×5轮 + 导入 Takeout + 导出 + 规范断言)
npm run test:live

# 纯导出与断言验证 (跳过发帖，仅检验已有数据与 Takeout)
python3 scripts/test_live_chat_and_export.py --skip-chat

# 单独对任意导出解压目录运行规范断言器
python3 tests/helpers/export_spec_asserter.py <解压目录路径>
```
