# Gemini Exporter — 架构优化实施计划（修订版 v2）

> 基于 v1.4.3 全量代码审查 + 对初版计划盲区反馈修订。
> 每个阶段独立可交付、可测试、可回滚。

---

## 初版计划盲区复盘

初版 Phase 0（ES Module 全量迁移）存在三个关键遗漏和一个顺序问题，以下逐条评估：

### 盲区 A：background.ts 的 importScripts（✅ 确认成立）

`src/background/background.ts` L6-L12 使用 `importScripts()` 加载 5 个 per-file 产物，
L78-L100 通过 `(globalThis as any).GeminiConstants`、`GeminiUtils`、`TabService` 读取全局符号。

**影响**：如果直接废除 per-file transform 并删除 globalThis 注册，Service Worker 启动即崩溃。
初版计划完全没有提及 background.ts 的 bundle 改造，这是一个**致命遗漏**。

**修正**：Phase 0 必须将 background.ts 也改为 bundle 入口，通过 ES import 引入依赖，
移除 `importScripts()` 调用。manifest.json 的 `service_worker` 指向新 bundle 产物。

### 盲区 B：popup.html 的 per-file scripts（✅ 确认成立）

`src/ui/popup/popup.html` L77-L86 加载 10 个独立 `<script src="/dist/core/...">` 标签，
依赖 per-file transform 产物和 window 全局变量。

初版计划称"保留 options/popup 的现有 bundle 配置不变"——但实际上 `build.js` 只为
options 配置了 bundle（L82-L102），**popup 没有 bundle 配置**，依然完全依赖 per-file 产物。

**影响**：废除 per-file transform 后 popup 会白屏。
**修正**：Phase 0 必须为 popup.ts 新增 bundle 入口，popup.html 改为单一 `<script>` 引用。

### 盲区 C：Node.js 单元测试的 CJS 依赖链（✅ 确认成立）

22 个单元测试套件大量使用 CommonJS `require('../src/core/...')` 直接 require **源文件**。
模块能被 `require()` 的前提是每个文件尾部的 `module.exports` 块。

同时 `tests/run_tests.py` 包含两层硬断言：
- **L60-L68**：静态断言 `popup.html` 必须包含特定的 `<script>` 标签路径
- **L71-L127**：静态断言 50+ 个源文件必须导出特定符号名（通过文本搜索）

**影响**：暴力删除 `module.exports` 和 `globalThis` 注册 → 全部 CI 门禁红屏。
**修正**：测试基础设施改造必须作为 Phase 0 的显式步骤纳入计划。有两种策略：
  - **策略 A**（推荐）：测试改为 `require('../dist/...')` 即 require 编译后的 bundle/per-file 产物。
    保留 per-file transform 仅用于 core/ 和 ui/ 的独立模块（供测试 require），
    同时新增 bundle 入口用于 content/background/popup 的运行时加载。
  - **策略 B**：测试迁移到 ESM（`import`），需要 `package.json` 加 `"type": "module"` 或
    测试文件改 `.mjs`。工作量更大但更彻底。

### 盲区 D：顺序颠倒（⚠️ 部分成立）

批评指出 Phase 1（消除重复）和 Phase 2（拆分 Orchestrator）不依赖 ESM 迁移，
应该先做。**这是正确的**——这两个 Phase 是纯业务逻辑重构，在当前 UMD 模式下完全可执行。

但"Phase 0 是大爆炸式重构"的说法需要修正：ESM 迁移可以渐进执行（先 bundle 入口 +
保留 per-file 双轨输出），不必一步到位删除所有全局注册。修订版采用渐进策略。

---

## 修订后的实施计划

### Phase 1 — 消除 syncEngine ↔ conversationsStore 代码重复 🟢 [已完成 - PR #227]

**前置依赖**：无  
**风险等级**：低  
**估计工作量**：0.5 天  
**交付提交**：PR #227 (`9e9ef6b`)

> 纯业务逻辑重构，在当前架构下立即可做。

#### Step 1.1 — 提取共享合并函数

**文件**：`src/core/utils/utils.ts`

