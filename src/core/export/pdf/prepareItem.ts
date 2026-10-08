import { isResourceConversationParseResult, type ResourceConversationParseResult } from '../../parsers/parsingResult.js';
import type { DomainConversationDetail } from '../../domain/conversationDetail.js';
import { nativeExportInput } from '../../engine/chatFormatter.js';
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
import type { TakeoutExportSource } from '../../../types/ui.js';
import type { TakeoutEngineModule } from '../../engine/takeoutEngine.js';
import { composeDomainDocument } from '../../document/compose/composeDomainDocument.js';
import { collectDocumentResources } from '../../document/ast/resourceReferences.js';
import type { DocumentDiagnostic } from '../../diagnostics/documentDiagnostic.js';
import type { DocumentAst } from '../../document/ast/ast.js';
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

interface PdfSelectedItemObject { id?: string | number | null; title?: string | null; [key: string]: unknown }
export type PdfSelectedItem = string | PdfSelectedItemObject | ResourceConversationParseResult | DomainConversationDetail;

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

export function hasUsableMessages(value: unknown): boolean {
    return isResourceConversationParseResult(value) && value.conversation.messages.length > 0;
}

/** Only native details may cross the acquisition boundary. */
export function extractChatFromDetailResult(res: FetchChatDetailResult, _id: string): ResourceConversationParseResult | null {
    if (!isObjectRecord(res)) return null;
    const value = Array.isArray(res.results) ? res.results[0] : res.chat;
    return isResourceConversationParseResult(value) ? value : null;
}
export async function resolveFullChatDetail(args: {
    id: string; title: string; index: number; total: number; currentSlot: string; skip: boolean;
    signal: AbortSignal; fetchChatDetail: typeof BatchWorker.fetchChatDetail; onLog: (message: string, level?: string) => void;
}): Promise<{ ok: true; chat: ResourceConversationParseResult } | { ok: false; error: string }> {
    try {
        const response = await args.fetchChatDetail({ id: args.id, title: args.title }, args.index, args.total,
            args.currentSlot, args.skip, 'pdf', args.signal);
        if (!isObjectRecord(response) || !response.success) return { ok: false, error: isObjectRecord(response) && typeof response.error === 'string' ? response.error : 'Detail fetch failed' };
        const chat = extractChatFromDetailResult(response, args.id);
        if (!chat) return { ok: false, error: 'Detail acquisition did not return native Domain' };
        args.onLog(`[PDF] ${args.title}: resolved ${chat.conversation.messages.length} messages`, 'info');
        return { ok: true, chat };
    } catch (error) { return { ok: false, error: getErrorMessage(error) }; }
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
    conversations?: Array<{ id: string; title?: string }>;
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

async function prepareNativePdfItem(
    selectedItem: PdfSelectedItem,
    context: PreparePdfItemContext = {},
): Promise<PreparedPdfItemResult> {
    const nativeSelected = typeof selectedItem === 'object' && selectedItem && 'providerId' in selectedItem
        ? nativeExportInput(selectedItem as DomainConversationDetail)
        : isResourceConversationParseResult(selectedItem) ? selectedItem : null;
    const source = nativeSelected?.conversation;
    const rawId = source?.id ?? (typeof selectedItem === 'string' ? selectedItem : 'id' in selectedItem ? selectedItem.id : '');
    const id = source && source.providerId !== 'gemini' ? source.id : normId(typeof rawId === 'string' || typeof rawId === 'number' ? rawId : '');
    const listItem = context.conversations?.find(item => normId(item.id) === id);
    const rawTitle = typeof selectedItem === 'object' && 'title' in selectedItem ? selectedItem.title : undefined;
    const title = listItem?.title || (typeof rawTitle === 'string' ? rawTitle : source?.title) || id;
    const signal = context.signal ?? new AbortController().signal;
    const onLog = context.onLog ?? (() => {});
    const currentSlot = context.currentSlot ?? 'u0';
    const diagnostics: RenderDiagnostic[] = [];
    let parsed = nativeSelected;
    if (!parsed?.conversation.messages.length && context.fetchChatDetail) {
        const fetched = await resolveFullChatDetail({ id, title, index: context.index ?? 0, total: context.total ?? 1,
            currentSlot, skip: context.skip ?? false, signal, fetchChatDetail: context.fetchChatDetail, onLog });
        if (fetched.ok) parsed = fetched.chat;
        else onLog(fetched.error, 'warn');
    }
    if (!parsed?.conversation.messages.length) {
        const resolved = await resolveConversationData(parsed, id, listItem, context.takeoutEngine && 'getTakeoutOfflineChat' in context.takeoutEngine ? context.takeoutEngine : null, currentSlot, onLog);
        if (isResourceConversationParseResult(resolved)) parsed = resolved;
    }
    if (signal.aborted) return { ok: false, id, title, error: 'aborted', diagnostics };
    if (!parsed?.conversation.messages.length) return { ok: false, id, title,
        error: `[${PDF_NO_MESSAGES}] Native conversation body is unavailable`, diagnostics };
    parsed = { ...parsed, conversation: { ...parsed.conversation, title } };
    let document: DocumentAst;
    try {
        diagnostics.push(...parsed.diagnostics);
        const composed = composeDomainDocument(parsed.conversation);
        document = composed.document;
        diagnostics.push(...composed.diagnostics);
    } catch (error) {
        const message = getErrorMessage(error);
        diagnostics.push({ severity: 'error', code: 'PDF_INPUT_INVALID', message });
        return { ok: false, id, title, error: message, diagnostics };
    }
    const { pipeline, maxRetries } = context.includeAssets === false
        ? { pipeline: null, maxRetries: undefined }
        : resolvePdfAssetPipeline({ ...context, currentSlot, onLog });

    const pipelineChat: AssetPipelineChat = { id: parsed.conversation.id, title: parsed.conversation.title };
    const imageIds = collectDocumentResources(document).imageIds;
    const prepared = await preparePdfResources(parsed.conversation, imageIds, parsed.acquisitionHints, {
        signal,
        acquire: pipeline ? (assetId, hint) => pipeline.acquireAssetBytes({ ...hint, assetId, localName: parsed.resourceHints[assetId]?.archivePath ?? hint.localName }, pipelineChat, {
            isImage: true, listTitle: title, signal, ...(typeof maxRetries === 'number' ? { maxRetries } : {}),
        }) : undefined,
        onFailure: (assetId, reason) => onLog(`[PDF] [${title || id}] 图片获取失败 (${assetId}): ${reason}`, 'warn'),
    });
    diagnostics.push(...prepared.diagnostics);
    if (prepared.aborted) return { ok: false, id, title, error: 'aborted', diagnostics };
    const resources = prepared.resources;
    return { ok: true, id, title, document, resources, diagnostics };
}

/** Per-item source or storage failures remain reportable and retryable by the batch exporter. */
export async function preparePdfItem(selectedItem: PdfSelectedItem, context: PreparePdfItemContext = {}): Promise<PreparedPdfItemResult> {
    try { return await prepareNativePdfItem(selectedItem, context); }
    catch (error) {
        const candidate = typeof selectedItem === 'object' && selectedItem && 'conversation' in selectedItem ? selectedItem.conversation : selectedItem;
        const id = typeof candidate === 'string' ? normId(candidate) : typeof candidate === 'object' && candidate && 'id' in candidate ? String(candidate.id) : '';
        const title = typeof candidate === 'object' && candidate && 'title' in candidate ? String(candidate.title) : id;
        const message = getErrorMessage(error);
        return { ok: false, id, title, error: message, diagnostics: [{ severity: 'error', code: 'PDF_INPUT_INVALID', message }] };
    }
}
