# Gemini L1 响应分层

本次边界是把采集与接口处理分开。处理器内部的重复解析、跨 MAIN/ISOLATED
信任边界的复核、入库及后续工作流不属于此次改动。

| 职责 | 唯一入口 | 负责内容 |
| --- | --- | --- |
| 网络采集 | `sniffer/gemini/hookCredentials.ts` | 包装 fetch/XHR，捕获发送时的账号、slot、时间和页面路径，限量读取响应，报告成功、截断、取消或异常 |
| 接口分发 | `sniffer/gemini/responses/router.ts` | 按协议、主机及 URL 路径选择接口处理器；不解析正文，不根据正文猜测接口 |
| batchexecute 处理 | `sniffer/gemini/responses/batchexecute.ts` | 绑定请求与响应，检查 DELETE 回执，转发 LIST/DETAIL 的原始响应和请求上下文 |
| StreamGenerate 处理 | `sniffer/gemini/responses/streamGenerate.ts` | 识别流式帧、判断完成、抑制重复完成通知，并维护页面侧流状态 |
| batchexecute RPC 解析分发 | `parsers/gemini/rpc/parseResponse.ts` | 主动请求和被动捕获共享 envelope，按 RPC ID 交给现有 LIST/DETAIL parser |

fetch 和 XHR 共用同一个 URL 路由和相同的处理器。处理器各自声明响应读取上限，
采集层不包含 RPC ID、删除回执或流式帧的语义判断。

batchexecute 是多个 RPC 的传输容器，所以还保留 RPC ID 级分发。
跨世界的 DELETE 校验仍在接收侧执行；这不是另一个网络采集入口。
未知接口直接忽略，不将其正文试喂给已知 parser。

账号发现与请求凭据采集保留原来的独立生命周期。此次没有接管 ChatGPT、Claude
或 Takeout 的入口，也没有新增统一所有平台的抽象框架。