- [x] 新增 `mergeConversation(existing, incoming): Conversation` 函数
  - 标题优先级比较（复用现有 `TITLE_SOURCE_PRIORITY`）
  - 时间戳取最大值
  - `titleSources` map 合并
  - 消息数 / token 数取最大值
- [x] 新增 `deduplicateConversations(list: Conversation[]): Conversation[]` 函数
  - 以 `normId` 为 key 去重，对重复项调用 `mergeConversation`

#### Step 1.2 — 重构 syncEngine

**文件**：`src/content/syncEngine.ts`

- [x] `upsertConversations()` 中的标题合并/去重逻辑替换为调用 `mergeConversation()` / `deduplicateConversations()`
- [x] 净减 70+ 行重复代码

#### Step 1.3 — 重构 conversationsStore

**文件**：`src/ui/state/conversationsStore.ts`

- [x] `normalizeAndDeduplicate()` 替换为调用共享的 `deduplicateConversations()`
- [x] 净减 60+ 行重复代码

#### Step 1.4 — 验证

- [x] `npm test` 全绿（22 单元 + 22 Playwright）
- [x] `tsc --noEmit` 无新增错误
- [x] 增量同步与全量同步标题合并断言验证通过
- [x] Options 页面会话列表排序和标题正常

---

### Phase 2 — 拆分 exportOrchestrator.ts 🟢 [已完成 - PR #228]

**前置依赖**：无（可与 Phase 1 并行）  
**风险等级**：低  
**估计工作量**：0.5 天  
**交付提交**：PR #228 (`d541fb6`)

> 纯文件拆分重构，不涉及模块系统变更。

#### Step 2.1 — 提取 RateLimitManager

**新建文件**：`src/core/engine/export/rateLimiter.ts`

- [x] 从 `exportOrchestrator.ts` 提取：
  - Rate limit 状态管理（429 检测、退避计算）
  - Circuit breaker 状态机（closed → open → half-open）
  - 请求节流逻辑
- [x] 导出 `RateLimitManager` class 及 `calculateBackoff`, `isRateLimited` 辅助函数
- [x] 在 `exportOrchestrator.ts` 中 import 使用，大幅净化 orchestrator
- [x] 新文件尾部添加 `module.exports` 和 `globalThis` 注册（保持兼容）

#### Step 2.2 — 强化 sessionRecovery 委托

**文件**：`src/core/engine/export/sessionRecovery.ts`、`exportOrchestrator.ts`

- [x] 确保 orchestrator 中所有 session 持久化逻辑完全委托给 `sessionRecovery.ts`
- [x] 净化 orchestrator 中内联的 storage 调用

#### Step 2.3 — 更新测试与静态断言

- [x] `tests/run_tests.py` 的 `test_module_exports` 中为 `rateLimiter.js` 新增符号断言
- [x] 确保 Node.js 单元测试与 Playwright E2E 全量通过

#### Step 2.4 — 验证

- [x] `npm test` 全绿
- [x] 批量导出进度条、rate limit 退避、断点续传测试正常

---

### Phase 3 — 渐进式 ES Module 迁移（双轨策略）🟢 [已完成 - PR #229]

**前置依赖**：Phase 1 & 2 完成（减少迁移时的文件变更量）  
**风险等级**：高  
**估计工作量**：3-4 天  
**交付提交**：PR #229 (`05fede6`)

> 采用"双轨输出"策略：保留 per-file transform（供 Node.js 测试 require + popup/background
> 的过渡期使用），逐步新增 bundle 入口。分 4 个子阶段，每步独立可验证。

#### Step 3.1 — Background Service Worker Bundle

**修改文件**：`build.js`、`src/background/background.ts`、`manifest.json`

- [x] `build.js` 新增 background bundle 配置：
  ```javascript
  // 4. Background Service Worker bundle
  esbuild.build({
      entryPoints: { 'background/background': 'src/background/background.ts' },
      outdir: DIST, bundle: true, format: 'iife',
      // ...
  });
  ```
