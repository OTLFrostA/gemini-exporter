# Gemini structured / Markdown 附加检查

Tier 2 注册 `feat_gemini_dual_parse`，依赖真实 Markdown ZIP 导出完成。
检查观察此次 Options 导出的 `getConversationDetail` 原生响应，不另行拉取会话，也不发送提问。
导出完成后，同一份 RPC 证据分别走 structured 优先路径与强制原始 Markdown 路径，复用生产环境的 Domain 转换、引用及资源闭合逻辑。
该检查只属于 Gemini，比较器和采集器不会打入产品 bundle。

## 离线重放

已有历史样本可以直接检查，不启动浏览器、不生成对话：

```bash
npm run test:gemini-dual -- --input /absolute/path/to/native --output /absolute/path/to/report
```

输入目录只放待检查的原生响应 `.json` 或原始 RPC `.txt`，也可以直接指定一个文件。
JSON 必须是成功的 `source: batchexecute` Gemini 响应，包含 `data.transport.decodedPayload`。
DOM、缓存、缺失载荷和空回复集都不能作为有效的双路证据。
历史 JSON 中只有 RPC 内层载荷时，仅重建传输包装，并在报告明确标为 `captured_decoded_payload`；不将它冒充原始 HTTP 响应。

完整 Tier 2 自动执行该附加检查。单独选择 `--features feat_gemini_dual_parse` 仍会执行原有导出前置依赖，可能包含发帖；只检查已有历史证据时使用上面的离线命令。

## 判定与证据

- 按源消息序号和 ID 对齐助手回复。用户提问保持生产环境原样解析。
- structured 解码／适配拒绝或不存在时记为 `structured_unavailable`，不把回退后的 Markdown 当作 structured 成功结果参与比较。
- Markdown 分支直接解析 RPC 的原始 Markdown，不从 structured AST 生成输入。
- 比较正文及顺序、代码和语言、公式源码、表格网格、链接目标、引用绑定、图片与文件引用及附件元数据。
- 只统一 CRLF/CR、普通正文空白和相邻文本节点。代码缩进、尾部空白、TeX 源码、URL、资源属性和顺序保留。
- 报告同时保留完整 AST 差异，以及去除标题、加粗等表现包装后的内容差异；分类为 `content_or_metadata` 或 `structure_or_format`。两类都需核对，不自动豁免。
- 比较源载荷重新解码的消息 ID／角色与采集时 Domain 快照。分页未结束、拒绝的源轮次、消息覆盖不符均标为不完整，不能通过。

`REPORT.md` 是入口，`summary.json` 汇总结果，每个 `*.audit.json` 包含逐轮两路 Domain、规范化结果、原始 Markdown、原生结构、完整差异路径及诊断。`sources/` 保留本次全部输入，逐个记录 SHA-256。
Tier 2 同时生成 `capture.json`，检查每个实际选中目标是否都有原生来源，防止漏采、DOM 代替和旧文件混入。

只有全部回复一致且来源完整时退出 0；存在差异、structured 不可用、部分分页或输入错误时退出 1；命令执行错误退出 2。
Tier 2 会将待核对的差异显示为附加检查失败，不把它们直接定性为产品缺陷。

## 能证明什么

这是一项差分检查，两边都不是正确性标准。原生引用可能比 Markdown 信息丰富；公式可能是等价的不同 TeX；代码末尾换行也会被忠实报告。差异需要回到原始证据／网页判断。
两条路径共用 RPC 解码及部分资源提取，因此不能发现所有上游共同错误，也不验证附件下载字节、渲染效果或公式的数学等价性。它补充原有磁盘导出和视觉检查。

## 2026-10-15 历史基线

首次用既存 100 个会话的捕获载荷重放：预期 439 条助手回复，保留的载荷覆盖 434 条，其中 113 条完整 AST 一致，317 条有差异（269 条内容／元数据差异，48 条仅结构／格式差异），4 条 structured 不可用。
其中一个会话 `a714229ffb19b514` 的捕获载荷只有部分分页，5 条助手回复没有原生对比来源，检查正确报告不完整。本次未追加网络请求或新会话补齐。
这些是差异和证据覆盖统计，不能解读为 317 个 bug 或 structured 正确率。
