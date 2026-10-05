import { findGenerationModelMessage, hasGenerationImage } from '../generatedMediaIdentity.js';
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

export type MessageSenderFunction = (
    message: unknown,
    callback?: (response: unknown) => void
) => Promise<unknown> | void;

export interface TabServiceLike {
    sendToGeminiTab?: (msg: unknown, slot?: string, timeoutMs?: number) => Promise<unknown>;
}

export interface FetchChatDetailOptions {
    messageSender?: MessageSenderFunction | null;
    tabService?: TabServiceModule | TabServiceLike | null;
}

export interface FetchChatDetailResult {
    success: boolean;
    results?: WorkerChat[];
    chat?: WorkerChat;
    data?: unknown;
    skipped?: number;
    error?: string;
    status?: number;
    rawResponse?: unknown;
    [key: string]: unknown;
}

export type BatchWorkerRequestedItem =
    | string
    | {
        id: string;
        title?: string;
        url?: string;
        [key: string]: unknown;
    };

export interface ResolveChatOptions {
    messageSender?: MessageSenderFunction | null;
    [key: string]: unknown;
}

export interface ResolveChatResult {
    chat: WorkerChat;
    listTitle?: string;
    displayTitle?: string;
    isConfirmedDeleted: boolean;
    isError: boolean;
    errMsg: string | null;
    convsNeedSave: boolean;
}

export interface SupplementTakeoutMediaOptions {
    appendMarkdownRef?: boolean;
}

