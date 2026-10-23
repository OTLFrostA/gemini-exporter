import { normId, isReservedRoute } from '../../../../shared/utils/pathUtils.js';
import type { GeminiProtocolModule } from "../../../protocol/gemini/protocol.js";
import type { GeminiIndexObservationInput } from '../parseIndexObservation.js';
export type ConversationListItem = GeminiIndexObservationInput & { id: string };

/** Validated LIST row facts. The official ordering timestamp is separate
 * from the more permissive source update timestamp. */
export interface DecodedGeminiListRow {
    id: string;
    title: string;
    createdAt: number | null;
    updatedAt: number | null;
    orderTime: number;
}

/** Source-layout validity and official ordering evidence, independent of request/account context. */
export interface GeminiListPageEvidence {
    valid: boolean;
    ordered: boolean;
    keys: { id: string; time: number }[];
}

export interface ListParseResult {
    conversations: ConversationListItem[];
    nextPageToken: string | null;
    /** A source failure is a business result; _debug only explains it. */
    failure?: 'hit_google_limit' | 'invalid_response';
    pageEvidence: GeminiListPageEvidence;
    /** Decoded wire evidence; not a validated conversation model. */
    _raw?: unknown;
    _debug?: ListParseDiagnostics;
}

import { GEMINI_JSPB_SCHEMA, robustFirstPayload } from "./extractors.js";
import { GeminiProtocol } from "../../../protocol/gemini/protocol.js";
import { payloadToMs, extractInnerPayload, extractNextPageToken } from "./payload.js";

export interface ListParseDiagnostics {
    error: "BARD_ERROR_INFO" | "NO_INNER_STR";
    bardError: string | null;
    textLen: number;
    rawPreview: string;
    topParsed: string | null;
}

 function getProtocol(): GeminiProtocolModule {
    return GeminiProtocol;
}

/** Only the characterized conversation update slot is an activity/version fact. */
function extractListItemTimestamp(item: unknown): number | null {
    return Array.isArray(item) ? payloadToMs(item[GEMINI_JSPB_SCHEMA.LIST_ITEM.TIMESTAMP]) : null;
}

/** Decode each source LIST row once, before producing indexes or page evidence. */
export function decodeGeminiListRow(raw: unknown): DecodedGeminiListRow | null {
    if (!Array.isArray(raw)) return null;
    const fields: unknown[] = raw;
    const idValue = fields[GEMINI_JSPB_SCHEMA.LIST_ITEM.ID] || "";
    if (typeof idValue !== 'string' || !idValue) return null;
    const id = normId(idValue);
    if (!id || id === 'unknown' || isReservedRoute(id)) return null;

    const rawTitle = fields[GEMINI_JSPB_SCHEMA.LIST_ITEM.TITLE];
    const stamp = fields[GEMINI_JSPB_SCHEMA.LIST_ITEM.TIMESTAMP];
    const updatedAt = payloadToMs(stamp);
    const createdAt = payloadToMs(fields[GEMINI_JSPB_SCHEMA.LIST_ITEM.CREATE_TIME_ALT]);

    // Scan coverage requires the precise official [seconds, nanoseconds] tuple.
    const officialTime = Array.isArray(stamp) && stamp.length === 2
        && typeof stamp[0] === 'number' && Number.isInteger(stamp[0])
        && typeof stamp[1] === 'number' && Number.isInteger(stamp[1])
        && stamp[1] >= 0 && stamp[1] < 1e9;

    return { id, title: typeof rawTitle === 'string' ? rawTitle.trim() : '',
        createdAt, updatedAt, orderTime: officialTime ? updatedAt ?? 0 : 0 };
}

function listResult(decoded: DecodedGeminiListRow[], nextPageToken: string | null, rawRowCount: number | null,
    sourceEndConfirmed = false): ListParseResult {
    const conversations: ConversationListItem[] = decoded.map(row => ({
        id: row.id, title: row.title, titleSource: 'provider',
        ...(row.createdAt !== null ? { createdAt: row.createdAt } : {}),
        ...(row.updatedAt !== null ? { updatedAt: row.updatedAt } : {})
    }));
    const keys = decoded.map(row => ({ id: row.id, time: row.orderTime }));
    const valid = (nextPageToken !== null || sourceEndConfirmed) && rawRowCount !== null && rawRowCount === decoded.length
        && keys.every(key => key.id.length >= 3) && new Set(keys.map(key => key.id)).size === keys.length;
    return { conversations, nextPageToken, pageEvidence: { valid, keys,
        ordered: valid && keys.every(key => key.time > 0) && keys.every((key, i) => i === 0 || keys[i - 1].time >= key.time) } };
}

