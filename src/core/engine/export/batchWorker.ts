import { supplementLegacyGeneratedMedia } from '../../domain/legacyGeneratedMediaReconciliation.js';
import type { FetchBatchMessage } from '../../../types/messages.js';
import type {
    ChatMessage,
    Conversation,
    GeneratedMediaIdentity,
} from '../../../types/conversation.js';
import type { TabServiceModule } from '../../../types/utils.js';
import type { TakeoutExportSource } from '../../../types/ui.js';
import {
    normId as utilsNormId,
    shortScope as utilsShortScope,
    cleanTitle as utilsCleanTitle,
    unescapeHtml as utilsUnescapeHtml,
    stripHtmlTags as utilsStripHtmlTags,
    isRealTitle as utilsIsRealTitle,
    resolveTitle as utilsResolveTitle,
    cleanZeroWidth as utilsCleanZeroWidth,
    isBrandPlaceholderTitle as utilsIsBrandPlaceholderTitle,
    sanitizeFileName as utilsSanitizeFileName,
    normalizeReliableTitleSource as utilsNormalizeReliableTitleSource,
    getErrorMessage,
    type TitleResolution,
    type GeminiUtilsModule,
} from "../../utils/utils.js";
import { __resolveModule } from "../../utils/moduleOverrides.js";
import { I18n as I18nStatic } from "../../utils/i18n.js";
import { ChatFormatter } from "../chatFormatter.js";
import TabService from "../../utils/tabService.js";
import { getConversationDetail } from "../../storage/conversationDetailStore.js";
import { isConfirmedDeletedError } from "../../protocol/protocol.js";

type MessageSenderFunction = (
    message: unknown,
    callback?: (response: unknown) => void
) => Promise<unknown> | void;

interface TabServiceLike {
    sendToGeminiTab?: (msg: unknown, slot?: string, timeoutMs?: number) => Promise<unknown>;
}

interface FetchChatDetailOptions {
    messageSender?: MessageSenderFunction | null;
    tabService?: TabServiceModule | TabServiceLike | null;
}

/** Raw transport output is intentionally not normalized by BatchWorker. */
export type FetchChatDetailResult = unknown;

export type BatchWorkerRequestedItem = {
    id: string;
    title?: string;
    url?: string;
};

interface ResolveChatOptions {
    messageSender?: MessageSenderFunction | null;
}

export type ResolveChatResult = ({
    isError: true;
    chat: WorkerChat;
} | {
    isError: false;
    chat: WorkerChat & { id: string };
}) & {
    listTitle?: string;
    displayTitle?: string;
    isConfirmedDeleted: boolean;
    errMsg: string | null;
    convsNeedSave: boolean;
};

interface SupplementTakeoutMediaOptions {
    appendMarkdownRef?: boolean;
}

type TakeoutEngineSourceLike =
    | {
        getTakeoutOfflineChat?: (chatId: string, slot?: string | null) => unknown;
        getTakeoutMediaForChat?: (chatId: string, slot?: string | null) => unknown;
        }
    | {
        getTakeoutOfflineChat?: (chatId: string, slot?: string | null) => unknown;
        getTakeoutMediaForChat?: (chatId: string, slot?: string | null) => unknown;
        getTakeoutFallbackMedia?: (
            chatId: string,
            filenameOrId: string,
            slot?: string | null,
            generation?: GeneratedMediaIdentity
        ) => unknown;
    };

type WorkerListConversation = Partial<Conversation> | WorkerChat;

interface WorkerChatDebug {
    isNotFound?: unknown;
    error?: unknown;
    domDebug?: {
        isNotFound?: unknown;
        error?: unknown;
        } | null;
    batchexecuteEmptyDebug?: {
        isDeleted?: unknown;
        error?: unknown;
        } | null;
}