export type TakeoutEngineSourceLike =
    | {
        getTakeoutOfflineChat?: (chatId: string, slot?: string | null) => unknown;
        getTakeoutMediaForChat?: (chatId: string, slot?: string | null) => unknown;
        [key: string]: unknown;
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

export type WorkerListConversation = Partial<Conversation> | WorkerChat;

interface WorkerChatDebug {
    isNotFound?: boolean;
    error?: string;
    domDebug?: {
        isNotFound?: boolean;
        error?: string;
        [key: string]: unknown;
    } | null;
    batchexecuteEmptyDebug?: {
        isDeleted?: boolean;
        error?: string;
        [key: string]: unknown;
    } | null;
    [key: string]: unknown;
}

export interface WorkerMessageAttachment {
    url?: string;
    sourceUrl?: string;
    resolvedUrl?: string;
    src?: string;
    localName?: string;
    fileName?: string;
    name?: string;
    title?: string;
    mimeType?: string;
    mime?: string;
    size?: number;
    width?: number;
    height?: number;
    token?: unknown;
    source?: string;
    subDir?: string;
    isGenerated?: boolean;
    providerRequestId?: string;
    imageOrdinal?: number;
    generation?: GeneratedMediaIdentity;
    type?: string;
    isImage?: boolean;
    dataBuffer?: ArrayBuffer | ArrayBufferView | number[];
    blobBase64?: string;
    dataBase64?: string;
    contentMarkdown?: string;
    failureReason?: string;
    candidates?: string[];
    id?: string;
    [key: string]: unknown;
}

export interface WorkerChatMessage extends Omit<ChatMessage, 'role' | 'content' | 'thoughts' | 'thinking' | 'timestamp' | 'attachments' | 'images' | 'documents' | 'citations' | 'groundingCitationMarkers'> {
    role?: string;
    content?: unknown;
    timestamp?: number | string | null;
    thoughts?: unknown;
    thinking?: unknown;
    citations?: unknown[];
    groundingCitationMarkers?: unknown[];
    attachments?: WorkerMessageAttachment[];
    images?: WorkerMessageAttachment[];
    documents?: WorkerMessageAttachment[];
    [key: string]: unknown;
}

export interface WorkerChat extends Omit<Partial<Conversation>, 'messages' | 'turns' | 'updatedAt' | 'createdAt' | 'chatTime' | 'lastSeen' | 'titleSource' | 'titles' | 'timestamp'> {
    error?: string;
    _empty?: boolean;
    isDeleted?: boolean;
    isEmpty?: boolean;
    messages?: WorkerChatMessage[];
    turns?: unknown[];
    timestamp?: unknown;
    updatedAt?: unknown;
    createdAt?: unknown;
    chatTime?: unknown;
    lastSeen?: unknown;
    titleSource?: unknown;
    titles?: unknown;
    _debug?: WorkerChatDebug | null;
    _raw?: unknown;
    [key: string]: unknown;
}

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
        chat: WorkerChat,
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

function isGeneratedMediaIdentity(value: unknown): value is GeneratedMediaIdentity {
    return isObjectRecord(value) && typeof value.chatId === 'string' && typeof value.generationOrdinal === 'number';
}

function extractRequestedId(item: unknown): string | number | null | undefined {
    if (typeof item === 'string' || typeof item === 'number') {
        return item;
    }
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
                            const rawChat = isObjectRecord(directRes.data)
                                ? directRes.data
                                : (isObjectRecord(directRes.chat) ? directRes.chat : (isObjectRecord(directRes) ? directRes : { id: nid }));
                            const chat: WorkerChat = { id: nid, ...rawChat };
                            resolve({ success: true, results: [chat], skipped: 0 });
                            return;
                        } else if (isObjectRecord(directRes) && directRes.error) {
                            settled = true;
                            const success = typeof directRes.success === 'boolean' ? directRes.success : false;
                            const error = typeof directRes.error === 'string' ? directRes.error : getErrorMessage(directRes.error);
                            resolve({
                                success,
                                error,
                                ...directRes
                            });
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
                            } else if (isObjectRecord(response)) {
                                const success = typeof response.success === 'boolean' ? response.success : !response.error;
                                const error = typeof response.error === 'string' ? response.error : undefined;
                                resolve({
                                    success,
                                    ...(error !== undefined ? { error } : {}),
                                    ...response
                                });
                            } else {
                                resolve({ success: false, error: 'Empty or invalid response from runtime', rawResponse: response });
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

interface GenerationCandidateMessage extends WorkerChatMessage {
    role: 'user' | 'model' | 'assistant' | 'system';
    content: string;
}

function isGenerationCandidateMessage(m: unknown): m is GenerationCandidateMessage {
    if (!isObjectRecord(m)) return false;
    const role = m.role;
    const content = m.content;
    return (
        (role === 'user' || role === 'model' || role === 'assistant' || role === 'system') &&
        typeof content === 'string'
    );
}

function supplementTakeoutGeneratedMedia(
    chat: WorkerChat,
    nid: string,
    slot: string = 'u0',
    takeoutEngine?: TakeoutExportSource | TakeoutEngineSourceLike | null,
    options: SupplementTakeoutMediaOptions = {}
): void {
    const appendMarkdownRef = options.appendMarkdownRef ?? true;
    if (takeoutEngine && typeof takeoutEngine.getTakeoutMediaForChat === 'function' && Array.isArray(chat?.messages) && chat.messages.length > 0) {
        const takeoutMedia = takeoutEngine.getTakeoutMediaForChat(nid, slot);
        if (Array.isArray(takeoutMedia) && takeoutMedia.length > 0) {
            for (const tm of takeoutMedia) {
                if (!isObjectRecord(tm) || !tm.isGenerated || typeof tm.filename !== 'string') continue;
                const tmFilename = tm.filename;
                const tmRequestId = typeof tm.providerRequestId === 'string' ? tm.providerRequestId : undefined;
                const tmImageOrdinal = typeof tm.imageOrdinal === 'number' ? tm.imageOrdinal : undefined;
                const generation: GeneratedMediaIdentity | null = isGeneratedMediaIdentity(tm.generation)
                    ? tm.generation
                    : (tmRequestId ? {
                        chatId: nid,
                        providerRequestId: tmRequestId,
                        generationOrdinal: 0,
                        imageOrdinal: tmImageOrdinal ?? 0,
                    } : null);
                const generationCandidates = chat.messages.filter(isGenerationCandidateMessage);
                const eventTarget = generation
                    ? findGenerationModelMessage({ id: typeof chat.id === 'string' ? chat.id : undefined, messages: generationCandidates }, generation)
                    : null;
                if (eventTarget && generation && hasGenerationImage(eventTarget, generation)) continue;
                const candidates: WorkerChatMessage[] = generation ? (eventTarget ? [eventTarget] : []) : chat.messages;
                const alreadyHas = candidates.some((m: WorkerChatMessage) =>
                    (m.images && m.images.some((im) => im.fileName === tmFilename || (im.localName && im.localName.includes(tmFilename)))) ||
                    (m.attachments && m.attachments.some((at) => at.fileName === tmFilename || (at.localName && at.localName.includes(tmFilename)))) ||
                    (typeof m.content === 'string' && m.content.includes(tmFilename))
                );
                if (!alreadyHas) {
                    const imgObj: WorkerMessageAttachment = {
                        url: tmFilename,
                        name: tmFilename,
                        fileName: tmFilename,
                        localName: `assets/${tmFilename}`,
                        source: 'takeout',
                        isGenerated: true,
                        providerRequestId: tmRequestId || generation?.providerRequestId,
                        imageOrdinal: tmImageOrdinal ?? generation?.imageOrdinal,
                        ...(generation ? { generation } : {})
                    };
                    const targetModelMsg = generation
                        ? eventTarget
                        : chat.messages.slice().reverse().find((m) => m.role === 'model' || m.role === 'assistant');
                    if (targetModelMsg) {
                        targetModelMsg.images = targetModelMsg.images || [];
                        targetModelMsg.attachments = targetModelMsg.attachments || [];
                        targetModelMsg.images.push(imgObj);
                        targetModelMsg.attachments.push(imgObj);
                        if (appendMarkdownRef) {
                            const currentContent = typeof targetModelMsg.content === 'string' ? targetModelMsg.content : '';
                            if (!currentContent.includes(tmFilename)) {
                                targetModelMsg.content = (currentContent ? currentContent + '\n\n' : '') + `![Generated Image](assets/${tmFilename})`;
                            }
                        }
                    } else {
                        chat.messages.push({
                            role: 'model',
                            content: appendMarkdownRef ? `![Generated Image](assets/${tmFilename})` : '',
                            timestamp: generation?.time ?? null,
                            providerRequestId: tmRequestId || generation?.providerRequestId,
                            ...(generation ? { generation } : {}),
                            images: [imgObj],
                            attachments: [imgObj]
                        });
                    }
                }
            }
        }
    }
}

/** Shared acquisition policy: usable online data, then Takeout, then stored detail. */
export async function resolveConversationData<T extends WorkerChat = WorkerChat>(
    chat: T,
    nid: string,
    listConversation?: WorkerListConversation | null,
    takeoutEngine?: TakeoutExportSource | TakeoutEngineSourceLike | null,
    slot: string = 'u0',
    onLog: (msg: string, level?: string) => void = (() => {}),
): Promise<T> {
    if ((chat.error || chat._empty || !chat.messages || chat.messages.length === 0)) {
        if (takeoutEngine && typeof takeoutEngine.getTakeoutOfflineChat === 'function') {
            const fbChat = takeoutEngine.getTakeoutOfflineChat(nid, slot);
            if (isObjectRecord(fbChat) && Array.isArray(fbChat.messages) && fbChat.messages.length > 0) {
                const fbTitle = typeof fbChat.title === 'string' ? fbChat.title : undefined;
                chat = {
                    ...chat,
                    ...fbChat,
                    id: nid,
                    title: isRealTitle(chat.title, nid) ? chat.title : fbTitle,
                    url: `https://gemini.google.com/app/${nid}`
                };
                delete chat.error;
                delete chat._empty;
                const I18n = __resolveModule('I18n', I18nStatic);
                onLog(I18n.t('logTakeoutChatRecovered', chat.title || nid), 'info');
            }
        }
        if (chat.error || chat._empty || !chat.messages || chat.messages.length === 0) {
            try {
                const detail = await getConversationDetail(nid);
                if (detail && Array.isArray(detail.messages) && detail.messages.length > 0) {
                    chat = {
                        ...chat,
                        ...listConversation,
                        id: nid,
                        title: isRealTitle(chat.title, nid) ? chat.title : (listConversation?.title || nid),
                        messages: detail.messages,
                        turns: detail.turns,
                        url: (listConversation && listConversation.url) || `https://gemini.google.com/app/${nid}`
                    };
                    delete chat.error;
                    delete chat._empty;
                    const I18n = __resolveModule('I18n', I18nStatic);
                    onLog(I18n.t('logTakeoutChatRecovered', chat.title || nid), 'info');
                }
            } catch { /* intentional */ }
        }
    }

    return chat;
}

async function resolveChat(
    chat: WorkerChat,
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

    chat = await resolveConversationData(chat, nid, listConversation, takeoutEngine, slot, onLog);

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

                const docObj: WorkerMessageAttachment = {
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

    let finalTitle = chat.title || listConversation?.title || chat.id || '';

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
            id: typeof listConversation.id === 'string' ? listConversation.id : (typeof chat.id === 'string' ? chat.id : nid),
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

    return {
        chat,
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
