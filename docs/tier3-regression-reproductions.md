# Tier 3 问题修复与回归验证

来源：2026-10-21，Luna 三轮视觉探索。以下用例使用本地 fixture，属于 Tier 1 回归，
不替代真实账号 Tier 2 或纯视觉 Tier 3。不访问真实账号、不修改历史记录。

## 四项修复

| 标识 | 原问题 | 修复与验证 |
|---|---|---|
| T3-PDF-CJK | 字体权限拒绝后，PDF 显示成功却丢中文 | 随插件打包原版 Noto Sans CJK SC Regular 与 Noto Sans Mono，字体不可用时仍离线显示中文并保持代码等宽；真实下载 PDF 后检查输入文本，并渲染图片人工视觉检查 |
| T3-CONNECTION-STATUS | Gemini 重新连接、列表恢复后仍显示旧连接错误 | 仅对缺失来源的扫描错误，在刷新时重新核实 Content 账号绑定；相同账号确已连接才更新提示，其他操作状态与账号切换不覆盖 |
| T3-UI-IDLE | 同步进行中，Tier 3 提前判定空闲 | 实际等待探测同时检查 Options 的 body data-busy 和 Gemini 流式状态；真实浏览器 busy DOM 反例已转为正常断言 |
| T3-JSON-VALIDATOR | JSON ZIP 被 Markdown 验收器误判成零会话 | 根据归档格式分派 JSON 验收，检查 format/version、Account/Index/Detail 标识一致性、消息结构、目标会话和物理资源；HTML/PDF 缺少适配器时明确报告不支持 |

已移除所有本轮新增的 test.fail / expectedFailure 标记；这些用例现在必须正常通过。
JSON 验收不代表逐字内容或图片视觉一致性通过；golden 内容断言尚未支持时会明确失败，
不静默跳过。增加了错账号、缺附件、空附件、目录越界、非法 JSON 和错误目标的反例。

## 测试入口

```bash
npx playwright test tests/e2e/tier3_regressions.spec.ts
python3 -m unittest tests.test_visual_sandbox -v
python3 tests/run_tests.py --filter local-font
npm test
node build.js --pack
```

浏览器回归共 7 项：PDF 中文、连接错误恢复、先开 Options 后连接 Gemini、仅本地数据
不误消除连接错误、搜索隐藏选择的实际导出范围、外链新标签页、空闲探测。

## 测试边界

- 字体权限拒绝是已确定的 PDF 最小触发条件，不能据此断定上次真实账号导出的唯一原因。
  新增 CJK 字体约 15.7 MiB、等宽字体约 1.6 MiB，随安装包离线提供，不需要运行时联网下载。
  保留完整字符集，未根据测试字符裁剪。授权时仍优先使用设备字体。
- 确认列表更新不等于云端已可扫描；提示清理前必须通过 Runtime 的账号绑定核实。
- 初次连接的受控用例无需刷新即可同步，真实 Google 页面此前需要刷新的现象尚未稳定复现。
- 搜索后隐藏的会话仍保留选择；真实 Markdown 下载确认其仍在导出范围内。这记录当前行为和
  UX 风险，没有改动选择语义。
- 外链箭头可打开正确的新标签页；点击标题选择行。原页面仍显示 New chat 不能作为跳转失败证据。
- UI idle 用例验证实际 Python 等待器使用的探测表达式，没有执行完整等待循环。
- 目录取消与再次授权已有 tier3_recovery_ui.spec.ts 覆盖；Takeout 文件入口已有 ui_v2.spec.ts
  覆盖。原生选择器视觉不可见的问题仍属于测试能力限制，不算真实目录和导入流程验收通过。
- 同名 ZIP 仍可能覆盖审计文件，探索时需立即按轮次和格式保存快照；未新增自动归档功能。

## 本轮视觉证据

- tests/output/visual_audit/fixed_pdf/bilingual-offline.pdf
- tests/output/visual_audit/fixed_pdf/page-1.png

在拒绝本地字体权限时由真实扩展导出，图中英文与“中文：驻波边界条件与频谱分析”均可见，
没有观察到重叠或裁切。随后已重新运行真实账号 Tier 2；未再次运行 Luna Tier 3。

## 验证记录

- 7 项定向浏览器回归通过，无已知失败标记。
- 36 项视觉沙箱 Python 用例通过；JSON 正反例通过，上一轮实际 JSON ZIP 也通过新检查。
- 23 个 PDF 单元测试套件通过，包含长 ASCII 图示不折行、字符图示对齐与真实 WASM 编译。
- 2 个本地字体套件通过；类型检查与差异空白检查通过。
- 本地生产 ZIP 已生成，约 26.0 MiB，打包包含字体和许可证。

- 最终全量 npm test 退出 0：所有单元门禁通过，154 项 Playwright 正常通过，无本轮已知失败豁免。
- 最终构建和 ZIP 打包完成，未 push。

## Tier 2 后续修复与复测（2026-10-21）

- 跳过已导出验收仍匹配旧版摘要，已更新为当前中英文文案；仍要求本次完成证据、精确计数和零物理下载，随后校验混合选择仅交付未导出目标。反例覆盖旧状态、部分缺失、取消、失败和意外文件。
- 双路审计切换 Markdown 正文时错误删除了原生文件引用元数据。现仅选择正文解析分支，两路保留同一来源元数据，并验证原生正文不会混入 Markdown。
- 真实 RPC 中原生强调标记吞掉了 `Q^* = 30` 的星号。GM-MD-005 仅在残留美元符号的段落与原始 Markdown 的周围文字和结构唯一匹配时恢复公式；代码、引用和已解析公式保持原样。保存最小原始样本并覆盖歧义、无关段落等反例；审计仍比较未恢复的原生分支，不制造一致性。
- 修复后完整 `npm test` 退出 0，154 项 Playwright 通过；真实 RPC 重放确认仅恢复一条回复中的受损段落。
- 完整 Tier 2 退出 0：24 PASS、0 FAIL、0 SKIP、1 非阻断双路解析 WARN。全量跳过与部分跳过均通过，卸载和纯净加载实际执行通过；7 个会话的 Markdown、HTML、PDF 文件及附件校验通过。
- 本轮现场生成沿用用户指定的两个对话、各两轮；生命周期验收另含旧会话追加与瞬态删除会话。场景池补齐并校验为 20/20。
- 剩余审计警告：12 条回复中 7 条一致、5 条存在原生/Markdown 的表格对齐、公式空白或网页引用差异。0 structured 不可用、0 错误、0 不完整捕获。未宣称两种表示完全一致，表格对齐差异保留供视觉复核。
- 复测日志和审计证据位于 git-ignored 的 `tests/output/t1_t2_followup_fixes/`。

## 本地与 CI 发布门禁对齐

PR 首轮 CI 被遗留的“禁止 CJK 字体、总字体小于 5 MiB”门禁阻断；原本本地
`npm test` 未执行该门禁。更新后，本地与 CI 都执行 `npm run test:release-fonts`：
仅允许三个批准的离线字体和原版许可证，逐个校验 SHA256，保留 20 MiB 总体积限制，
并拒绝额外字体、改名或篡改、符号链接及生成 JS 内的字体 data URI。
9 个正反例验证资产完整性和门禁接线，避免 CI 独有检查再次漏测。