/** Only the LIST RPC's own structured error slot may certify Gemini's 1096 window limit. */
function isConfirmedListLimit(top: unknown, wrb: string, listRpc: string): boolean {
    if (!Array.isArray(top)) return false;
    // Google's google.rpc.Status details use a protobuf Any: [type URL, [code]].
    // The short tuple remains supported for older replies. A text match or a
    // nearby status number cannot establish a provider boundary.
    const bardErrorType = 'type.googleapis.com/assistant.boq.bard.application.BardErrorInfo';
    const hasCode = (value: unknown): boolean => Array.isArray(value)
        && ((value[0] === 'BardErrorInfo' && value.slice(1, 4).includes(1096))
            || value[0] === bardErrorType && Array.isArray(value[1]) && value[1][0] === 1096
            || value.some(hasCode));
    return top.some(row => Array.isArray(row) && row[0] === wrb && row[1] === listRpc
        && hasCode(row[GEMINI_JSPB_SCHEMA.ERROR_INFO.ERROR_SLOT]));
}

    function parseList(text: string): ListParseResult {
        try {
            let top = robustFirstPayload(text);
            const protocol = getProtocol();
            const wrb = protocol.WRB || "wrb.fr";
            const listRpc = protocol.RPCS ? protocol.RPCS.LIST : "MaZiqc";

            // A response from another RPC may resemble an empty LIST page.
            // Only the explicitly matching LIST wrapper can establish source coverage.
            const { inner, innerStr, isStandardWrb, bardError } = extractInnerPayload(top, { wrb, rpcId: listRpc });

            if (!isStandardWrb || !innerStr || !inner) {
                const listLimit = isConfirmedListLimit(top, wrb, listRpc);
                if (bardError || listLimit) {
                    console.debug("[Gemini Exporter] List source error (BardErrorInfo):", bardError);
                } else {
                    console.warn("[Gemini Exporter] parseList: no inner JSON string found. Raw text len:", text?.length);
                }
                return {
                    ...listResult([], null, null),
                    // Request-bound Provider observation checks that this is the Recent continuation.
                    // Another RPC's BardErrorInfo cannot certify the list boundary.
                    failure: listLimit ? 'hit_google_limit' : 'invalid_response',
                    _debug: {
                        error: bardError || listLimit ? "BARD_ERROR_INFO" : "NO_INNER_STR",
                        bardError: bardError,
                        textLen: text?.length,
                        rawPreview: text?.slice(0, 500),
                        topParsed: top ? JSON.stringify(top).slice(0, 500) : null
                    }
                };
            }
            if (!Array.isArray(inner)) {
                return {
                    ...listResult([], null, null),
                    failure: 'invalid_response',
                    _raw: inner
                };
            }
            const innerSchema = GEMINI_JSPB_SCHEMA.INNER;
            const rows: unknown[] | null = inner.length === 0 ? [] : Array.isArray(inner[innerSchema.LIST_SECONDARY]) ? inner[innerSchema.LIST_SECONDARY] : (Array.isArray(inner[innerSchema.METADATA_ONLY_LIST]) ? inner[innerSchema.METADATA_ONLY_LIST] : null);
            const decoded: DecodedGeminiListRow[] = [];
            for (const rawRow of rows ?? []) {
                const row = decodeGeminiListRow(rawRow);
                if (row) decoded.push(row);
            }
            const nextToken = extractNextPageToken(inner, innerSchema.NEXT_TOKEN_CANDIDATES);
            return {
                // Only the known explicit terminal slot may certify a natural
                // end; a missing/unrecognized token is not terminal evidence.
                ...listResult(decoded, nextToken, rows?.length ?? null, nextToken === null && (inner.length === 0 || inner[1] === null)),
                _raw: inner
            };
        } catch (e: unknown) {
            // Non-Error throws remain unvalidated diagnostic evidence. Keep the legacy
            // property read (including its behavior for null/undefined), not String(e).
            const message = e instanceof Error ? e.message : (e as { message?: unknown }).message;
            console.error("[Gemini Exporter] parseList exception:", message, "raw text snippet:", text ? text.slice(0, 300) : "empty");
            throw new Error("列表解析失败: " + message);
        }
    }

export {
    extractListItemTimestamp,
    parseList
};
