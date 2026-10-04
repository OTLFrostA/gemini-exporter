import {
    BatchWorker,
    resolveConversationData,
    supplementTakeoutGeneratedMedia,
    type FetchChatDetailResult,
} from '../../engine/export/batchWorker.js';
import {
    AssetPipeline as AssetPipelineStatic,
    type AssetPipelineInstance,
    type AssetPipelineClass,
    type AssetPipelineOptions,
    type AssetPipelineTakeoutEngine,
    type AssetPipelineChat,
} from '../../engine/assetPipeline.js';
import { __getModuleOverride, __resolveModule } from '../../utils/moduleOverrides.js';
import { normId } from '../../utils/pathUtils.js';
import { getErrorMessage } from '../../utils/messaging.js';
import { isObjectRecord } from '../../utils/messageResponses.js';
import TabService from '../../utils/tabService.js';
import type { TabServiceModule } from '../../../types/utils.js';
import type {
    Conversation,
    ChatMessage,
    Turn,
    Attachment,
    AuthorRole,
    GeneratedMediaIdentity,
} from '../../../types/conversation.js';
import type { TakeoutExportSource } from '../../../types/ui.js';
import type { TakeoutEngineModule } from '../../engine/takeoutEngine.js';
import type { CanonicalConversationBundle } from '../canonical/conversation.js';
import type { Diagnostic } from '../canonical/diagnostics.js';
import {
    classifyAttachmentKind,
    extractAttachmentInlineBytes,
} from '../canonical/gemini/normalizeAssets.js';
import { normalizeGeminiConversation } from '../canonical/index.js';
import type { RenderDiagnostic } from '../canonical/rendering.js';
import type { InlineByteStore } from '../assets/index.js';

declare global {
    interface Window {
        TakeoutEngine?: TakeoutEngineModule | TakeoutExportSource | null;
    }
}

export const PDF_NO_MESSAGES = 'PDF_NO_MESSAGES';
export const PDF_DETAIL_FETCH_FAILED = 'PDF_DETAIL_FETCH_FAILED';

export interface PdfHydratableAsset {
    type?: string;
    isImage?: boolean;
    localName?: string;
    resolvedUrl?: string;
    sourceUrl?: string;
    url?: string;
    src?: string;
    fileName?: string;
    name?: string;
    title?: string;
    mime?: string;
    mimeType?: string;
    dataBuffer?: ArrayBuffer | ArrayBufferView | number[];
    failureReason?: string;
    dataBase64?: string;
    blobBase64?: string;
    contentMarkdown?: string;
    candidates?: string[];
    generation?: GeneratedMediaIdentity;
    [key: string]: unknown;
}

export interface PdfHydratableMessage {
    id?: string;
    role?: AuthorRole | string;
    content?: string;
    timestamp?: number | null;
    turnId?: string;
    providerRequestId?: string;
    generation?: GeneratedMediaIdentity;
    attachments?: PdfHydratableAsset[];
    images?: PdfHydratableAsset[];
    documents?: PdfHydratableAsset[];
    [key: string]: unknown;
}

export interface PdfHydratableTurn {
    id?: string;
    timestamp?: number | null;
    messages?: PdfHydratableMessage[];
    attachments?: PdfHydratableAsset[];
    images?: PdfHydratableAsset[];
    [key: string]: unknown;
}

export interface PdfHydratableConversation {
    id?: string;
    title?: string;
    timestamp?: number | null;
    messages?: PdfHydratableMessage[];
    turns?: PdfHydratableTurn[];
    [key: string]: unknown;
}

export interface PdfSelectedItemObject {
    id?: string | number | null;
    title?: string | null;
    messages?: PdfHydratableMessage[];
    turns?: PdfHydratableTurn[];
    [key: string]: unknown;
}

export type PdfSelectedItem = string | PdfSelectedItemObject;

export type PdfGetGeminiTab = NonNullable<AssetPipelineOptions['getGeminiTab']>;
export type PdfSendToGeminiTab = NonNullable<AssetPipelineOptions['sendToGeminiTab']>;
export type PdfFetchAsset = NonNullable<AssetPipelineOptions['fetchAsset']>;
export type PdfFetchAssetDelegate = NonNullable<AssetPipelineOptions['fetchAssetDelegate']>;