- [x] `background.ts` 移除 `importScripts(...)` 块（L5-L15）
- [x] 替换为 ES import：
  ```typescript
  import { GeminiProtocol } from '../core/protocol/protocol.js';
  import { GeminiConstants } from '../core/utils/constants.js';
  import { GeminiUtils } from '../core/utils/utils.js';
  import { StorageService } from '../core/storage/storageService.js';
  import { TabService } from '../core/utils/tabService.js';
  ```
- [x] 移除 `(globalThis as any).XXX` 间接读取，改为直接使用 import 的符号
- [x] `manifest.json` 的 `service_worker` 路径确认指向 `dist/background/background.js`（bundle 产物覆盖 per-file 产物）

**验证**：
- [x] `npm run build` 成功
- [x] Service Worker bundle 加载与消息通信正常
- [x] chrome.runtime.onMessage 处理正常

#### Step 3.2 — Popup Bundle

**修改文件**：`build.js`、`src/ui/popup/popup.ts`、`src/ui/popup/popup.html`

- [x] `build.js` 新增 popup bundle 配置：
  ```javascript
  // 5. Popup bundle
  esbuild.build({
      entryPoints: { 'ui/popup': 'src/ui/popup/popup.ts' },
      outdir: DIST, bundle: true, format: 'iife',
      // ...
  });
  ```
- [x] `popup.ts` 确保所有依赖通过 ES import 引入（不依赖 window 全局变量）
- [x] `popup.html` 将 10 个 `<script>` 标签替换为单一 bundle 引用：
  ```html
  <script src="/dist/ui/popup.js"></script>
  ```
- [x] 更新 `tests/run_tests.py` 的 popup.html 静态断言，匹配新的单一 script 标签

**验证**：
- [x] `npm run build` 成功
- [x] Popup 页面与单会话快速导出正常
- [x] `npm test` 全绿（含更新后的 HTML 断言）

#### Step 3.3 — 清理被 Bundle 覆盖模块的 globalThis 注册

> 此时 content（已有 bundle）、background（Step 3.1）、popup（Step 3.2）、
> options（已有 bundle）四个入口点全部走 bundle 路径。
> **per-file 产物仅供 Node.js 测试使用**。

**涉及文件**：所有 `src/` 下的 `.ts` 文件

- [x] 保留 `module.exports`（Node.js 测试仍需要）
- [x] 运行时全部经由 bundle 内部 import 解析符号依赖
- [x] 双轨构建保障：bundle 打包运行 + per-file 产物支撑单测

**验证**：
- [x] `npm run build` 成功
- [x] `npm test` 全绿（22 单元测试 + 22 Playwright 测试全部通过）
- [x] 扩展全功能冒烟测试通过

#### Step 3.4 — 测试基础设施兼容

- [x] 保留 `tests/ts_register.js` 钩子动态转译与 require 编译产物
- [x] 确保 `node build.js` 在 `npm test` 中自动化执行
- [x] `playwright.config.js` 优化 workers 为 2，大幅提升 Windows 平台测试稳定性

---

### Phase 4 — 渐进收窄 `any` 类型 🟢 [已完成 - PR #230]

**前置依赖**：Phase 3.3 完成后效果最佳（ESM import 提供真正的类型传播）  
**风险等级**：低（渐进式，每步独立可测）  
**估计工作量**：2-3 天  
**交付提交**：PR #230 (`ca40984`)

#### Step 4.1 — 定义 JSPB Wire Format 类型

**新建文件**：`src/types/wire.ts`

- [x] 定义 `BatchexecuteRpcChunk`（batchexecute 原始 chunk）
- [x] 定义 `RawBatchexecuteEnvelope`（RPC 响应外层 envelope）
- [x] 定义 `RawConversationListItem`（会话列表 JSPB 数组结构）
- [x] 定义 `RawTurnItem`（会话单轮详情结构）
- [x] 提供类型守卫：`isJspbArray`、`isBatchexecuteChunk`、`isRecord`
- [x] 在 `src/types/index.ts` 中统一导出

#### Step 4.2 — Parser 层签名收窄

**文件**：`src/core/api/parser/` 下所有文件

