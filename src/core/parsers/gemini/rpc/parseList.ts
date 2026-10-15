import type { GeminiProtocolModule } from "../../../protocol/protocol.js";
import { restoreConversationIndex } from '../../../domain/conversationIndex.js';
import type { DomainConversationIndex } from '../../../domain/conversationIndex.js';
export type ConversationListItem = DomainConversationIndex;

export interface ListParseResult {
    conversations: ConversationListItem[];
    nextPageToken: string | null;
    /** A source failure is a business result; _debug only explains it. */
    failure?: 'hit_google_limit' | 'invalid_response';
    /** Decoded wire evidence; not a validated conversation model. */
    _raw?: unknown;
    _debug?: ListParseDiagnostics;
}

export interface GeminiParserParseListModule {
    extractListItemTimestamp: (item: unknown) => number | null;
    parseList: (text: string) => ListParseResult;
}

import { GEMINI_JSPB_SCHEMA, robustFirstPayload, cleanTitle, isRealTitle, normId } from "./extractors.js";
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
                    console.log("[Gemini Exporter] Google 服务端翻页到达极限 (BardErrorInfo):", bardError);
                } else {
                    console.warn("[Gemini Exporter] parseList: no inner JSON string found. Raw text len:", text?.length);
                }
                return {
                    conversations: [],
                    nextPageToken: null,
                    failure: bardError ? 'hit_google_limit' : 'invalid_response',
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
                    conversations: [],
                    nextPageToken: null,
                    failure: 'invalid_response',
                    _raw: inner
                };
            }
            const innerSchema = GEMINI_JSPB_SCHEMA.INNER;
            let list = Array.isArray(inner[innerSchema.LIST_SECONDARY]) ? inner[innerSchema.LIST_SECONDARY] : (Array.isArray(inner[innerSchema.METADATA_ONLY_LIST]) ? inner[innerSchema.METADATA_ONLY_LIST] : []);
            let convs: ConversationListItem[] = [];
            const schema = getSchema();
            const listItemSchema = schema.LIST_ITEM || FALLBACK_SCHEMA.LIST_ITEM;

            for (let item of list) {
                if (!Array.isArray(item)) continue;
                let id = item[listItemSchema.ID] || item[0] || "",
                    title = item[listItemSchema.TITLE] || item[1] || "",
                    createTs: number | null = null;

                let serverTs = extractListItemTimestamp(item);

                let createArr = item[listItemSchema.CREATE_TIME_ALT];
                createTs = payloadToMs(createArr);

                const effectiveTime = serverTs;


                if (id) {
                    let cleanId = normId(id);
                    const cleanT = cleanTitle(title || cleanId);
                    const isReal = isRealTitle(cleanT, cleanId);
                    convs.push(restoreConversationIndex({ providerId: 'gemini', id: cleanId, title: isReal ? cleanT : '',
                        titleSource: isReal ? 'rpc' : 'default',
                        cloudAvailability: 'available', hasTakeoutImport: false,
                        ...(createTs !== null ? { createdAt: createTs } : {}), ...(effectiveTime !== null ? { updatedAt: effectiveTime } : {}),
                        url: `https://gemini.google.com/app/${cleanId}` }));
                }
            }
            const nextToken = extractNextPageToken(inner, innerSchema.NEXT_TOKEN_CANDIDATES);
            return {
                conversations: convs,
                nextPageToken: nextToken,
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