export interface PdfTakeoutFallbackEngine {
    getTakeoutOfflineChat?: (chatId: string, slot?: string | null) => unknown;
    getTakeoutFallbackMedia?: (
        chatId: string,
        filenameOrId: string,
        slot?: string | null,
        generation?: GeneratedMediaIdentity
    ) => Promise<Uint8Array | null>;
    getTakeoutMediaForChat?: (chatId: string, slot?: string | null) => unknown[];
}

export type PdfTakeoutEngine =
    | TakeoutExportSource
    | TakeoutEngineModule
    | AssetPipelineTakeoutEngine
    | PdfTakeoutFallbackEngine;

export function toRenderDiagnostic(d: Diagnostic): RenderDiagnostic {
    return {
        severity: d.severity,
        code: d.code,
        message: d.message,
        path: d.path,
    };
}

export function hasUsableMessages(chat: unknown): boolean {
    if (!chat || typeof chat !== 'object') return false;
    if ('messages' in chat && Array.isArray(chat.messages) && chat.messages.length > 0) return true;
    if ('turns' in chat && Array.isArray(chat.turns) && chat.turns.length > 0) return true;
    return false;
}

/**
 * Extract the chat from a fetchChatDetail result using the exact contract
 * ExportOrchestrator uses: results[0] wins, then chat. Never invent fields.
 */
export function extractChatFromDetailResult(
    res: FetchChatDetailResult,
    nid: string,
    fallback: PdfHydratableConversation,
): PdfHydratableConversation {
    const rawResults: unknown = res.results;
    const rawChat: unknown = res.chat;
    const chunkResults: readonly unknown[] = Array.isArray(rawResults)
        ? rawResults
        : (isObjectRecord(rawChat) ? [rawChat] : []);
    const chosen: unknown = chunkResults[0] || fallback;
    if (isObjectRecord(chosen)) {
        chosen.id = nid;
        return chosen;
    }
    return fallback;
}

/**
 * Resolve a full conversation for a metadata-only list item via the same
 * BatchWorker.fetchChatDetail path the normal export uses. The normalizer
 * stays a pure data transform — no network fetch is ever put inside it.
 */
export async function resolveFullChatDetail(args: {
    id: string;
    title: string;
    index: number;
    total: number;
    currentSlot: string;
    skip: boolean;
    signal: AbortSignal;
    fetchChatDetail: typeof BatchWorker.fetchChatDetail;
    onLog: (msg: string, level?: string) => void;
}): Promise<{ ok: true; chat: PdfHydratableConversation } | { ok: false; error: string }> {
    const { id, title, index, total, currentSlot, skip, signal, fetchChatDetail, onLog } = args;
    const nid = normId(id);
    let res: FetchChatDetailResult | null = null;
    try {
        res = await fetchChatDetail({ id: nid, title }, index, total, currentSlot, skip, 'pdf', signal);
    } catch (e: unknown) {
        return { ok: false, error: getErrorMessage(e) };
    }
    if (!res || !res.success) {
        return { ok: false, error: (res && res.error) || 'unknown error' };
    }
    const chat = extractChatFromDetailResult(res, nid, { id: nid, title });
    const msgCount = Array.isArray(chat.messages) ? chat.messages.length : 0;
    onLog(`[PDF] ${title || nid}: resolved full conversation detail (${msgCount} messages)`, 'info');
    return { ok: true, chat };
}

export interface PreparedPdfItemSuccess {
    ok: true;
    id: string;
    title: string;
    bundle: CanonicalConversationBundle;
    byteStore: InlineByteStore;
    diagnostics: RenderDiagnostic[];
}

export interface PreparedPdfItemFailure {
    ok: false;
    id: string;
    title: string;
    error: string;
    diagnostics: RenderDiagnostic[];
}

export type PreparedPdfItemResult = PreparedPdfItemSuccess | PreparedPdfItemFailure;

export interface PreparePdfItemContext {
    conversations?: PdfHydratableConversation[];
    fetchChatDetail?: typeof BatchWorker.fetchChatDetail;
    index?: number;
    total?: number;
    currentSlot?: string;
    skip?: boolean;
    signal?: AbortSignal;
    onLog?: (msg: string, level?: string) => void;
    includeAssets?: boolean;
    takeoutEngine?: PdfTakeoutEngine | null;
    assetPipeline?: Pick<AssetPipelineInstance, 'acquireAssetBytes'> | null;
    fetchAssetDelegate?: PdfFetchAssetDelegate;
    fetchAsset?: PdfFetchAsset;
    getGeminiTab?: PdfGetGeminiTab;
    sendToGeminiTab?: PdfSendToGeminiTab;
    maxAssetRetries?: number;
}

