import { normId, isReservedRoute } from '../../../utils/pathUtils.js';
import type { GeminiProtocolModule } from "../../../protocol/protocol.js";
import type { GeminiIndexObservationInput } from '../parseIndexObservation.js';
export type ConversationListItem = GeminiIndexObservationInput & { id: string };

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

export interface GeminiParserParseListModule {
    extractListItemTimestamp: (item: unknown) => number | null;
    parseList: (text: string) => ListParseResult;
}

import { GEMINI_JSPB_SCHEMA, robustFirstPayload } from "./extractors.js";
import { GeminiProtocol } from "../../../protocol/protocol.js";
import { payloadToMs, extractInnerPayload, extractNextPageToken } from "./payload.js";

export interface ListParseDiagnostics {
    error: "BARD_ERROR_INFO" | "NO_INNER_STR";
    bardError: string | null;
    textLen: number;
    rawPreview: string;
    topParsed: string | null;
}

const FALLBACK_SCHEMA = GEMINI_JSPB_SCHEMA;

function getSchema(): typeof GEMINI_JSPB_SCHEMA {
    return GEMINI_JSPB_SCHEMA;
}

function getProtocol(): GeminiProtocolModule {
    return GeminiProtocol;
}

/** Only the characterized conversation update slot is an activity/version fact. */
function extractListItemTimestamp(item: unknown): number | null {
    return Array.isArray(item) ? payloadToMs(item[GEMINI_JSPB_SCHEMA.LIST_ITEM.TIMESTAMP]) : null;
}

function listResult(conversations: ConversationListItem[], nextPageToken: string | null, rows: unknown[] | null): ListParseResult {
    const keys = conversations.map((item, index) => {
        const row = rows?.[index];
        const stamp = Array.isArray(row) ? row[GEMINI_JSPB_SCHEMA.LIST_ITEM.TIMESTAMP] : undefined;
        // Only the exact official seconds/nanoseconds tuple can establish ordering.
        const time = Array.isArray(stamp) && stamp.length === 2 && Number.isInteger(stamp[0])
            && Number.isInteger(stamp[1]) && stamp[1] >= 0 && stamp[1] < 1e9 ? payloadToMs(stamp) : null;
        return { id: item.id, time: time ?? 0 };
    });
    const valid = (nextPageToken === null || keys.length > 0) && rows !== null && rows.length === conversations.length
        && keys.every(key => key.id.length >= 3) && new Set(keys.map(key => key.id)).size === keys.length;
    return { conversations, nextPageToken, pageEvidence: { valid, keys,
        ordered: valid && keys.every(key => key.time > 0) && keys.every((key, i) => i === 0 || keys[i - 1].time >= key.time) } };
}

/** Only the LIST RPC's own structured error slot may certify Gemini's 1096 window limit. */
function isConfirmedListLimit(top: unknown, wrb: string, listRpc: string): boolean {
    if (!Array.isArray(top)) return false;
    const hasCode = (value: unknown): boolean => Array.isArray(value)
        && ((value[0] === 'BardErrorInfo' && value.slice(1, 4).includes(1096))
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

            const { inner, innerStr, bardError } = extractInnerPayload(top, {
                wrb,
                rpcId: listRpc,
                heuristicFilter: s => s.startsWith("[") || s.startsWith('"[') || /c_[a-zA-Z0-9_-]{8,64}/.test(s)
            });

            if (!innerStr || !inner) {
                if (bardError) {
                    console.debug("[Gemini Exporter] List source error (BardErrorInfo):", bardError);
                } else {
                    console.warn("[Gemini Exporter] parseList: no inner JSON string found. Raw text len:", text?.length);
                }
                return {
                    ...listResult([], null, null),
                    // Request-bound Provider observation checks that this is the Recent continuation.
                    // Another RPC's BardErrorInfo cannot certify the list boundary.
                    failure: bardError && isConfirmedListLimit(top, wrb, listRpc) ? 'hit_google_limit' : 'invalid_response',
                    _debug: {
                        error: bardError ? "BARD_ERROR_INFO" : "NO_INNER_STR",
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
            let convs: ConversationListItem[] = [];
            const schema = getSchema();
            const listItemSchema = schema.LIST_ITEM || FALLBACK_SCHEMA.LIST_ITEM;

            for (let item of rows ?? []) {
                if (!Array.isArray(item)) continue;
                let id = item[listItemSchema.ID] || item[0] || "",
                    title = item[listItemSchema.TITLE] || item[1] || "",
                    createTs: number | null = null;

                let serverTs = extractListItemTimestamp(item);

                let createArr = item[listItemSchema.CREATE_TIME_ALT];
                createTs = payloadToMs(createArr);

                if (typeof id !== 'string' || !id) continue;
                id = normId(id);
                if (!id || id === 'unknown' || isReservedRoute(id)) continue;
                try {
                    convs.push({ id, title: typeof title === 'string' ? title.trim() : '', titleSource: 'provider',
                        ...(createTs !== null ? { createdAt: createTs } : {}),
                        ...(serverTs !== null ? { updatedAt: serverTs } : {}) });
                } catch (error) {
                    if (!(error instanceof TypeError)) throw error;
                }
            }
            const nextToken = extractNextPageToken(inner, innerSchema.NEXT_TOKEN_CANDIDATES);
            return {
                ...listResult(convs, nextToken, rows),
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

export const GeminiParserParseList: GeminiParserParseListModule = {
    extractListItemTimestamp,
    parseList
};

if (typeof module === 'object' && module.exports) module.exports = GeminiParserParseList;

export default GeminiParserParseList;

