import {
    BatchWorker,
    resolveConversationData,
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
    GeneratedMediaIdentity,
} from '../../../types/conversation.js';
import type { ConversationRecordInput, ConversationRecordMessage, ConversationRecordTurn, ConversationRecordAttachment } from '../../provider/record/conversationRecord.js';
import type { TakeoutExportSource } from '../../../types/ui.js';
import type { TakeoutEngineModule } from '../../engine/takeoutEngine.js';
import { inferLegacyProviderId } from '../../provider/conversationParser.js';
import { parseConversation } from '../../provider/parseConversation.js';
import { composeDomainDocument } from '../document/composeDomainDocument.js';
import { collectDocumentResources } from '../document/resourceReferences.js';
import type { DocumentDiagnostic } from '../../diagnostics/documentDiagnostic.js';
import type { DocumentAst } from '../document/ast.js';
import type { PreparedResources } from '../assets/preparedResources.js';
import { preparePdfResources } from './prepareResources.js';
import type { DocumentDiagnostic as RenderDiagnostic } from '../../diagnostics/documentDiagnostic.js';

declare global {
    interface Window {
        TakeoutEngine?: TakeoutEngineModule | TakeoutExportSource | null;
    }
}

export const PDF_NO_MESSAGES = 'PDF_NO_MESSAGES';
export const PDF_DETAIL_FETCH_FAILED = 'PDF_DETAIL_FETCH_FAILED';