function cloneAttachmentList(list: PdfHydratableAsset[] | undefined): PdfHydratableAsset[] | undefined {
    if (!Array.isArray(list)) return undefined;
    return list.map((item) => (isObjectRecord(item) ? { ...item } : item));
}

function cloneMessageForHydration(msg: PdfHydratableMessage): PdfHydratableMessage {
    if (!isObjectRecord(msg)) return msg;
    return {
        ...msg,
        ...(Array.isArray(msg.attachments) ? { attachments: cloneAttachmentList(msg.attachments) } : {}),
        ...(Array.isArray(msg.images) ? { images: cloneAttachmentList(msg.images) } : {}),
        ...(Array.isArray(msg.documents) ? { documents: cloneAttachmentList(msg.documents) } : {}),
    };
}

function cloneChatForHydration(chat: PdfHydratableConversation): PdfHydratableConversation {
    if (!isObjectRecord(chat)) return chat;
    return {
        ...chat,
        ...(Array.isArray(chat.messages) ? { messages: chat.messages.map(cloneMessageForHydration) } : {}),
        ...(Array.isArray(chat.turns) ? {
            turns: chat.turns.map((t) => {
                if (!isObjectRecord(t)) return t;
                return {
                    ...t,
                    ...(Array.isArray(t.messages) ? { messages: t.messages.map(cloneMessageForHydration) } : {}),
                    ...(Array.isArray(t.attachments) ? { attachments: cloneAttachmentList(t.attachments) } : {}),
                    ...(Array.isArray(t.images) ? { images: cloneAttachmentList(t.images) } : {}),
                };
            }),
        } : {}),
    };
}

interface ImageHydrationGroup {
    key: string;
    mergedItem: PdfHydratableAsset;
    targets: PdfHydratableAsset[];
}

function collectImageHydrationGroups(chat: PdfHydratableConversation): ImageHydrationGroup[] {
    const groups = new Map<string, ImageHydrationGroup>();
    const registerItem = (item: PdfHydratableAsset, forceImage: boolean): void => {
        if (!isObjectRecord(item)) return;
        const rawBuf = item.dataBuffer;
        const normalizedBuf = Array.isArray(rawBuf) ? new Uint8Array(rawBuf) : rawBuf;
        const candidate: Attachment = {
            ...item,
            dataBuffer: normalizedBuf,
            type: forceImage ? (item.type || 'image') : (item.type ?? ''),
        };
        if (!classifyAttachmentKind(candidate).isImage) return;
        const existingBytes = extractAttachmentInlineBytes(candidate);
        if (existingBytes && existingBytes.byteLength > 0) return;

        const rawKey = item.localName || item.resolvedUrl || item.sourceUrl || item.url || item.src || item.fileName || item.name;
        if (!rawKey || typeof rawKey !== 'string') return;
        const key = rawKey;

        let group = groups.get(key);
        if (!group) {
            group = {
                key,
                mergedItem: { ...candidate },
                targets: [item],
            };
            groups.set(key, group);
        } else {
            for (const [k, v] of Object.entries(candidate)) {
                if (v !== undefined && group.mergedItem[k] === undefined) {
                    group.mergedItem[k] = v;
                }
            }
            if (!group.targets.includes(item)) {
                group.targets.push(item);
            }
        }
    };

    const visitHolder = (holder: { attachments?: PdfHydratableAsset[]; images?: PdfHydratableAsset[] } | undefined): void => {
        if (!isObjectRecord(holder)) return;
        for (const att of holder.attachments ?? []) registerItem(att, false);
        for (const img of holder.images ?? []) registerItem(img, true);
    };

    for (const msg of chat.messages ?? []) visitHolder(msg);
    for (const turn of chat.turns ?? []) {
        visitHolder(turn);
        for (const msg of turn.messages ?? []) visitHolder(msg);
    }

    return [...groups.values()];
}

