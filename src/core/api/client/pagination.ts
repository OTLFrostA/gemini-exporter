import { isResourceConversationParseResult } from '../../parsers/parsingResult.js';
import { mergeConversationPages } from '../../parsers/gemini/rpc/mergePages.js';
import type { ResourceConversationParseResult } from '../../parsers/parsingResult.js';
import { getErrorMessage, isDevMode, normId } from "../../utils/utils.js";
import { isRateLimited } from "../../engine/export/rateLimiter.js";
import type { ConversationListItem, ListParseResult, ListParseDiagnostics } from "../../parsers/gemini/rpc/parseList.js";
import type { DetailParseResult } from "./detailTypes.js";

export interface PaginationProgressInfo {
    page: number;
    added: number;
    total: number;
    hasMore: boolean;
    batch?: ConversationListItem[];
    stoppedEarly?: boolean;
    reason?: string;
}

export interface PaginationPageBatchInfo {
    page: number;
    hasMore: boolean;
}

export interface PaginationStopDecision {
    shouldStop?: boolean;
    reason?: string;
}

export type PaginationProgressCallback = (info: PaginationProgressInfo) => void;
export type PaginationPageBatchCallback = (
    batch: ConversationListItem[], info: PaginationPageBatchInfo
) => Promise<PaginationStopDecision | void>;

/** Options for the existing Gemini list scan; targetSid is Gemini-specific. */
export interface PaginationOptions {
    maxPages?: number;
    onProgress?: PaginationProgressCallback | null;
    onPageBatch?: PaginationPageBatchCallback | null;
    targetSid?: string | null;
    incremental?: boolean;
    signal?: AbortSignal | null;
}

export type PaginationCompletionReason =
    | 'natural_exhaustion'
    | 'unchanged_boundary'
    | 'token_loop'
    | 'max_pages'
    | 'hit_google_limit'
    | 'aborted'
    | 'error';

export interface PaginationTokenPreview {
    len: number;
    preview: string;
}

export interface PaginationPageDiagnostic {
    page: number;
    requestedToken: PaginationTokenPreview | null;
    count: number;
    hasNextPageToken: boolean;
    nextTokenPreview: PaginationTokenPreview | null;
    debugInfo: ListParseDiagnostics | null;
}

/** Gemini-specific diagnostics persisted by sync and read by Takeout UI. */
export interface GeminiPaginationDiagnostics {
    startTime: string;
    endTime?: string;
    maxPages: number;
    incremental: boolean;
    totalPagesFetched: number;
    totalConversations: number;
    stopReason: string;
    hitGoogleLimit: boolean;
    pageHistory: PaginationPageDiagnostic[];
}

/** Actual aggregate producer result, not a resumable Provider page. */
export interface PaginationResult {
    conversations: ConversationListItem[];
    total: number;
    stoppedEarly?: true;
    exhaustive: boolean;
    completionReason: PaginationCompletionReason;
    diagnostics: GeminiPaginationDiagnostics;
    hitGoogleLimit: boolean;
}

/** Compatibility guard input: absence of legacy flags still means complete. */
export interface PaginationCompletenessEvidence {
    stoppedEarly?: boolean;
    exhaustive?: boolean;
    completionReason?: string;
    hitGoogleLimit?: boolean;
    diagnostics?: { hitGoogleLimit?: boolean } | null;
}

/** Request flags actually read by GeminiAPIClient; no provider/session abstraction. */
export interface GeminiListRequestOptions {
    signal?: AbortSignal | null;
    maxRetries?: number;
    _retried?: boolean;
    _retryCount?: number;
    _overrideAt?: string;
    _overrideBl?: string | null;
}

export interface GeminiDetailRequestOptions extends Omit<GeminiListRequestOptions, "_retried"> {
    _retriedXsrf?: boolean;
    detailOnly?: boolean;
    altParams?: boolean;
}

export interface GeminiPaginationListClient {
    aborted?: boolean;
    isAborted?: (signal?: AbortSignal | null) => boolean;
    getConversationList: (pageToken?: string | null, targetSid?: string | null,
        customFilter?: unknown, opts?: GeminiListRequestOptions) => Promise<ListParseResult>;
}

export interface GeminiPaginationDetailClient {
    fetchConversationPage: (conversationId: string, pageToken?: string | null,
        targetSid?: string | null, opts?: GeminiDetailRequestOptions) => Promise<DetailParseResult>;
}

export interface PaginatedDetailResult extends ResourceConversationParseResult {
    transport: DetailParseResult['transport'] & {
        truncated?: boolean;
        truncateReason?: 'token_loop' | 'max_turns_page_limit_20';
    };
}

