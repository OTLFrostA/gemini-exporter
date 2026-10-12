import type { PageObservation } from '../../sync/pageObservation.js';
import type { ConversationListItem, ListParseResult } from '../../parsers/gemini/rpc/parseList.js';
import { GEMINI_JSPB_SCHEMA } from '../../parsers/gemini/rpc/extractors.js';
import { payloadToMs } from '../../parsers/gemini/rpc/payload.js';

export interface GeminiListRequestContext {
    streamId: 'recent' | 'pinned';
    requestCursor: string | null;
}

/** Only the exact list request layout is evidence; ambiguous batched calls are ignored. */
export function readGeminiListRequest(body: unknown): GeminiListRequestContext | null {
    if (typeof body !== 'string') return null;
    try {
        const batch: unknown = JSON.parse(new URLSearchParams(body).get('f.req') || 'null');
        if (!Array.isArray(batch)) return null;
        const calls = batch.flat().filter((call: unknown) => Array.isArray(call) && call[0] === 'MaZiqc');
        if (calls.length !== 1) return null;
        const args: unknown = JSON.parse(calls[0][1]);
        if (!Array.isArray(args) || args.length !== 3 || !Number.isInteger(args[0]) || args[0] <= 0
            || !(args[1] === null || typeof args[1] === 'string') || !Array.isArray(args[2])) return null;
        const filter = args[2];
        if (filter.length !== 3 || ![0, 1].includes(filter[0]) || filter[1] !== null || filter[2] !== 1) return null;
        return { streamId: filter[0] === 1 ? 'pinned' : 'recent', requestCursor: args[1] };
    } catch { return null; }
}

export function geminiListObservation(result: ListParseResult, request: GeminiListRequestContext | null,
    accountId: string | null, truncated = false, requestedAt = 0): PageObservation<ConversationListItem> {
    if (!request || !['recent', 'pinned'].includes(request.streamId)
        || !(request.requestCursor === null || typeof request.requestCursor === 'string')) request = null;
    // Display timestamp fallbacks are intentionally excluded from ordering evidence.
    const raw = Array.isArray(result._raw) ? result._raw : [];
    const rows: unknown[] | null = Array.isArray(result._raw) && raw.length === 0 ? [] : Array.isArray(raw[GEMINI_JSPB_SCHEMA.INNER.LIST_SECONDARY]) ? raw[GEMINI_JSPB_SCHEMA.INNER.LIST_SECONDARY] : Array.isArray(raw[GEMINI_JSPB_SCHEMA.INNER.METADATA_ONLY_LIST]) ? raw[GEMINI_JSPB_SCHEMA.INNER.METADATA_ONLY_LIST] : null;
    const keys = result.conversations.map((item, index) => {
        const row = rows?.[index];
        const time = Array.isArray(row) && Array.isArray(row[5]) && row[5].length === 2
            && Number.isInteger(row[5][0]) && Number.isInteger(row[5][1]) && row[5][1] >= 0 && row[5][1] < 1e9
            ? payloadToMs(row[5]) : null;
        return { id: item.id, time: time ?? 0 };
    });
    const valid = (result.nextPageToken === null || keys.length > 0) && !truncated && !result._debug && rows !== null && rows.length === result.conversations.length
        && keys.every(key => key.id.length >= 3) && new Set(keys.map(key => key.id)).size === keys.length;
    return { providerId: 'gemini', accountId, streamId: request?.streamId ?? 'unknown', items: result.conversations,
        requestCursor: request?.requestCursor ?? null, nextCursor: result.nextPageToken,
        requestedAt, requestKnown: request !== null, valid,
        ordered: valid && request?.streamId === 'recent' && keys.every(key => key.time > 0) && keys.every((key, i) => i === 0 || keys[i - 1].time >= key.time), keys };
}
