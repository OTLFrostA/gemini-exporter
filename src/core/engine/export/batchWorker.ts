import { getDomainConversationResult } from '../../storage/domain/nativePersistence.js';
import { isResourceConversationParseResult, type ResourceConversationParseResult } from '../../parsers/parsingResult.js';
import type { FetchBatchMessage } from '../../../types/messages.js';
import type { Conversation } from '../../../types/conversation.js';
import type { TabServiceModule } from '../../../types/utils.js';
import type { TakeoutExportSource } from '../../../types/ui.js';
import type { AssetPipelineItem } from '../assetPipeline.js';
import { normalizeReliableTitleSource } from '../../utils/titleUtils.js';
import { normId, cleanTitle, isRealTitle, resolveTitle, getErrorMessage } from '../../utils/utils.js';
import { __resolveModule } from '../../utils/moduleOverrides.js';
import TabService from '../../utils/tabService.js';
import { isConfirmedDeletedError } from '../../protocol/protocol.js';

type MessageSenderFunction = (message: unknown, callback?: (response: unknown) => void) => Promise<unknown> | void;
interface TabServiceLike { sendToGeminiTab?: (message: unknown, slot?: string, timeoutMs?: number) => Promise<unknown> }
interface FetchChatDetailOptions { messageSender?: MessageSenderFunction | null; tabService?: TabServiceModule | TabServiceLike | null }
export type FetchChatDetailResult = unknown;
export type BatchWorkerRequestedItem = { id: string; title?: string; url?: string };
export type WorkerChat = ResourceConversationParseResult;
export type WorkerChatResolveInput = unknown;
export type WorkerMessageAttachment = AssetPipelineItem;
export type ResolveChatResult = {
    isError: false; chat: ResourceConversationParseResult; listTitle: string;
    isConfirmedDeleted: false; errMsg: null; convsNeedSave: boolean;
} | { isError: true; displayTitle: string; isConfirmedDeleted: boolean; errMsg: string; convsNeedSave: false };
interface ResolveChatOptions { messageSender?: MessageSenderFunction | null }
interface TakeoutEngineSourceLike { getTakeoutOfflineChat?: (id: string, slot?: string | null) => unknown }
function isObjectRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function resolveRuntimeSender(): MessageSenderFunction | null {
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        return (message: unknown, callback?: (response: unknown) => void) => {
            if (callback) {
                chrome.runtime.sendMessage(message, callback);
            } else {
                return chrome.runtime.sendMessage(message);
            }
        };
    }
    return null;
}
export async function fetchChatDetail(
    requestedItem: BatchWorkerRequestedItem,
    currentIndex: number,
    totalChats: number,
    currentSlot: string,
    skip: boolean,
    format: string,
    abortSignal?: AbortSignal | null,
    options: FetchChatDetailOptions = {}
): Promise<FetchChatDetailResult> {
    const nid = normId(requestedItem.id);
    const messageSender = options.messageSender || null;
    const tabService = options.tabService || __resolveModule<TabServiceModule | TabServiceLike>('TabService', TabService);

    return new Promise<FetchChatDetailResult>((resolve) => {
        let settled = false;
        const onAbort = () => {
            if (!settled) {
                settled = true;
                resolve({ success: false, error: 'aborted' });
            }
        };
        if (abortSignal) {
            if (abortSignal.aborted) return onAbort();
            abortSignal.addEventListener('abort', onAbort, { once: true });
        }

        const runFetch = async (): Promise<void> => {
            try {
                if (tabService && typeof tabService.sendToGeminiTab === 'function') {
                    const directRes = await tabService.sendToGeminiTab({
                        action: 'getConversationDetail',
                        conversationId: nid,
                        accountSlot: currentSlot
                    }, currentSlot);
                    if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
                    if (!settled) {
                        if (isObjectRecord(directRes) && directRes.success) {
                            settled = true;
                            const chat = directRes.data || directRes.chat || directRes;
                            resolve({ success: true, results: [chat], skipped: 0 });
                            return;
                        } else if (isObjectRecord(directRes) && directRes.error) {
                            settled = true;
                            resolve(directRes);
                            return;
                        } else if (directRes !== null && directRes !== undefined) {
                            settled = true;
                            resolve({ success: false, error: 'Malformed direct response envelope', rawResponse: directRes });
                            return;
                        }
                    }
                }
            } catch (directErr: unknown) {
                if (getErrorMessage(directErr).includes('aborted')) {
                    if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
                    if (!settled) { settled = true; resolve({ success: false, error: 'aborted' }); }
                    return;
                }
            }

            const sender: MessageSenderFunction | null = messageSender || resolveRuntimeSender();

            if (sender) {
                const msg: FetchBatchMessage = {
                    action: 'fetchBatch',
                    ids: [requestedItem],
                    format,
                    skipExported: skip,
                    globalOffset: currentIndex,
                    globalTotal: totalChats,
                    accountSlot: currentSlot
                };
                try {
                    void sender(msg, (response: unknown) => {
                        if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
                        if (!settled) {
                            settled = true;
                            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
                                resolve({ success: false, error: chrome.runtime.lastError.message });
                            } else {
                                resolve(response);
                            }
                        }
                    });
                } catch (sendErr: unknown) {
                    if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
                    if (!settled) {
                        settled = true;
                        resolve({ success: false, error: getErrorMessage(sendErr) });
                    }
                }
            } else {
                if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
                if (!settled) {
                    settled = true;
                    resolve({ success: false, error: 'chrome.runtime not available' });
                }
            }
        };

        void runFetch();
    });
}