export interface GeminiClientPaginationModule {
    getAllConversations: (client: GeminiPaginationListClient, maxPages?: number | PaginationOptions,
        onProgress?: PaginationProgressCallback | null, targetSid?: string | null,
        opts?: PaginationOptions) => Promise<PaginationResult>;
    getConversationDetail: (client: GeminiPaginationDetailClient, conversationId: string,
        targetSid?: string | null) => Promise<PaginatedDetailResult>;
    isPaginationExhaustive: (res: PaginationCompletenessEvidence | null | undefined) => boolean;
}

/** Runtime global abort evidence is observed by truthiness, without validation. */
interface PaginationAbortFlags {
    __gemExporterAborted?: unknown;
}

export function isPaginationExhaustive(res: PaginationCompletenessEvidence | null | undefined): boolean {
    if (!res) return false;
    if (res.stoppedEarly) return false;
    if (res.hitGoogleLimit || res.diagnostics?.hitGoogleLimit) return false;
    if (res.exhaustive === false) return false;
    if (res.completionReason && res.completionReason !== 'natural_exhaustion') return false;
    return true;
}

    async function getAllConversations(client: GeminiPaginationListClient, maxPages: number | PaginationOptions = 2000, onProgress?: PaginationProgressCallback | null, targetSid?: string | null, opts?: PaginationOptions): Promise<PaginationResult> {
        if (typeof maxPages === "object" && maxPages !== null) {
            opts = maxPages;
            maxPages = opts.maxPages !== undefined ? opts.maxPages : 2000;
            onProgress = opts.onProgress || null;
            targetSid = opts.targetSid || null;
        }
        if (!maxPages || typeof maxPages !== "number") maxPages = 2000;
        opts = opts || {};
        const incremental = !!opts.incremental;
        let all: ConversationListItem[] = [],
            seen = new Set<string>(),
            seenTokens = new Set<string>(),
            token: string | null = null;
        const diagLog: GeminiPaginationDiagnostics = {
            startTime: new Date().toISOString(),
            maxPages,
            incremental,
            totalPagesFetched: 0,
            totalConversations: 0,
            stopReason: "就绪（尚未触发同步）",
            hitGoogleLimit: false,
            pageHistory: []
        };
        if (client.aborted || opts?.signal?.aborted) {
            diagLog.stopReason = "用户手动终止同步（开始前已取消）";
            diagLog.totalConversations = 0;
            diagLog.endTime = new Date().toISOString();
            return {
                conversations: [],
                total: 0,
                stoppedEarly: true,
                exhaustive: false,
                completionReason: 'aborted',
                diagnostics: diagLog,
                hitGoogleLimit: false
            };
        }
        client.aborted = false;

        const isAborted = () => {
            if (opts?.signal?.aborted) return true;
            if (typeof client.isAborted === "function") return client.isAborted(opts?.signal);
            return !!(
                client.aborted ||
                (typeof window !== "undefined" && (window as Window & PaginationAbortFlags).__gemExporterAborted) ||
                (typeof globalThis !== "undefined" && (globalThis as typeof globalThis & PaginationAbortFlags).__gemExporterAborted)
            );
        };

        let reachedMax = true;
        let interruptedByError = false;
        let stoppedEarly = false;
        let completionReason: PaginationCompletionReason = 'natural_exhaustion';
        for (let i = 0; i < maxPages; i++) {
            if (isAborted()) {
                diagLog.stopReason = `用户手动终止同步 (已拉取 ${i} 页，共 ${all.length} 条)`;
                console.log(`[Gemini Exporter] getAllConversations aborted by user at page ${i + 1}`);
                reachedMax = false;
                stoppedEarly = true;
                completionReason = 'aborted';
                break;
            }
            let res: ListParseResult;
            try {
                res = await client.getConversationList(token, targetSid, undefined, { signal: opts?.signal });
            } catch (err: unknown) {
                console.warn(`[Gemini Exporter] getAllConversations page ${i + 1} stopped:`, getErrorMessage(err));
                const aborted = isAborted() || (typeof err === 'object' && err !== null && 'name' in err && err.name === 'AbortError');
                const isLimit = !aborted && isRateLimited(err);
                if (isLimit) {
                    diagLog.hitGoogleLimit = true;
                }
                diagLog.stopReason = aborted ? `用户手动终止同步: ${getErrorMessage(err)}` : `网络或服务异常: ${getErrorMessage(err)}`;
                reachedMax = false;
                if (all.length > 0) {
                    interruptedByError = true;
                    completionReason = aborted ? 'aborted' : isLimit ? 'hit_google_limit' : 'error';
                    break;
                }
                throw err;
            }
            diagLog.totalPagesFetched = i + 1;
            diagLog.pageHistory.push({
                page: i + 1,
                requestedToken: token ? { len: token.length, preview: token.slice(0, 20) + "..." } : null,
                count: res?.conversations?.length || 0,
                hasNextPageToken: !!res?.nextPageToken,
                nextTokenPreview: res?.nextPageToken ? { len: res.nextPageToken.length, preview: res.nextPageToken.slice(0, 20) + "..." } : null,
                debugInfo: res?._debug || null
            });
            let added = 0;
            if (Array.isArray(res?.conversations)) {
                for (let c of res.conversations) {
                    if (!seen.has(c.id)) {
                        seen.add(c.id);
                        all.push(c);
                        added++;
                    }
                }

                if (typeof opts?.onPageBatch === 'function' && res.conversations.length > 0) {
                    const decision = await opts.onPageBatch(res.conversations, {
                        page: i + 1,
                        hasMore: !!res?.nextPageToken
                    });
                    if (decision && decision.shouldStop) {
                        diagLog.stopReason = decision.reason || "已与历史水位线闭环咬合，早退终止";
                        diagLog.totalConversations = all.length;
                        diagLog.endTime = new Date().toISOString();
                        if (onProgress) onProgress({
                            page: i + 1,
                            added,
                            total: all.length,
                            hasMore: false,
                            stoppedEarly: true,
                            reason: decision.reason || "增量同步完成",
                            batch: res.conversations
                        });
                        return {
                            conversations: all,
                            total: all.length,
                            stoppedEarly: true,
                            exhaustive: false,
                            completionReason: 'unchanged_boundary',
                            diagnostics: diagLog,
                            hitGoogleLimit: !!diagLog.hitGoogleLimit
                        };
                    }
                }
            }
            if (!res?.conversations || res.conversations.length === 0) {
                const isGoogleLimit = res?._debug?.bardError || res?._debug?.error === "BARD_ERROR_INFO";
                if (isGoogleLimit) {
                    diagLog.hitGoogleLimit = true;
                    diagLog.stopReason = `Google 服务端翻页到达极限 (BardErrorInfo: 游标链已达服务端上限)`;
                    stoppedEarly = true;
                    completionReason = 'hit_google_limit';
                } else if (res?._debug?.error === "NO_INNER_STR" || !Array.isArray(res?.conversations)) {
                    diagLog.stopReason = `第 ${i + 1} 页列表响应无法解析，不能确认历史已耗尽`;
                    stoppedEarly = true;
                    completionReason = 'error';
                } else {
                    diagLog.stopReason = `第 ${i + 1} 页返回 0 条数据，Google 服务端已无更早历史`;
                    completionReason = 'natural_exhaustion';
                }
                reachedMax = false;
                console.log(`[Gemini Exporter] getAllConversations reached end at page ${i + 1}, total: ${all.length}, reason: ${diagLog.stopReason}`);
                break;
            }
            if (onProgress) onProgress({
                page: i + 1,
                added,
                total: all.length,
                hasMore: !!res.nextPageToken,
                batch: res.conversations
            });
            if (!res.nextPageToken) {
                diagLog.stopReason = `第 ${i + 1} 页未返回下页游标 nextPageToken，Google 服务端游标已到底`;
                reachedMax = false;
                completionReason = 'natural_exhaustion';
                console.log(`[Gemini Exporter] getAllConversations finished at page ${i + 1}, total: ${all.length}, hitGoogleLimit: ${diagLog.hitGoogleLimit}`);
                break;
            }
            if (seenTokens.has(res.nextPageToken)) {
                diagLog.stopReason = `检测到 Google 服务端游标回环重复 (Token Loop)，提前安全终止同步 (已拉取 ${i + 1} 页，共 ${all.length} 条)`;
                console.warn(`[Gemini Exporter] getAllConversations token loop detected at page ${i + 1}`);
                reachedMax = false;
                stoppedEarly = true;
                completionReason = 'token_loop';
                break;
            }
            seenTokens.add(res.nextPageToken);
            token = res.nextPageToken;
            const pageDelay = incremental ? 50 : 120;
            await new Promise(r => setTimeout(r, pageDelay));
        }
        if (reachedMax) {
            diagLog.stopReason = `已达到最大页数限制 (${maxPages} 页)`;
            stoppedEarly = true;
            completionReason = 'max_pages';
        }
        diagLog.totalConversations = all.length;
        diagLog.endTime = new Date().toISOString();
        const isEarly = !!(stoppedEarly || interruptedByError || reachedMax || diagLog.hitGoogleLimit);
        const finalResult: PaginationResult = {
            conversations: all,
            total: all.length,
            diagnostics: diagLog,
            hitGoogleLimit: !!diagLog.hitGoogleLimit,
            exhaustive: !isEarly,
            completionReason: isEarly ? (completionReason === 'natural_exhaustion' ? 'hit_google_limit' : completionReason) : 'natural_exhaustion'
        };
        if (isEarly) {
            finalResult.stoppedEarly = true;
        }
        return finalResult;
    }

    async function getConversationDetail(client: GeminiPaginationDetailClient, conversationId: string, targetSid?: string | null): Promise<PaginatedDetailResult> {
        const pages: DetailParseResult[] = [];
        const seenTokens = new Set<string>();
        let token: string | null = null;
        let truncateReason: PaginatedDetailResult['transport']['truncateReason'];
        do {
            const page = await client.fetchConversationPage(conversationId, token, targetSid);
            if (!isResourceConversationParseResult(page)) throw new TypeError('Detail pagination requires native conversation results');
            pages.push(page);
            token = page.transport.nextPageToken;
            if (token && seenTokens.has(token)) { truncateReason = 'token_loop'; break; }
            if (token) seenTokens.add(token);
        } while (token && pages.length < 20);
        if (token && !truncateReason) truncateReason = 'max_turns_page_limit_20';
        const first = pages[0];
        if (!first) throw new Error('no data');
        const inner = first.transport.decodedPayload;
        const metadataOnly = !pages.some(page => page.conversation.messages.length) && Array.isArray(inner)
            && inner[0] === null && inner[1] === null && Array.isArray(inner[2])
            && typeof inner[2][0]?.[0] === 'string' && inner[2][0][0].startsWith('c_');
        if (metadataOnly) {
            try {
                const retry = await client.fetchConversationPage(conversationId, null, targetSid, { detailOnly: true, altParams: true });
                if (!isResourceConversationParseResult(retry)) throw new TypeError('Detail retry requires native conversation results');
                if (retry.conversation.messages.length) {
                    // The retry is a new detail chain; follow its real cursor before claiming completeness.
                    pages.push(retry);
                    seenTokens.clear();
                    truncateReason = undefined;
                    token = retry.transport.nextPageToken;
                    while (token && pages.length < 20) {
                        if (seenTokens.has(token)) { truncateReason = 'token_loop'; break; }
                        seenTokens.add(token);
                        const next = await client.fetchConversationPage(conversationId, token, targetSid, { detailOnly: true, altParams: true });
                        if (!isResourceConversationParseResult(next)) throw new TypeError('Detail pagination requires native conversation results');
                        pages.push(next);
                        token = next.transport.nextPageToken;
                    }
                    if (token && !truncateReason) truncateReason = 'max_turns_page_limit_20';
                }
            } catch (error: unknown) {
                if (pages.some(page => page.conversation.messages.length)) throw error;
                if (isDevMode()) console.warn('[Gemini Exporter Client] metadata-only retry failed:', getErrorMessage(error));
            }
        }
        const normalizedPages = pages.map(page => ({ ...page, conversation: { ...page.conversation, id: normId(page.conversation.id) } }));
        const result = mergeConversationPages(normalizedPages, truncateReason);
        const sourceTitle = pages.find(page => page.conversation.titleSource === 'rpc')?.conversation ?? first.conversation;
        result.conversation = { ...result.conversation, id: String(conversationId).replace(/^c_/, '').trim(),
            title: sourceTitle.title, titleSource: sourceTitle.titleSource, titles: { ...sourceTitle.titles } };
        const schemaDrift = [...new Set(pages.flatMap(page => page.transport.schemaDrift ?? []))];
        const turnsRejected = pages.reduce((sum, page) => sum + (page.transport.turnsRejected ?? 0), 0);
        return { ...result, transport: { ...first.transport, nextPageToken: null,
            ...(schemaDrift.length ? { schemaDrift } : {}), ...(turnsRejected ? { turnsRejected } : {}),
            ...(truncateReason ? { truncated: true, truncateReason } : {}) } };
    }

export {
    getAllConversations,
    getConversationDetail
};

export const GeminiClientPagination: GeminiClientPaginationModule = {
    getAllConversations,
    getConversationDetail,
    isPaginationExhaustive
};

export default GeminiClientPagination;
