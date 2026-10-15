import type { ResourceConversationParseResult, ConversationAcquisitionFailure, NativeConversationInput } from '../parsers/parsingResult.js';

export const NATIVE_DETAIL_ENVELOPE_VERSION = 3;
export interface NativeDetailReply {
    success: boolean; data?: NativeConversationInput; chat?: ResourceConversationParseResult;
    rawResponse?: unknown; error?: string; source?: string; retryAfterMs?: number; _debug?: unknown; _raw?: unknown;
}
export type NativeBatchReply =
    | { success: true; results: NativeConversationInput[]; chat?: ResourceConversationParseResult; skipped?: number; source?: string; error?: never }
    | { success: true; chat: ResourceConversationParseResult; results?: never; skipped?: number; error?: never }
    | { success: false; error: string; results?: never; chat?: never; skipped?: never;
        aborted?: boolean; retryAfterMs?: number; _debug?: unknown; _raw?: unknown; rawResponse?: unknown };
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function failure(value: unknown): ConversationAcquisitionFailure {
    if (!object(value) || typeof value.error !== 'string') throw new TypeError('Malformed conversation failure envelope');
    return { error: value.error, ...(typeof value.id === 'string' ? { id: value.id } : {}),
        ...(typeof value.title === 'string' ? { title: value.title } : {}), ...(typeof value.url === 'string' ? { url: value.url } : {}),
        ...(typeof value.isDeleted === 'boolean' ? { isDeleted: value.isDeleted } : {}),
        ...(typeof value._empty === 'boolean' ? { _empty: value._empty } : {}), _debug: value._debug, _raw: value._raw };
}
/** Only called after a current-version reply from an authenticated extension channel.
 * The publisher's Parser/Storage established Domain trust. These are envelope checks,
 * not a second Domain schema; this assertion is intentionally confined to this adapter. */
function nativeResult(value: unknown): ResourceConversationParseResult {
    const opaque: unknown = value;
    if (!object(value) || !object(value.conversation) || !Array.isArray(value.diagnostics)
        || !object(value.resourceHints) || !object(value.acquisitionHints)) throw new TypeError('Malformed native conversation result');
    if (value.sourceVersion !== undefined && (typeof value.sourceVersion !== 'number' || !Number.isFinite(value.sourceVersion))) throw new TypeError('Invalid source conversation version');
    const graph = value.conversation;
    if (!object(graph.index) || !object(graph.detail)
        || typeof graph.index.providerId !== 'string' || typeof graph.index.id !== 'string' || typeof graph.index.title !== 'string'
        || !Array.isArray(graph.detail.messages) || !Array.isArray(graph.detail.assets)) throw new TypeError('Malformed native conversation envelope');
    return opaque as ResourceConversationParseResult;
}
function item(value: unknown): NativeConversationInput {
    return object(value) && 'conversation' in value ? nativeResult(value) : failure(value);
}
const unreadable = 'Malformed direct response envelope: Gemini returned an unreadable conversation reply. Refresh its page and try again.';
function rejected(value: unknown, error = unreadable): Extract<NativeBatchReply, { success: false }> {
    return { success: false, error, rawResponse: value,
        ...(object(value) ? { _debug: value._debug, _raw: value._raw,
            ...(typeof value.retryAfterMs === 'number' ? { retryAfterMs: value.retryAfterMs } : {}) } : {}) };
}
/** The callback must be an extension runtime/tabs transport, never a webpage event or disk read. */
export async function requestNativeDetail(send: () => Promise<unknown>): Promise<NativeDetailReply> {
    const value = await send();
    if (!object(value) || typeof value.success !== 'boolean') return rejected(value);
    if (!value.success) return rejected(value, typeof value.error === 'string' && value.error ? value.error : '未知错误');
    if (value.domainEnvelopeVersion !== NATIVE_DETAIL_ENVELOPE_VERSION) return rejected(value, 'Conversation reply version is incompatible. Refresh the Gemini page and try again.');
    try {
        const data = item(value.data ?? value.chat ?? value);
        return { success: true, data, ...(typeof value.source === 'string' ? { source: value.source } : {}) };
    } catch { return rejected(value, 'Gemini returned unreadable conversation data. Refresh its page and try again.'); }
}
/** Batch replies retain source failures and cancellation; malformed success never reaches exporters. */
export async function requestNativeBatch(send: () => Promise<unknown>): Promise<NativeBatchReply> {
    const value = await send();
    if (!object(value) || typeof value.success !== 'boolean') return rejected(value);
    if (!value.success) return { ...rejected(value, typeof value.error === 'string' ? value.error : unreadable),
        ...(typeof value.aborted === 'boolean' ? { aborted: value.aborted } : {}) };
    if (value.domainEnvelopeVersion !== NATIVE_DETAIL_ENVELOPE_VERSION) return rejected(value, 'Conversation reply version is incompatible. Refresh the Gemini page and try again.');
    try {
        if (value.skipped !== undefined && (typeof value.skipped !== 'number' || !Number.isFinite(value.skipped))) return rejected(value);
        if (Array.isArray(value.results)) return { success: true, results: value.results.map(item), skipped: value.skipped };
        if (value.chat !== undefined) return { success: true, chat: nativeResult(value.chat), skipped: value.skipped };
        return rejected(value);
    } catch (error) { return rejected(value, error instanceof Error ? error.message : unreadable); }
}