function resolvePdfAssetPipeline(context: PreparePdfItemContext): {
    pipeline: Pick<AssetPipelineInstance, 'acquireAssetBytes'> | null;
    takeoutEngine: PdfTakeoutEngine | null;
    maxRetries?: number;
} {
    const takeoutEngine: PdfTakeoutEngine | null = context.takeoutEngine
        ?? __resolveModule<TakeoutEngineModule | TakeoutExportSource | null>('TakeoutEngine', null)
        ?? (typeof window !== 'undefined' ? window.TakeoutEngine : null)
        ?? null;
    const hasTabTransport = Boolean(
        context.getGeminiTab ||
        context.sendToGeminiTab ||
        (typeof chrome !== 'undefined' && Boolean(chrome?.tabs))
    );
    const overridePipelineClass = __getModuleOverride<AssetPipelineClass>('AssetPipeline');
    const hasDelegate = Boolean(context.fetchAssetDelegate || context.fetchAsset);
    const hasAcquisitionSource = Boolean(
        context.assetPipeline ||
        hasDelegate ||
        hasTabTransport ||
        takeoutEngine ||
        overridePipelineClass
    );
    if (!hasAcquisitionSource) {
        return { pipeline: null, takeoutEngine: null };
    }
    if (context.assetPipeline && typeof context.assetPipeline.acquireAssetBytes === 'function') {
        return {
            pipeline: context.assetPipeline,
            takeoutEngine,
            maxRetries: context.maxAssetRetries,
        };
    }

    const AssetPipelineClass: AssetPipelineClass = overridePipelineClass || AssetPipelineStatic;
    const tabService = __resolveModule<TabServiceModule>('TabService', TabService);
    const getGeminiTab: AssetPipelineOptions['getGeminiTab'] = context.getGeminiTab ?? (hasTabTransport
        ? async (slot?: string) => tabService.getGeminiTab(slot)
        : undefined);
    const sendToGeminiTab: AssetPipelineOptions['sendToGeminiTab'] = context.sendToGeminiTab ?? (hasTabTransport
        ? (message, slot?: string, timeoutMs?: number) => tabService.sendToGeminiTab(message, slot, timeoutMs)
        : undefined);

    const pipeline = new AssetPipelineClass({
        currentSlot: context.currentSlot,
        useZip: false,
        takeoutEngine,
        getGeminiTab,
        sendToGeminiTab,
        fetchAssetDelegate: context.fetchAssetDelegate || context.fetchAsset,
        onLog: context.onLog,
    });

    const maxRetries = typeof context.maxAssetRetries === 'number'
        ? context.maxAssetRetries
        : (!hasDelegate && !hasTabTransport ? 0 : undefined);

    return { pipeline, takeoutEngine, maxRetries };
}

function toNormalizableAsset(asset: PdfHydratableAsset): Attachment {
    const rawBuf = asset.dataBuffer;
    const dataBuffer = Array.isArray(rawBuf) ? new Uint8Array(rawBuf) : rawBuf;
    return {
        ...asset,
        dataBuffer,
        type: typeof asset.type === 'string' && asset.type ? asset.type : (asset.isImage ? 'image' : 'file'),
    };
}

function toNormalizableMessage(msg: PdfHydratableMessage): ChatMessage {
    const rawRole = typeof msg.role === 'string' ? msg.role : '';
    const role: AuthorRole = rawRole === 'user' || rawRole === 'assistant' || rawRole === 'system'
        ? rawRole
        : 'model';
    const content = typeof msg.content === 'string' ? msg.content : '';
    const attachments = Array.isArray(msg.attachments) ? msg.attachments.map(toNormalizableAsset) : undefined;
    const images = Array.isArray(msg.images) ? msg.images.map(toNormalizableAsset) : undefined;
    const documents = Array.isArray(msg.documents)
        ? msg.documents.map((d) => ({
            ...toNormalizableAsset(d),
            type: typeof d.type === 'string' && d.type ? d.type : 'doc',
        }))
        : undefined;

    const normalizedMsg: ChatMessage = {
        ...msg,
        role,
        content,
        attachments,
        images,
        documents,
    };
    if (rawRole && role === 'model' && rawRole !== 'model') {
        Reflect.set(normalizedMsg, 'role', rawRole);
    }
    return normalizedMsg;
}