export interface WorkerMessageAttachment {
    type?: string;
    fileName?: string;
    localName?: string;
    contentMarkdown?: unknown;
    isGenerated?: boolean;
    providerRequestId?: string;
    imageOrdinal?: number;
    generation?: GeneratedMediaIdentity;
    url?: unknown;
    sourceUrl?: unknown;
    src?: unknown;
    sourceEvidence?: unknown;
    [key: string]: unknown;
}
export interface WorkerChatMessage {
    role?: unknown;
    content?: unknown;
    id?: string;
    timestamp?: unknown;
    turnId?: string;
    providerRequestId?: string;
    generation?: GeneratedMediaIdentity;
    attachments?: WorkerMessageAttachment[] | null;
    images?: WorkerMessageAttachment[] | null;
    documents?: WorkerMessageAttachment[] | null;
    [key: string]: unknown;
}

export interface WorkerChat {
    id?: string;
    title?: string;
    url?: string;
    error?: unknown;
    _empty?: unknown;
    isDeleted?: unknown;
    isEmpty?: unknown;
    messages?: WorkerChatMessage[] | null;
    turns?: unknown;
    titleSource?: unknown;
    titles?: unknown;
    _debug?: WorkerChatDebug | null;
    _raw?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
    timestamp?: unknown;
    attachmentCount?: unknown;
    truncated?: unknown;
    isTruncated?: unknown;
    truncateReason?: unknown;
    [key: string]: unknown;
}

/** Object-shaped candidate at the resolver boundary; fields are not validated here. */
export type WorkerChatResolveInput = Record<string, unknown>;

export interface BatchWorkerModule {
    fetchChatDetail: (
        requestedItem: BatchWorkerRequestedItem,
        currentIndex: number,
        totalChats: number,
        currentSlot: string,
        skip: boolean,
        format: string,
        abortSignal?: AbortSignal | null,
        options?: FetchChatDetailOptions
    ) => Promise<FetchChatDetailResult>;
    resolveChat: (
        chat: WorkerChatResolveInput,
        requestedItem: BatchWorkerRequestedItem,
        listConversation?: WorkerListConversation | null,
        takeoutEngine?: TakeoutExportSource | TakeoutEngineSourceLike | null,
        currentSlot?: string,
        onTitleUpdated?: (id: string, title: string, source: string) => void,
        onLog?: (msg: string, level?: string) => void,
        options?: ResolveChatOptions
    ) => Promise<ResolveChatResult>;
    supplementTakeoutGeneratedMedia: (
        chat: WorkerChat,
        nid: string,
        slot?: string,
        takeoutEngine?: TakeoutExportSource | TakeoutEngineSourceLike | null,
        options?: SupplementTakeoutMediaOptions
    ) => void;
    formatDebugInfo?: (debug: unknown) => string;
}