/** Resolve source or durable Domain bodies; historical strings are never export inputs. */
export async function resolveConversationData(value: unknown, id: string, _list?: Partial<Conversation> | null,
    takeout?: TakeoutExportSource | TakeoutEngineSourceLike | null, slot = 'u0', onLog: (message: string, level?: string) => void = () => {}): Promise<unknown> {
    if (isResourceConversationParseResult(value) && value.conversation.messages.length) return value;
    const offline = takeout?.getTakeoutOfflineChat?.(id, slot);
    if (isResourceConversationParseResult(offline) && offline.conversation.messages.length) { onLog('[Takeout] Recovered ' + id, 'info'); return offline; }
    const stored = await getDomainConversationResult(slot, id);
    return stored?.conversation.messages.length ? stored : value;
}

export async function resolveChat(value: unknown, requested: BatchWorkerRequestedItem, list?: Partial<Conversation> | null,
    takeout?: TakeoutExportSource | TakeoutEngineSourceLike | null, slot = 'u0',
    onTitleUpdated: (id: string, title: string, source: string) => void = () => {},
    onLog: (message: string, level?: string) => void = () => {}, options: ResolveChatOptions = {}): Promise<ResolveChatResult> {
    const id = normId(requested.id);
    const result = await resolveConversationData(value, id, list, takeout, slot, onLog);
    if (!isResourceConversationParseResult(result) || !result.conversation.messages.length) {
        const raw = isObjectRecord(result) ? result : {};
        const error = typeof raw.error === 'string' ? raw.error : 'Conversation body is unavailable; fetch or migrate its source before exporting';
        const deleted = raw.isDeleted === true || isConfirmedDeletedError(error);
        if (deleted) {
            const storage = __resolveModule<{ removeConversation?: (slot: string, id: string) => Promise<unknown> } | null>('StorageService', null);
            await storage?.removeConversation?.(slot, id);
            const sender = options.messageSender || resolveRuntimeSender();
            const sent = sender?.({ action: 'syncUpdate', slot, count: -1, from: 'export-prune-deleted' });
            if (sent) void Promise.resolve(sent).catch(() => {});
        }
        return { isError: true, displayTitle: requested.title || id, isConfirmedDeleted: deleted, errMsg: error, convsNeedSave: false };
    }
    const domain = result.conversation;
    const titles = { ...list?.titles, ...domain.titles };
    if (domain.titleSource && isRealTitle(domain.title, id)) titles[domain.titleSource] = cleanTitle(domain.title);
    const resolved = resolveTitle({ id, title: list?.title || domain.title, titleSource: list?.titleSource || domain.titleSource, titles });
    const title = resolved.title || domain.title || requested.title || id;
    const source = resolved.source || domain.titleSource;
    const storedTitles = Object.fromEntries(Object.entries(titles).flatMap(([key, value]) => {
        const reliable = normalizeReliableTitleSource(key);
        return reliable ? [[reliable, value]] : [];
    }));
    const changed = !!list && (list.title !== title || list.titleSource !== source || JSON.stringify(list.titles) !== JSON.stringify(storedTitles));
    if (changed && list) { list.title = title; list.titleSource = normalizeReliableTitleSource(source); list.titles = storedTitles; onTitleUpdated(id, title, source || ''); }
    return { isError: false, chat: { ...result, conversation: { ...domain, title, titleSource: source, titles } },
        listTitle: title, isConfirmedDeleted: false, errMsg: null, convsNeedSave: changed };
}
export const isWorkerChat = isResourceConversationParseResult;
export function formatDebugInfo(debug: unknown): string {
    if (!debug) return '';
    if (typeof debug === 'string') return ` ${debug.slice(0, 300)}`;
    if (!isObjectRecord(debug)) return '';
    try {
        const rpc = isObjectRecord(debug.batchexecuteEmptyDebug) ? debug.batchexecuteEmptyDebug : null;
        if (rpc && typeof rpc.error === 'string') return ` (RPC: ${rpc.error})`;
        if (typeof debug.error === 'string') return ` (${debug.error})`;
        const dom = isObjectRecord(debug.domDebug) ? debug.domDebug : null;
        if (dom && typeof dom.error === 'string') return ` (DOM: ${dom.error})`;
        const simplified = Object.fromEntries(Object.entries(debug).filter(([key]) => key !== 'rawPreview' && key !== 'topPreview'));
        const text = JSON.stringify(simplified);
        return text !== '{}' ? ` ${text.slice(0, 300)}` : '';
    } catch { return ''; }
}
export const BatchWorker = { fetchChatDetail, resolveChat, formatDebugInfo };
export type BatchWorkerModule = typeof BatchWorker;
export default BatchWorker;