function toNormalizableTurn(turn: PdfHydratableTurn): Turn {
    const messages = Array.isArray(turn.messages) ? turn.messages.map(toNormalizableMessage) : undefined;
    const attachments = Array.isArray(turn.attachments) ? turn.attachments.map(toNormalizableAsset) : undefined;
    const images = Array.isArray(turn.images) ? turn.images.map(toNormalizableAsset) : undefined;

    return {
        ...turn,
        messages,
        attachments,
        images,
    };
}

function toNormalizableConversation(
    chat: PdfHydratableConversation,
    fallbackId: string,
    fallbackTitle: string,
): Conversation {
    const id = typeof chat.id === 'string' && chat.id ? chat.id : fallbackId;
    const title = typeof chat.title === 'string' ? chat.title : fallbackTitle;
    const timestamp = typeof chat.timestamp === 'number'
        ? chat.timestamp
        : (chat.timestamp === null ? null : null);

    return {
        ...chat,
        id,
        title,
        timestamp,
        messages: Array.isArray(chat.messages) ? chat.messages.map(toNormalizableMessage) : undefined,
        turns: Array.isArray(chat.turns) ? chat.turns.map(toNormalizableTurn) : undefined,
    };
}

export async function preparePdfItem(
    selectedItem: PdfSelectedItem,
    context: PreparePdfItemContext = {},
): Promise<PreparedPdfItemResult> {
    const rawId = typeof selectedItem === 'string'
        ? selectedItem
        : (isObjectRecord(selectedItem) && 'id' in selectedItem ? selectedItem.id : '');
    const id = normId(typeof rawId === 'string' || typeof rawId === 'number' || rawId === null ? rawId : undefined);
    const rawTitle = typeof selectedItem !== 'string' && isObjectRecord(selectedItem) && 'title' in selectedItem && typeof selectedItem.title === 'string'
        ? selectedItem.title
        : undefined;
    const title = rawTitle || id;
    const signal = context.signal ?? new AbortController().signal;
    const onLog = context.onLog ?? (() => {});
    const currentSlot = context.currentSlot ?? 'u0';
    const index = context.index ?? 0;
    const total = context.total ?? 1;
    const skip = context.skip ?? false;

    const listChat = Array.isArray(context.conversations)
        ? context.conversations.find((c) => normId(c.id) === id) ?? null
        : null;
    const selectedChat: PdfHydratableConversation = typeof selectedItem !== 'string' && isObjectRecord(selectedItem)
        ? {
            ...selectedItem,
            id: typeof selectedItem.id === 'string' ? selectedItem.id : id,
            title: typeof selectedItem.title === 'string' ? selectedItem.title : title,
        }
        : { id, title };

    const diagnostics: RenderDiagnostic[] = [];
    let chat: PdfHydratableConversation = listChat ?? selectedChat;

    if (!hasUsableMessages(chat)) {
        let fetchError: string | undefined;
        if (context.fetchChatDetail) {
            const fetched = await resolveFullChatDetail({
                id, title, index, total, currentSlot, skip, signal,
                fetchChatDetail: context.fetchChatDetail, onLog,
            });
            if (signal.aborted) return { ok: false, id, title, error: 'aborted', diagnostics };
            if (fetched.ok) chat = fetched.chat;
            else fetchError = fetched.error;
        }
        const takeout: PdfTakeoutEngine | null = context.takeoutEngine
            ?? __getModuleOverride<TakeoutExportSource | TakeoutEngineModule>('TakeoutEngine')
            ?? (typeof window !== 'undefined' ? window.TakeoutEngine : null)
            ?? null;
        const resolvedRaw: unknown = await resolveConversationData(chat, id, listChat, takeout, currentSlot, onLog);
        if (isObjectRecord(resolvedRaw)) chat = resolvedRaw;
        if (signal.aborted) return { ok: false, id, title, error: 'aborted', diagnostics };
        if (!hasUsableMessages(chat)) {
            return {
                ok: false, id, title, diagnostics,
                error: `[${PDF_NO_MESSAGES}] ${fetchError || 'No usable conversation after online, Takeout and cache resolution'}`,
            };
        }
    }

    const workingChat = cloneChatForHydration(chat);
    if (!workingChat.id) {
        workingChat.id = id;
    }

    const { pipeline, takeoutEngine, maxRetries } = context.includeAssets === false
        ? { pipeline: null, takeoutEngine: null, maxRetries: undefined }
        : resolvePdfAssetPipeline({ ...context, currentSlot, onLog });

    if (takeoutEngine) {
        supplementTakeoutGeneratedMedia(workingChat, id, currentSlot, takeoutEngine, {
            appendMarkdownRef: false,
        });
    }

    const pipelineChat: AssetPipelineChat = { id: workingChat.id ?? id, title: workingChat.title };

    if (pipeline && typeof pipeline.acquireAssetBytes === 'function') {
        const groups = collectImageHydrationGroups(workingChat);
        for (const group of groups) {
            if (signal.aborted) {
                return { ok: false, id, title, error: 'aborted', diagnostics };
            }
            const acquired = await pipeline.acquireAssetBytes(group.mergedItem, pipelineChat, {
                isImage: true,
                listTitle: title,
                signal,
                ...(typeof maxRetries === 'number' ? { maxRetries } : {}),
            });
            if (signal.aborted || acquired.failReason === 'aborted') {
                return { ok: false, id, title, error: 'aborted', diagnostics };
            }
            if (acquired.ok && acquired.bytes && acquired.bytes.byteLength > 0) {
                for (const target of group.targets) {
                    target.dataBuffer = acquired.bytes;
                    if (acquired.mimeType && !target.mimeType && !target.mime) {
                        target.mimeType = acquired.mimeType;
                    }
                }
            } else {
                const reason = acquired.failReason || 'image direct download failed';
                for (const target of group.targets) {
                    target.failureReason = reason;
                }
                onLog(
                    `[PDF] [${title || id}] 图片获取失败 (${acquired.localName}): ${reason}`,
                    'warn',
                );
            }
        }
    }

    const normalizableChat = toNormalizableConversation(workingChat, id, title);
    const { bundle, diagnostics: normDiags, byteStore } = await normalizeGeminiConversation(normalizableChat);
    for (const d of normDiags) diagnostics.push(toRenderDiagnostic(d));
    const integrityError = normDiags.find((d) => d.severity === 'error' && (d.code === 'MSG_BAD_ID' || d.code === 'MSG_DUP_ID'));
    if (integrityError) {
        return { ok: false, id, title, error: `[${integrityError.code}] ${integrityError.message}`, diagnostics };
    }

    // Hydrate any standalone inline markdown remote images (not backed by m.attachments / m.images)
    if (pipeline && typeof pipeline.acquireAssetBytes === 'function') {
        for (const asset of bundle.assets) {
            if (asset.kind !== 'image' || asset.status !== 'remote' || !asset.sourceUrl) continue;
            if (signal.aborted) {
                return { ok: false, id, title, error: 'aborted', diagnostics };
            }
            const acquired = await pipeline.acquireAssetBytes(
                {
                    url: asset.sourceUrl,
                    sourceUrl: asset.sourceUrl,
                    fileName: asset.name,
                    localName: asset.storageRef || `assets/${asset.name || asset.id}`,
                },
                pipelineChat,
                {
                    isImage: true,
                    listTitle: title,
                    signal,
                    ...(typeof maxRetries === 'number' ? { maxRetries } : {}),
                },
            );
            if (signal.aborted || acquired.failReason === 'aborted') {
                return { ok: false, id, title, error: 'aborted', diagnostics };
            }
            if (acquired.ok && acquired.bytes && acquired.bytes.byteLength > 0) {
                const storageRef = asset.storageRef || `assets/inline-remote/${asset.id}`;
                byteStore.put(storageRef, acquired.bytes);
                asset.storageRef = storageRef;
                asset.status = 'available';
                asset.sizeBytes = acquired.bytes.byteLength;
                if (acquired.mimeType && !asset.mimeType) {
                    asset.mimeType = acquired.mimeType;
                }
            } else {
                const reason = acquired.failReason || 'image direct download failed';
                asset.status = 'failed';
                asset.failureReason = reason;
                onLog(
                    `[PDF] [${title || id}] 图片获取失败 (${acquired.localName}): ${reason}`,
                    'warn',
                );
            }
        }
    }

    if ((bundle?.conversation?.messages?.length ?? 0) === 0) {
        return {
            ok: false,
            id,
            title,
            error: `[${PDF_NO_MESSAGES}] Conversation detail resolved without any messages; refusing to generate an empty PDF.`,
            diagnostics,
        };
    }

    return {
        ok: true,
        id,
        title,
        bundle,
        byteStore,
        diagnostics,
    };
}