interface PdfProviderAsset extends ConversationRecordAttachment {
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

interface PdfProviderMessage extends ConversationRecordMessage {
    id?: string;
    role?: string;
    content?: unknown;
    timestamp?: number | null;
    turnId?: string;
    providerRequestId?: string;
    generation?: GeneratedMediaIdentity;
    attachments?: PdfProviderAsset[];
    images?: PdfProviderAsset[];
    documents?: PdfProviderAsset[];
    [key: string]: unknown;
}

interface PdfProviderTurn extends ConversationRecordTurn {
    id?: string;
    timestamp?: number | null;
    messages?: PdfProviderMessage[];
    attachments?: PdfProviderAsset[];
    images?: PdfProviderAsset[];
    [key: string]: unknown;
}

interface PdfProviderConversation extends ConversationRecordInput {
    id?: string;
    title?: string;
    timestamp?: number | null;
    messages?: PdfProviderMessage[];
    turns?: PdfProviderTurn[];
    [key: string]: unknown;
}

interface PdfSelectedItemObject {
    id?: string | number | null;
    title?: string | null;
    messages?: PdfProviderMessage[];
    turns?: PdfProviderTurn[];
    [key: string]: unknown;
}

type PdfSelectedItem = string | PdfSelectedItemObject;

type PdfGetGeminiTab = NonNullable<AssetPipelineOptions['getGeminiTab']>;
type PdfSendToGeminiTab = NonNullable<AssetPipelineOptions['sendToGeminiTab']>;
type PdfFetchAsset = NonNullable<AssetPipelineOptions['fetchAsset']>;
type PdfFetchAssetDelegate = NonNullable<AssetPipelineOptions['fetchAssetDelegate']>;

interface PdfTakeoutFallbackEngine {
    getTakeoutOfflineChat?: (chatId: string, slot?: string | null) => unknown;
    getTakeoutFallbackMedia?: (
        chatId: string,
        filenameOrId: string,
        slot?: string | null,
        generation?: GeneratedMediaIdentity
    ) => Promise<Uint8Array | null>;
    getTakeoutMediaForChat?: (chatId: string, slot?: string | null) => unknown[];
}

type PdfTakeoutEngine =
    | TakeoutExportSource
    | TakeoutEngineModule
    | AssetPipelineTakeoutEngine
    | PdfTakeoutFallbackEngine;

export function toRenderDiagnostic(d: DocumentDiagnostic): RenderDiagnostic {
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
    fallback: PdfProviderConversation,
): PdfProviderConversation {
    const rawResults: unknown = isObjectRecord(res) ? res.results : undefined;
    const rawChat: unknown = isObjectRecord(res) ? res.chat : undefined;
    const chunkResults: readonly unknown[] = Array.isArray(rawResults)
        ? rawResults
        : (isObjectRecord(rawChat) ? [rawChat] : []);
    const chosen: unknown = chunkResults[0] || fallback;
    if (isObjectRecord(chosen)) {
        return { ...chosen, id: nid };
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
}): Promise<{ ok: true; chat: PdfProviderConversation } | { ok: false; error: string }> {
    const { id, title, index, total, currentSlot, skip, signal, fetchChatDetail, onLog } = args;
    const nid = normId(id);
    let res: FetchChatDetailResult | null = null;
    try {
        res = await fetchChatDetail({ id: nid, title }, index, total, currentSlot, skip, 'pdf', signal);
    } catch (e: unknown) {
        return { ok: false, error: getErrorMessage(e) };
    }
    if (!isObjectRecord(res) || !res.success) {
        return { ok: false, error: (isObjectRecord(res) && typeof res.error === 'string' && res.error) || 'unknown error' };
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
    document: DocumentAst;
    resources: PreparedResources;
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
    conversations?: PdfProviderConversation[];
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
    const selectedChat: PdfProviderConversation = typeof selectedItem !== 'string' && isObjectRecord(selectedItem)
        ? {
            ...selectedItem,
            id: typeof selectedItem.id === 'string' ? selectedItem.id : id,
            title: typeof selectedItem.title === 'string' ? selectedItem.title : title,
        }
        : { id, title };

    const diagnostics: RenderDiagnostic[] = [];
    let chat: PdfProviderConversation = listChat ?? selectedChat;

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

    const providerInput = { ...chat, id: chat.id || id };
    const { pipeline, takeoutEngine, maxRetries } = context.includeAssets === false
        ? { pipeline: null, takeoutEngine: null, maxRetries: undefined }
        : resolvePdfAssetPipeline({ ...context, currentSlot, onLog });
    const generatedMedia = takeoutEngine && 'getTakeoutMediaForChat' in takeoutEngine
        ? takeoutEngine.getTakeoutMediaForChat?.(id, currentSlot) : undefined;

    // Parse all provider syntax before composing the sole logical document representation.
    let parsed: ReturnType<typeof parseConversation>;
    let document: DocumentAst;
    try {
        for (const message of providerInput.messages ?? providerInput.turns?.flatMap(turn => turn.messages ?? []) ?? []) {
            if (message.id !== undefined && !message.id.trim()) throw new TypeError('[MSG_BAD_ID] Empty message identity');
        }
        parsed = parseConversation({ format: 'conversation-record', data: providerInput, providerId: inferLegacyProviderId(providerInput), generatedMedia });
        diagnostics.push(...parsed.diagnostics);
        const composed = composeDomainDocument(parsed.conversation);
        document = composed.document;
        diagnostics.push(...composed.diagnostics);
    } catch (error) {
        const message = getErrorMessage(error);
        const code = message.match(/\[(MSG_BAD_ID|MSG_DUP_ID)\]/)?.[1] ?? 'PDF_INPUT_INVALID';
        diagnostics.push({ severity: 'error', code, message });
        return { ok: false, id, title, error: message, diagnostics };
    }
    if (!document.messages.length) return { ok: false, id, title, error: `[${PDF_NO_MESSAGES}] Conversation detail resolved without any messages; refusing to generate an empty PDF.`, diagnostics };

    const pipelineChat: AssetPipelineChat = { id: parsed.conversation.id, title: parsed.conversation.title };
    const imageIds = collectDocumentResources(document).imageIds;
    const prepared = await preparePdfResources(parsed.conversation, imageIds, parsed.acquisitionHints, {
        signal,
        acquire: pipeline ? (_assetId, hint) => pipeline.acquireAssetBytes(hint, pipelineChat, {
            isImage: true, listTitle: title, signal, ...(typeof maxRetries === 'number' ? { maxRetries } : {}),
        }) : undefined,
        onFailure: (assetId, reason) => onLog(`[PDF] [${title || id}] 图片获取失败 (${assetId}): ${reason}`, 'warn'),
    });
    diagnostics.push(...prepared.diagnostics);
    if (prepared.aborted) return { ok: false, id, title, error: 'aborted', diagnostics };
    const resources = prepared.resources;
    return { ok: true, id, title, document, resources, diagnostics };
}