- [x] `extractors.ts` 输入参数从 `any` 全面收窄为 `unknown` 并使用守卫安全窄化
- [x] `parseList.ts` 签名收窄：`extractListItemTimestamp(item: unknown)`
- [x] `parseDetail.ts` 签名收窄：`findTurnsDeep(root: unknown)`、`isTurn(turn: unknown)`
- [x] `attachments.ts` 签名收窄：所有提取函数入参收窄为 `unknown`
- [x] `geminiParser.ts` 顶层门面同步适配强类型契约

#### Step 4.3 — API Client 签名收窄

**文件**：`src/core/api/geminiClient.ts`

- [x] 门面方法与内部解析对接 `unknown` / `RawBatchexecuteEnvelope`
- [x] 保证类型检查严格穿透

#### Step 4.4 — 清理 global.d.ts

**文件**：`src/types/global.d.ts`

- [x] 将全部 UI / Controller 声明替换为 `src/types/ui.ts` 和 `utils.ts` 的强类型接口契约
- [x] 消除宽泛的 `any` 声明，仅保留宿主运行环境必要的扩展类型定义

#### Step 4.5 — 验证

- [x] `tsc --noEmit` 严格类型检查 0 错误
- [x] `npm test` 全量通过（22 单元测试 + 22 Playwright 端到端用例）

---

### Phase 5 — 文档与架构对齐 🟢 [已完成 - PR #231]

**前置依赖**：Phase 1~4 全部完成  
**风险等级**：无  
**估计工作量**：0.5 天  
**交付提交**：PR #231

#### Step 5.1 — 更新 src/README.md

- [x] 更新模块依赖与目录树，反映 100% TypeScript 架构
- [x] 更新构建流程说明（esbuild 5 处 bundle 入口 + per-file 双轨说明）
- [x] 新增 `types/wire.ts` 契约与 SSoT 规范说明

#### Step 5.2 — 更新 AGENTS.md

- [x] 确认测试命令和 CI 门禁标准更新（22 单元测试 + 22 Playwright E2E）
- [x] 同步构建流程与双轨测试说明

#### Step 5.3 — 更新 tests/run_tests.py 静态断言

- [x] 新增 `build.js` 5 个 bundle entrypoint 配置检查
- [x] 新增 `dist/` 5 个 bundle 产物文件存在性检查
- [x] 验证完整 CI 门禁全绿

---

## 实施时间线（修订后）

```
Phase 1: 消除重复           ████ 0.5 day     ← 立即可做，无前置依赖
Phase 2: 拆分 Orchestrator  ████ 0.5 day     ← 立即可做，可与 Phase 1 并行
Phase 3: ESM 渐进迁移       ████████████████ 3-4 days  ← Phase 1&2 之后
  └ 3.1: Background bundle  ████
  └ 3.2: Popup bundle       ████
  └ 3.3: 清理 globalThis    ████████
  └ 3.4: 测试迁移（可选）    ████
Phase 4: 收窄 any           ████████████ 2-3 days  ← 可跨多周渐进
Phase 5: 文档对齐           ████ 0.5 day     ← Phase 3 之后
```

**总计**：约 7-9 个工作日  
**与初版差异**：
- Phase 1 & 2 前置（无需等待 ESM 迁移）
- Phase 3（原 Phase 0）拆分为 4 个可独立验证的子步骤
- 新增 background bundle 和 popup bundle 步骤
- 新增测试基础设施迁移步骤
- 采用"双轨输出"策略避免一次性破坏测试链

---

## 验收标准

每个 Phase/Step 完成后必须通过：

1. **CI 门禁**：`npm test` 全部 22 单元测试 + 22 Playwright E2E 测试通过
2. **类型检查**：`tsc --noEmit` 零错误
3. **构建产物**：`npm run build` 成功，`dist/` 包含所有必要产物
4. **手动冒烟测试**：
   - 扩展加载无报错（检查 Service Worker 控制台）
   - Badge 正常渲染
   - 增量同步 + 全量同步正常
   - 单会话 / 批量导出正常
   - Takeout 导入正常
   - Popup 导出正常
   - Options 页面全功能可用
