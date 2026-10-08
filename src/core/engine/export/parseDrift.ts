import type { ResourceConversationParseResult } from '../../parsers/parsingResult.js';
/**
 * Phase C (P1-8/P1-9): parser 诊断抽取 —— 纯函数，供导出链路与单测共用。
 *
 * 规则：
 * - turnsRejected > 0（解析器拒识并丢弃了 turn）或会话含 heuristic 拼凑文档
 *   → 导出记录必须标 partial，不能是 ok。
 * - schemaDrift 告警本身只要求可见（warn 日志 + meta.json + _export_errors.json），
 *   不单独决定 partial。
 */
export interface ChatParseDrift {
    schemaDrift: string[];
    turnsRejected: number;
    hasHeuristicDocs: boolean;
    sourcePartial?: boolean;
    truncated?: boolean;
    truncateReason?: string;
}

export function extractChatParseDrift(result: ResourceConversationParseResult): ChatParseDrift {
    const transport = 'transport' in result && result.transport && typeof result.transport === 'object' ? result.transport : {};
    const schemaDrift = 'schemaDrift' in transport && Array.isArray(transport.schemaDrift) ? transport.schemaDrift.filter((value): value is string => typeof value === 'string') : [];
    for (const diagnostic of result.diagnostics.filter(d => d.severity !== 'info')) {
        const warning = `${diagnostic.code}: ${diagnostic.message}`;
        if (!schemaDrift.includes(warning)) schemaDrift.push(warning);
    }
    const turnsRejected = 'turnsRejected' in transport && typeof transport.turnsRejected === 'number' ? transport.turnsRejected : 0;
    return { schemaDrift, turnsRejected, hasHeuristicDocs: result.conversation.assets.some(asset => asset.document?.hasFabricatedText),
        sourcePartial: result.conversation.completeness?.status === 'partial',
        truncated: 'truncated' in transport && transport.truncated === true,
        truncateReason: 'truncateReason' in transport && typeof transport.truncateReason === 'string' ? transport.truncateReason : undefined };
}

export function chatRecordStatusWithDrift(base: "ok" | "empty", drift: ChatParseDrift): "ok" | "empty" | "partial" {
    if (drift.turnsRejected > 0 || drift.hasHeuristicDocs || drift.sourcePartial) return "partial";
    return base;
}
