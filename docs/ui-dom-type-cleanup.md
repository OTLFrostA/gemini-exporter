# UI DOM 类型契约清理

基线：`208834c1`。范围：Options、Popup、列表及两个页面确认弹窗。

## 根因与修复

- 两个页面各自定义 `el<T>()`，仅按 ID 查找后断言为调用方指定的任意子类型；
  Options 还把包含 select、button 的控件列表统一当作 input。
  现在 `requiredElement(tag, id)` 通过原生标签集合查询建立 `HTMLElementTagNameMap[K]`
  关系，调用方必须指定实际标签。普通节点使用非泛型 `elementById`。
  页面必需节点缺失时明确失败；可选弹窗仍使用原生 nullable 查询并返回 false。
- 设置事件先经 `Object.entries` 丢失字段与控件种类的关系，再由计算属性构造
  string/boolean 混合 patch。现在格式选择单独写入 `defaultFormat`，三个布尔字段
  只读取 input.checked；原有 busy、disabled、失败回滚行为保留。
- DOM 的 select.value 和 dataset.format 是字符串边界，通过四个既有导出格式的
  常量值窄化，移除 Popup 的格式断言。格式标签字典使用完整 ExportFormat 键集。

没有新增 unknown、解码层、业务状态或接口。新增两个共享 DOM helper，删除两个
页面内不健全的泛型 helper，增加一个局部设置写入函数来复用原有保存与回滚流程。
生产代码 +129/-100（净 +29 行）。增加的查找缺失检查及格式入口检查分别保障
真实 DOM 标签契约和可持久化格式契约；没有对已知内部字段重复校验。

## 同口径 AST 库存

仅统计 `src/`；语法命中不等于缺陷数量。

| 类别 | 前 | 后 |
| --- | ---: | ---: |
| any | 0 | 0 |
| unknown | 522 | 522 |
| object | 8 | 8 |
| broad Record | 123 | 122 |
| 普通 as | 44 | 31 |
| 尖括号断言 | 0 | 0 |
| as const | 26 | 27 |
| 非空断言 | 32 | 25 |
| 无约束泛型 | 12 | 12 |
| 有约束泛型 | 24 | 23 |
| 运行时 typeof | 829 | 829 |
| 类型查询 typeof | 44 | 44 |

手工确认的上游修复：两个任意子类型返回点、一个混合控件列表、一个设置键值关系
丢失点。下游自然消除 13 处普通断言和 7 处非空断言。两处泛型断言语义候选消失，
未新增语义候选。不宣称全仓债务清零。

审计使用 skill 的 `audit-types.cjs` 和 `audit-type-flow.cjs`，统一 roots 为
`src,tests,scripts`（语法）及 `src`（语义），TS 5.9.3 侧车，仅作跨版本辅助证据。
两份语义报告均有同一处既有 `credStorage.ts` TS5 兼容诊断；项目原生 TS7 检查独立执行。

合法边界保留：Popup `readActiveKey` 的 IPC 原始响应处理、现有其他网络/存储入口。
本批未新增高风险例外，也未扩大修改到这些独立边界。

## 验证与门禁

- 原生 `npm run type-check` 验证标签返回类型与四个负面类型用例；按钮/select
  不能使用 checked，普通 ID 查询不能获得 value，不能传任意 DOM 子类型作为泛型。
- 页面与弹窗定向测试通过；新增设置交互用例验证字符串枚举/布尔值保存及非法格式拒绝。
- 现有 type-aware unsafe-flow 门禁扩展到本批七个 UI 文件，全部通过。
- 提交前运行完整 `npm test`，覆盖全量单元测试、生产构建、字体门禁及 Playwright。
- 场景池为 20/20。本批未涉及解析引擎、Takeout、会话排序、网络拦截，未执行 Tier 2/3。
