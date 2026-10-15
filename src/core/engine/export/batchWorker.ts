import { StorageService } from '../../storage/storageService.js';
import { selectConversationBody, withConversationMetadata } from '../../domain/runtimeValidation.js';
import { isResourceConversationParseResult, type ResourceConversationParseResult, type NativeConversationInput } from '../../parsers/parsingResult.js';
import { requestNativeDetail, requestNativeBatch, type NativeBatchReply } from '../../utils/nativeDetailTransport.js';
import type { FetchBatchMessage } from '../../../types/messages.js';
import type { DomainConversationIndex } from '../../../types/conversation.js';
import type { TabServiceModule } from '../../../types/utils.js';
import type { TakeoutExportSource } from '../../../types/ui.js';
import { normId, getErrorMessage } from '../../utils/utils.js';
import { __resolveModule } from '../../utils/moduleOverrides.js';
import TabService from '../../utils/tabService.js';
import { isConfirmedDeletedError } from '../../protocol/protocol.js';

type MessageSenderFunction = (message: unknown, callback?: (response: unknown) => void) => Promise<unknown> | void;
interface TabServiceLike { sendToGeminiTab?: (message: unknown, slot?: string, timeoutMs?: number) => Promise<unknown> }
interface FetchChatDetailOptions { messageSender?: MessageSenderFunction | null; tabService?: TabServiceModule | TabServiceLike | null }
export type FetchChatDetailResult = NativeBatchReply;
export type ResolvedConversationSource = 'online' | 'takeout' | 'local_snapshot' | 'unspecified';
export type BatchWorkerRequestedItem = { id: string; title?: string; url?: string; cloudAvailability?: DomainConversationIndex['cloudAvailability'] };
export type WorkerChat = ResourceConversationParseResult;
export type WorkerChatResolveInput = NativeConversationInput;
export type ResolveChatResult = {
    isError: false; chat: ResourceConversationParseResult; source: ResolvedConversationSource;
    isConfirmedDeleted: false; errMsg: null;
} | { isError: true; displayTitle: string; isConfirmedDeleted: boolean; errMsg: string };
interface ResolveChatOptions { messageSender?: MessageSenderFunction | null; source?: ResolvedConversationSource }
interface TakeoutEngineSourceLike { getTakeoutOfflineChat?: (id: string, slot?: string | null) => ResourceConversationParseResult | null }
function isObjectRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
async function readSavedConversation(slot: string, id: string): Promise<ResourceConversationParseResult | null> {
    const stored = await StorageService.conversationRepository({ providerId: 'gemini', accountSlot: slot }).getConversation(id);
    if (!stored?.detail) return null;
    if (!stored.capture) throw new TypeError('Saved body is missing capture evidence');
    return { conversation: withConversationMetadata(stored.detail, stored.index),
        ...(stored.capture.savedAt !== undefined ? { sourceVersion: stored.capture.savedAt } : {}), diagnostics: [], resourceHints: {},
        acquisitionHints: stored.capture.acquisitionHints };
}
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
    if (abortSignal?.aborted) return { success: false, error: 'aborted' };
    if (requestedItem.cloudAvailability === 'deleted') {
        const stored = await readSavedConversation(currentSlot, nid);
        if (stored?.conversation.messages.length) return { success: true, results: [stored], source: 'local-cache' };
    }
    if (requestedItem.cloudAvailability === 'deleted') {
        // Do not fetch a resource already authoritatively deleted. Resolution below
        // recovers Domain / Takeout bodies and reports metadata-only failures.
        return { success: true, results: [{ id: nid, isDeleted: true, error: 'Cloud conversation deleted; local metadata has no recoverable body' }] };
    }
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
                    let directMissing = false;
                    const directRes = await requestNativeDetail(async () => { const reply = await tabService.sendToGeminiTab!({
                        action: 'getConversationDetail',
                        conversationId: nid,
                        accountSlot: currentSlot
                    }, currentSlot); directMissing = reply === null || reply === undefined; return reply; });
                    if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
                    if (!settled && !directMissing) {
                        if (isObjectRecord(directRes) && directRes.success) {
                            settled = true;
                            const chat = directRes.data ?? directRes.chat;
                            resolve({ success: true, results: [chat], skipped: 0 });
                            return;
                        } else if (isObjectRecord(directRes) && directRes.error) {
                            settled = true;
                            resolve({ success: false, error: directRes.error || 'Detail fetch failed', rawResponse: directRes.rawResponse, retryAfterMs: directRes.retryAfterMs, _debug: directRes._debug, _raw: directRes._raw });
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
                                resolve({ success: false, error: chrome.runtime.lastError.message || 'Runtime request failed' });
                            } else {
                                void requestNativeBatch(async () => response).then(resolve);
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
export async function resolveConversationData(value: NativeConversationInput, id: string, _list?: DomainConversationIndex | null,
    takeout?: TakeoutExportSource | TakeoutEngineSourceLike | null, slot = 'u0', onLog: (message: string, level?: string) => void = () => {}, source: ResolvedConversationSource = 'unspecified'): Promise<{ result: NativeConversationInput; source: ResolvedConversationSource }> {
    if (isResourceConversationParseResult(value) && value.conversation.messages.length) return { result: value, source };
    const offline = takeout?.getTakeoutOfflineChat?.(id, slot);
    if (isResourceConversationParseResult(offline) && offline.conversation.messages.length) {
        onLog('[Takeout] Recovered ' + id, 'info');
        return { result: offline, source: 'takeout' };
    }
    const stored = await readSavedConversation(slot, id);
    if (stored?.conversation.messages.length) {
        onLog(`Exporting local snapshot: ${id}; latest cloud content was not fetched.`, 'warn');
        return { result: stored, source: 'local_snapshot' };
    }
    return { result: value, source };
}

export async function resolveChat(value: NativeConversationInput, requested: BatchWorkerRequestedItem, list?: DomainConversationIndex | null,
    takeout?: TakeoutExportSource | TakeoutEngineSourceLike | null, slot = 'u0',
    onTitleUpdated: (id: string, title: string, source: string) => void = () => {},
    onLog: (message: string, level?: string) => void = () => {}, options: ResolveChatOptions = {}): Promise<ResolveChatResult> {
    const id = normId(requested.id);
    const evidence = value && !isResourceConversationParseResult(value) ? value : undefined;
    const confirmedDeleted = evidence?.isDeleted === true || isConfirmedDeletedError(evidence?.error);
    if (confirmedDeleted) {
        requested.cloudAvailability = 'deleted';
        if (list) list.cloudAvailability = 'deleted';
        const storage = __resolveModule<Partial<Pick<typeof StorageService, 'updateConversation'>>>('StorageService', StorageService);
        try {
            await storage?.updateConversation?.(slot, id, { cloudAvailability: 'deleted' });
            const pending = (options.messageSender || resolveRuntimeSender())?.({ action: 'syncUpdate', slot, from: 'cloud-deleted-archive-retained' });
            if (pending) void Promise.resolve(pending).catch(() => {});
        } catch (error) { onLog(`Could not save cloud availability: ${getErrorMessage(error)}. Local archive retained.`, 'warn'); }
    }
    const { result, source: dataSource } = await resolveConversationData(value, id, list, takeout, slot, onLog, options.source);
    if (!isResourceConversationParseResult(result) || !result.conversation.messages.length) {
        const raw = result && !isResourceConversationParseResult(result) ? result : undefined;
        const error = typeof raw?.error === 'string' ? raw.error : 'Conversation body is unavailable; fetch or migrate its source before exporting';
        const deleted = raw?.isDeleted === true || isConfirmedDeletedError(error);
        if (deleted) {
            onLog(`Cloud conversation deleted: ${requested.title || id}. Local archive retained; no conversation body is available.`, 'warn');
        }
        return { isError: true, displayTitle: requested.title || id, isConfirmedDeleted: deleted, errMsg: error };
    }
    const cached = dataSource === 'local_snapshot' || dataSource === 'takeout';
    const accepted = dataSource === 'takeout' ? await readSavedConversation(slot, id)
        : cached ? result : await StorageService.ingestConversation(slot, result);
    if (!accepted) return { isError: true, displayTitle: requested.title || id,
        isConfirmedDeleted: false, errMsg: 'Local conversation is no longer catalogued' };
    const canonical = await StorageService.conversationRepository({ providerId: accepted.conversation.providerId, accountSlot: slot }).getConversationIndex(accepted.conversation.id);
    if (!canonical) return { isError: true, displayTitle: requested.title || id,
        isConfirmedDeleted: false, errMsg: 'Local conversation is no longer catalogued' };
    if (confirmedDeleted) canonical.cloudAvailability = 'deleted';
    if (list) Object.assign(list, canonical);
    if (!cached) onTitleUpdated(id, canonical.title, canonical.titleSource);
    return { isError: false, chat: { ...result, ...accepted, sourceVersion: accepted.sourceVersion, diagnostics: result.diagnostics, resourceHints: result.resourceHints,
        acquisitionHints: { ...accepted.acquisitionHints, ...result.acquisitionHints }, conversation: withConversationMetadata(selectConversationBody(accepted.conversation), canonical) }, source: dataSource,
        isConfirmedDeleted: false, errMsg: null };
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