interface StorageServicePruner {
    removeConversation?: (slot: string, id: string) => Promise<unknown>;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalStrings(raw: Record<string, unknown>, keys: string[]): boolean {
    return keys.every(key => raw[key] === undefined || typeof raw[key] === 'string');
}
function optionalNumbers(raw: Record<string, unknown>, keys: string[]): boolean {
    return keys.every(key => raw[key] === undefined || typeof raw[key] === 'number');
}
function isGeneratedMediaIdentity(value: unknown): value is GeneratedMediaIdentity {
    return isObjectRecord(value) && typeof value.chatId === 'string'
        && typeof value.generationOrdinal === 'number'
        && optionalStrings(value, ['providerRequestId', 'prompt', 'turnId'])
        && optionalNumbers(value, ['imageCount', 'imageOrdinal'])
        && (value.time === undefined || value.time === null || typeof value.time === 'number');
}
function isWorkerAttachment(value: unknown): value is WorkerMessageAttachment {
    return isObjectRecord(value)
        && optionalStrings(value, ['type', 'fileName', 'localName', 'providerRequestId'])
        && optionalNumbers(value, ['imageOrdinal'])
        && (value.isGenerated === undefined || typeof value.isGenerated === 'boolean')
        && (value.generation === undefined || isGeneratedMediaIdentity(value.generation));
}
function isWorkerMessage(value: unknown): value is WorkerChatMessage {
    return isObjectRecord(value)
        && optionalStrings(value, ['id', 'turnId', 'providerRequestId'])
        && (value.generation === undefined || isGeneratedMediaIdentity(value.generation))
        && ['images', 'attachments', 'documents'].every(key =>
            value[key] === undefined || value[key] === null || (Array.isArray(value[key]) && value[key].every(isWorkerAttachment)));
}
function isWorkerDebug(value: unknown): value is WorkerChatDebug {
    return isObjectRecord(value) && ['domDebug', 'batchexecuteEmptyDebug'].every(key =>
        value[key] === undefined || value[key] === null || isObjectRecord(value[key]));
}
/** Validate only processing capabilities; return the same object and message list. */
export function isWorkerChat(value: unknown): value is WorkerChat {
    return isObjectRecord(value)
        && optionalStrings(value, ['id', 'title', 'url'])
        && (value.messages === undefined || value.messages === null || (Array.isArray(value.messages) && value.messages.every(isWorkerMessage)))
        && (value._debug === undefined || value._debug === null || isWorkerDebug(value._debug));
}

function extractRequestedId(item: unknown): string | number | null | undefined {
    if (isObjectRecord(item)) {
        const id = item.id;
        if (typeof id === 'string' || typeof id === 'number' || id === null) {
            return id;
        }
    }
    return undefined;
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

const fallbackUtils: GeminiUtilsModule | null = null;
const injectedUtils = (): GeminiUtilsModule | null => __resolveModule<GeminiUtilsModule | null>('GeminiUtils', fallbackUtils);

const normId = (id?: string | number | null): string => {
    const injected = injectedUtils();
    if (injected?.normId) {
        return injected.normId(id);
    }
    return utilsNormId(id);
};

const shortScope = (id?: string | number | null): string => {
    const injected = injectedUtils();
    if (injected?.shortScope) {
        return injected.shortScope(id);
    }
    return utilsShortScope(id);
};

const cleanTitle = (t?: string | null): string => {
    const injected = injectedUtils();
    if (injected?.cleanTitle) {
        return injected.cleanTitle(t);
    }
    return utilsCleanTitle(t);
};

const unescapeHtml = (t?: string | null): string => {
    const injected = injectedUtils();
    if (injected?.unescapeHtml) {
        return injected.unescapeHtml(t);
    }
    return utilsUnescapeHtml(t);
};

const stripHtmlTags = (t?: string | null): string => {
    const injected = injectedUtils();
    if (injected?.stripHtmlTags) {
        return injected.stripHtmlTags(t);
    }
    return utilsStripHtmlTags(t);
};

const isRealTitle = (t?: string | null, fallbackId?: string | number): boolean => {
    const injected = injectedUtils();
    if (injected?.isRealTitle) {
        return injected.isRealTitle(t, fallbackId);
    }
    return utilsIsRealTitle(t, fallbackId);
};

const resolveTitle = (chat?: Partial<Conversation> | null): TitleResolution => {
    const injected = injectedUtils();
    if (injected?.resolveTitle) {
        return injected.resolveTitle(chat);
    }
    return utilsResolveTitle(chat);
};

const cleanZeroWidth = (t?: unknown): string => {
    const injected = injectedUtils();
    if (injected?.cleanZeroWidth) {
        return injected.cleanZeroWidth(t);
    }
    return utilsCleanZeroWidth(t);
};

const isBrandPlaceholderTitle = (t?: unknown): boolean => {
    const injected = injectedUtils();
    if (injected?.isBrandPlaceholderTitle) {
        return injected.isBrandPlaceholderTitle(t);
    }
    return utilsIsBrandPlaceholderTitle(t);
};

async function fetchChatDetail(
    requestedItem: BatchWorkerRequestedItem,
    currentIndex: number,
    totalChats: number,
    currentSlot: string,
    skip: boolean,
    format: string,
    abortSignal?: AbortSignal | null,
    options: FetchChatDetailOptions = {}
): Promise<FetchChatDetailResult> {
    const nid = normId(extractRequestedId(requestedItem));
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

function supplementTakeoutGeneratedMedia(
    chat: WorkerChat,
    nid: string,
    slot: string = 'u0',
    takeoutEngine?: TakeoutExportSource | TakeoutEngineSourceLike | null,
    options: SupplementTakeoutMediaOptions = {}
): void {
    if (!takeoutEngine?.getTakeoutMediaForChat || !Array.isArray(chat.messages) || !chat.messages.length) return;
    const media = takeoutEngine.getTakeoutMediaForChat(nid, slot);
    if (Array.isArray(media)) supplementLegacyGeneratedMedia(chat, nid, media, options);
}

/** Shared acquisition policy: usable online data, then Takeout, then stored detail. */
export async function resolveConversationData(
    chat: WorkerChatResolveInput,
    nid: string,
    listConversation?: WorkerListConversation | null,
    takeoutEngine?: TakeoutExportSource | TakeoutEngineSourceLike | null,
    slot: string = 'u0',
    onLog: (msg: string, level?: string) => void = (() => {}),
): Promise<unknown> {
    const hasNoMessages = (messages: unknown): boolean => {
        if (!messages) return true;
        if (typeof messages === 'string') return messages.length === 0;
        if ((typeof messages === 'object' && messages !== null) || typeof messages === 'function') {
            return Reflect.get(messages, 'length') === 0;
        }
        return false;
    };
    if (chat.error || chat._empty || hasNoMessages(chat.messages)) {
        if (takeoutEngine && typeof takeoutEngine.getTakeoutOfflineChat === 'function') {
            const fbChat = takeoutEngine.getTakeoutOfflineChat(nid, slot);
            if (isObjectRecord(fbChat) && Array.isArray(fbChat.messages) && fbChat.messages.length > 0) {
                const fbTitle = typeof fbChat.title === 'string' ? fbChat.title : undefined;
                const chatTitle = typeof chat.title === 'string' ? chat.title : undefined;
                const recovered: Record<string, unknown> = {
                    ...fbChat,
                    id: nid,
                    title: isRealTitle(chatTitle, nid) ? chatTitle : fbTitle,
                    url: `https://gemini.google.com/app/${nid}`
                };
                delete recovered.error;
                delete recovered._empty;
                const I18n = __resolveModule('I18n', I18nStatic);
                onLog(I18n.t('logTakeoutChatRecovered', recovered.title || nid), 'info');
                return recovered;
            }
        }
        if (chat.error || chat._empty || hasNoMessages(chat.messages)) {
            try {
                const detail = await getConversationDetail(nid);
                if (detail && Array.isArray(detail.messages) && detail.messages.length > 0) {
                    const chatTitle = typeof chat.title === 'string' ? chat.title : undefined;
                    const recovered: Record<string, unknown> = {
                        ...(listConversation || {}),
                        id: nid,
                        title: isRealTitle(chatTitle, nid) ? chatTitle : (listConversation?.title || nid),
                        messages: detail.messages,
                        turns: detail.turns,
                        url: (listConversation && listConversation.url) || `https://gemini.google.com/app/${nid}`
                    };
                    delete recovered.error;
                    delete recovered._empty;
                    const I18n = __resolveModule('I18n', I18nStatic);
                    onLog(I18n.t('logTakeoutChatRecovered', recovered.title || nid), 'info');
                    return recovered;
                }
            } catch { /* intentional */ }
        }
    }

    return chat;
}

async function resolveChat(
    rawChat: WorkerChatResolveInput,
    requestedItem: BatchWorkerRequestedItem,
    listConversation?: WorkerListConversation | null,
    takeoutEngine?: TakeoutExportSource | TakeoutEngineSourceLike | null,
    currentSlot?: string,
    onTitleUpdated: (id: string, title: string, source: string) => void = (() => {}),
    onLog: (msg: string, level?: string) => void = (() => {}),
    options: ResolveChatOptions = {}
): Promise<ResolveChatResult> {
    const nid = normId(extractRequestedId(requestedItem));
    const slot = currentSlot || 'u0';
    let convsNeedSave = false;

    const resolved = await resolveConversationData(rawChat, nid, listConversation, takeoutEngine, slot, onLog);
    if (!isWorkerChat(resolved)) throw new TypeError('Malformed conversation for BatchWorker processing');
    let chat: WorkerChat = resolved;

    supplementTakeoutGeneratedMedia(chat, nid, slot, takeoutEngine);

    if (Array.isArray(chat.messages) && chat.messages.length > 0) {
        const scope = shortScope(nid);
        for (let mi = 0; mi < chat.messages.length; mi++) {
            const m = chat.messages[mi];
            if (!m || m.role !== 'model' || !m.content || typeof m.content !== 'string') continue;

            const hasExistingDoc = Boolean(
                (m.attachments && m.attachments.some((a) => a.type === 'file' && Boolean(a.contentMarkdown))) ||
                (m.documents && m.documents.some((d) => Boolean(d.contentMarkdown)))
            );
            if (hasExistingDoc) continue;

            const isHtmlReport = /<h1[^>]*>/i.test(m.content) && m.content.length > 3000;
            const isMdReport = /(?:^|\n)#\s+[^\n]+/m.test(m.content) && m.content.length > 3000;

            if (isHtmlReport || isMdReport) {
                let docTitle = '';
                let docMarkdown = '';

                if (isHtmlReport) {
                    const h1Match = m.content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
                    if (h1Match && h1Match[1]) {
                        docTitle = cleanTitle(stripHtmlTags(unescapeHtml(h1Match[1])));
                    }
                    const convHtml = ChatFormatter.convertHtmlToMarkdown;
                    docMarkdown = convHtml ? convHtml(m.content) : m.content.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match: string, lvl: string, txt: string) => `\n${'#'.repeat(parseInt(lvl, 10))} ${txt.trim()}\n`);
                } else {
                    const h1Match = m.content.match(/(?:^|\n)#\s+([^\n]+)/);
                    if (h1Match && h1Match[1]) {
                        docTitle = cleanTitle(h1Match[1]);
                    }
                    docMarkdown = m.content;
                }

                if (!docTitle) docTitle = 'Deep Research Report';
                const safeDocTitle = utilsSanitizeFileName(docTitle, 'report').slice(0, 60);
                const localName = `files/${scope}${safeDocTitle}.md`;

                if (!docMarkdown.trim().startsWith('#')) {
                    docMarkdown = `# ${docTitle}\n\n${docMarkdown.trim()}`;
                }

                const docObj = {
                    type: 'file',
                    id: `${nid}_doc_${mi + 1}`,
                    title: docTitle,
                    name: `${safeDocTitle}.md`,
                    localName,
                    contentMarkdown: docMarkdown,
                    source: 'extracted-report'
                };

                m.documents = m.documents || [];
                m.attachments = m.attachments || [];
                m.documents.push(docObj);
                m.attachments.push(docObj);
            }
        }
    }

    if (chat.error || chat._empty) {
        const isConfirmedDeleted = Boolean(
            chat.isDeleted
            || chat._debug?.isNotFound
            || chat._debug?.domDebug?.isNotFound
            || chat._debug?.batchexecuteEmptyDebug?.isDeleted
            || isConfirmedDeletedError(chat.error)
            || isConfirmedDeletedError(chat._debug?.batchexecuteEmptyDebug?.error)
        );

        const rawTitle = chat.title || nid;
        const cleanedTitle = cleanZeroWidth(rawTitle);
        const displayTitle = !isBrandPlaceholderTitle(rawTitle) && cleanedTitle ? cleanedTitle : nid;
        const I18n = __resolveModule('I18n', I18nStatic);

        if (isConfirmedDeleted) {
            try {
                let fallbackStorage: StorageServicePruner | null = null;
                if (typeof window !== 'undefined' && isObjectRecord(window) && 'StorageService' in window) {
                    const rawStorage = window.StorageService;
                    if (isObjectRecord(rawStorage) && typeof rawStorage.removeConversation === 'function') {
                        const removeFn = rawStorage.removeConversation;
                        fallbackStorage = {
                            removeConversation: (slot: string, id: string) => Promise.resolve(removeFn.call(rawStorage, slot, id))
                        };
                    }
                }
                const storage = __resolveModule<StorageServicePruner | null>('StorageService', fallbackStorage);
                if (storage && typeof storage.removeConversation === 'function') {
                    await storage.removeConversation(currentSlot || 'u0', nid);
                    const sender: MessageSenderFunction | null = options.messageSender || resolveRuntimeSender();
                    if (sender) {
                        const p = sender({ action: 'syncUpdate', slot: currentSlot || 'u0', count: -1, from: 'export-prune-deleted' });
                        if (p) {
                            void Promise.resolve(p).catch(() => {});
                        }
                    }
                }
            } catch (e: unknown) {
                if (typeof console !== 'undefined' && typeof console.debug === 'function') console.debug('[GemExporter:batchWorker.ts]', e);
            }
            onLog(I18n.t('logChatDeletedAndPruned', displayTitle), 'warn');

            return {
                chat,
                displayTitle,
                isConfirmedDeleted: true,
                isError: true,
                errMsg: I18n.t('logChatDeletedAndPruned', displayTitle),
                convsNeedSave: false
            };
        }

        const hasNoMessages = !chat.messages || (Array.isArray(chat.messages) && chat.messages.length === 0);
        const isFatalError = typeof chat.error === 'string' && (
            chat.error.includes('429') ||
            chat.error.includes('401') ||
            chat.error.includes('403') ||
            chat.error.includes('500') ||
            chat.error.includes('502') ||
            chat.error.includes('503') ||
            chat.error.includes('NetworkError') ||
            chat.error.includes('Failed to fetch') ||
            chat.error.includes('超时') ||
            chat.error.includes('timeout') ||
            chat.error.includes('抓取异常')
        );

        if (!isFatalError && hasNoMessages) {
            delete chat.error;
            delete chat._empty;
            chat.messages = [];
            chat.isEmpty = true;
            onLog(I18n.t('logEmptyChatExported', displayTitle), 'info');
        } else {
            const debugInfo = formatDebugInfo(chat._debug) || (chat._raw ? ` _raw_len=${JSON.stringify(chat._raw).length}` : '');
            const errMsg = (chat.error || '云端返回内容为空（服务端未返回任何消息，可能为限频、对话已被清空/归档或新格式未兼容）') + debugInfo;
            onLog(I18n.t('logExportSkipped', displayTitle, errMsg), 'error');

            return {
                chat,
                displayTitle,
                isConfirmedDeleted: false,
                isError: true,
                errMsg,
                convsNeedSave: false
            };
        }
    }

    if (!isRealTitle(chat.title, chat.id) && Array.isArray(chat.messages)) {
        const firstUser = chat.messages.find((m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim());
        if (firstUser && typeof firstUser.content === 'string') {
            let candidate = firstUser.content.trim();
            candidate = candidate.replace(/^(请问一下|请问|我想问一下|我想问|你能帮我|帮我|你能|请教一下|请教|都说|那么|那个|如果说|如果|我发现|为什么)\s*[,，:：]?\s*/i, '');
            const breakMatch = candidate.match(/^([^，。？！\n\r\t,?!]{4,35})/);
            if (breakMatch && breakMatch[1]) {
                candidate = breakMatch[1].trim();
            } else {
                candidate = candidate.slice(0, 30).trim();
            }
            if (isRealTitle(candidate, chat.id)) {
                chat.title = candidate;
                chat.titleSource = 'sniff';
                const currentTitles = isObjectRecord(chat.titles) ? chat.titles : {};
                currentTitles.sniff = candidate;
                chat.titles = currentTitles;
            }
        }
    }

    let finalTitle = chat.title || listConversation?.title || chat.id;

    if (listConversation) {
        const rawListTitles = isObjectRecord(listConversation.titles) ? listConversation.titles : {};
        const titlesRecord: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(rawListTitles)) {
            if (typeof v === 'string' && !isBrandPlaceholderTitle(v) && (utilsNormalizeReliableTitleSource(k) || k === 'legacy')) {
                titlesRecord[k] = v;
            }
        }
        if (isObjectRecord(chat.titles)) {
            for (const [k, v] of Object.entries(chat.titles)) {
                const reliableK = utilsNormalizeReliableTitleSource(k);
                if (reliableK && typeof v === 'string' && !isBrandPlaceholderTitle(v)) {
                    titlesRecord[reliableK] = v;
                }
            }
        }
        const reliableChatSource = utilsNormalizeReliableTitleSource(typeof chat.titleSource === 'string' ? chat.titleSource : undefined);
        if (reliableChatSource && isRealTitle(chat.title, chat.id) && chat.title !== chat.id) {
            titlesRecord[reliableChatSource] = cleanTitle(chat.title);
        }
        listConversation.titles = titlesRecord;
        const resolutionInput = {
            id: listConversation.id,
            title: typeof listConversation.title === 'string' ? listConversation.title : undefined,
            titleSource: typeof listConversation.titleSource === 'string' ? listConversation.titleSource : undefined,
            titles: titlesRecord
        };
        const resolved = resolveTitle(resolutionInput);
        const cleanResolved = cleanZeroWidth(resolved.title);
        if (resolved.title && /^(Google\s+)?(Gemini|Bard|Google\s+AI)$/i.test(cleanResolved)) {
            if (typeof console !== 'undefined' && typeof console.warn === 'function') {
                console.warn('[Export] skip bad brand resolved title', nid, resolved.title);
            }
        } else if (listConversation.title !== resolved.title || listConversation.titleSource !== resolved.source) {
            listConversation.title = resolved.title;
            listConversation.titleSource = resolved.source;
            convsNeedSave = true;
            onTitleUpdated(nid, listConversation.title, typeof listConversation.titleSource === 'string' ? listConversation.titleSource : (resolved.source || ''));
        }
        finalTitle = (typeof listConversation.title === 'string' ? listConversation.title : '') || finalTitle;
    } else if (isRealTitle(chat.title, chat.id)) {
        finalTitle = cleanTitle(chat.title);
    }
    chat.title = finalTitle;
    const successfulChat = Object.assign(chat, { id: typeof chat.id === 'string' ? chat.id : nid });

    return {
        chat: successfulChat,
        listTitle: finalTitle,
        isConfirmedDeleted: false,
        isError: false,
        errMsg: null,
        convsNeedSave
    };
}

function formatDebugInfo(debug: unknown): string {
    if (!debug) return '';
    if (typeof debug === 'string') return ` ${debug.slice(0, 300)}`;
    if (!isObjectRecord(debug)) return '';
    try {
        const be = isObjectRecord(debug.batchexecuteEmptyDebug) ? debug.batchexecuteEmptyDebug : null;
        if (be && typeof be.error === 'string') {
            return ` (RPC: ${be.error})`;
        }
        if (typeof debug.error === 'string') {
            return ` (${debug.error})`;
        }
        const dom = isObjectRecord(debug.domDebug) ? debug.domDebug : null;
        if (dom && typeof dom.error === 'string') {
            return ` (DOM: ${dom.error})`;
        }
        const simplified: Record<string, unknown> = {};
        for (const k of Object.keys(debug)) {
            if (k === 'rawPreview' || k === 'topPreview') continue;
            simplified[k] = debug[k];
        }
        const str = JSON.stringify(simplified);
        return str && str !== '{}' ? ` ${str.slice(0, 300)}` : '';
    } catch {
        return '';
    }
}

export {
    fetchChatDetail,
    resolveChat,
    supplementTakeoutGeneratedMedia,
    formatDebugInfo
};

export const BatchWorker: BatchWorkerModule = {
    fetchChatDetail,
    resolveChat,
    supplementTakeoutGeneratedMedia,
    formatDebugInfo
};

export default BatchWorker;
