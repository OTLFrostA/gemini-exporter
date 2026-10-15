import { isResourceConversationParseResult, type ResourceConversationParseResult, type NativeConversationInput } from '../../parsers/parsingResult.js';
import type { TrustedDomain } from '../../domain/runtimeValidation.js';
import type { DomainConversationIndex } from '../../../types/conversation.js';
import {
    BatchWorker,
    resolveChat,
    type FetchChatDetailResult,
    type ResolvedConversationSource,
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
import type { TakeoutExportSource } from '../../../types/ui.js';
import type { TakeoutEngineModule, TakeoutResourceLookup } from '../../engine/takeoutEngine.js';
import { composeDomainDocument } from '../../document/compose/composeDomainDocument.js';
import { collectDocumentResources } from '../../document/ast/resourceReferences.js';
import type { DocumentAst } from '../../document/ast/ast.js';
import type { PreparedResources } from '../../resources/resourceResult.js';
import { preparePdfResources } from './prepareResources.js';
import type { Diagnostic as RenderDiagnostic } from '../../diagnostics/diagnostic.js';

declare global {
    interface Window {
        TakeoutEngine?: TakeoutEngineModule | TakeoutExportSource | null;
    }
}

export const PDF_NO_MESSAGES = 'PDF_NO_MESSAGES';
export const PDF_DETAIL_FETCH_FAILED = 'PDF_DETAIL_FETCH_FAILED';

interface PdfSelectedItemObject { id?: string | number | null; title?: string | null; conversation?: never; providerId?: never }
export type PdfSelectedItem = string | PdfSelectedItemObject | ResourceConversationParseResult;

/** Explicit adapter for an already trusted graph; metadata and raw objects cannot establish trust. */
export function pdfDomainSelection(conversation: TrustedDomain): ResourceConversationParseResult { return { conversation, diagnostics: [], resourceHints: {}, acquisitionHints: {} }; }

type PdfGetGeminiTab = NonNullable<AssetPipelineOptions['getGeminiTab']>;
type PdfSendToGeminiTab = NonNullable<AssetPipelineOptions['sendToGeminiTab']>;
type PdfFetchAsset = NonNullable<AssetPipelineOptions['fetchAsset']>;
type PdfFetchAssetDelegate = NonNullable<AssetPipelineOptions['fetchAssetDelegate']>;

interface PdfTakeoutFallbackEngine {
    getTakeoutOfflineChat?: (chatId: string, slot?: string | null) => ResourceConversationParseResult | null;
    getTakeoutFallbackMedia?: (
        chatId: string,
        lookup: TakeoutResourceLookup,
        slot?: string | null
    ) => Promise<Uint8Array | null>;
    getTakeoutMediaForChat?: (chatId: string, slot?: string | null) => unknown[];
}

type PdfTakeoutEngine =
    | TakeoutExportSource
    | TakeoutEngineModule
    | AssetPipelineTakeoutEngine
    | PdfTakeoutFallbackEngine;

export function hasUsableMessages(value: NativeConversationInput): boolean {
    return isResourceConversationParseResult(value) && value.conversation.detail.messages.length > 0;
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
}): Promise<{ ok: true; chat: ResourceConversationParseResult; source: ResolvedConversationSource } | { ok: false; error: string }> {
    try {
        const response = await args.fetchChatDetail({ id: args.id, title: args.title }, args.index, args.total,
            args.currentSlot, args.skip, 'pdf', args.signal);
        if (!isObjectRecord(response) || !response.success) return { ok: false, error: isObjectRecord(response) && typeof response.error === 'string' ? response.error : 'Detail fetch failed' };
        const chat = extractChatFromDetailResult(response, args.id);
        if (!chat) return { ok: false, error: 'Detail acquisition did not return native Domain' };
        args.onLog(`[PDF] ${args.title}: resolved ${chat.conversation.detail.messages.length} messages`, 'info');
        return { ok: true, chat, source: 'source' in response && response.source === 'local-cache' ? 'local_snapshot' : 'online' };
    } catch (error) { return { ok: false, error: getErrorMessage(error) }; }
}

import { extractChatParseDrift } from '../../engine/export/parseDrift.js';
import type { ChatParseDrift } from '../../engine/export/parseDrift.js';

export interface PreparedPdfItemSuccess {
    ok: true;
    id: string;
    title: string;
    document: DocumentAst;
    resources: PreparedResources;
    diagnostics: RenderDiagnostic[];
    drift: ChatParseDrift;
    usedLocalSnapshot: boolean;
    messageCount: number;
    sourceVersion?: number;
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
    source?: ResolvedConversationSource;
    conversations?: DomainConversationIndex[];
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
    const nativeSelected = typeof selectedItem === 'object' && selectedItem.conversation ? selectedItem : null;
    const source = nativeSelected?.conversation;
    const rawId = source?.index.id ?? (typeof selectedItem === 'string' ? selectedItem : 'id' in selectedItem ? selectedItem.id : '');
    const id = source && source.index.providerId !== 'gemini' ? source.index.id : normId(typeof rawId === 'string' || typeof rawId === 'number' ? rawId : '');
    const listItem = context.conversations?.find(item => normId(item.id) === id);
    const rawTitle = typeof selectedItem === 'object' && 'title' in selectedItem ? selectedItem.title : undefined;
    let title = listItem?.title || (typeof rawTitle === 'string' ? rawTitle : source?.index.title) || id;
    const signal = context.signal ?? new AbortController().signal;
    const onLog = context.onLog ?? (() => {});
    const currentSlot = context.currentSlot ?? 'u0';
    const diagnostics: RenderDiagnostic[] = [];
    let parsed = nativeSelected;
    let dataSource = context.source ?? 'unspecified';
    if (!parsed?.conversation.detail.messages.length && context.fetchChatDetail) {
        const fetched = await resolveFullChatDetail({ id, title, index: context.index ?? 0, total: context.total ?? 1,
            currentSlot, skip: context.skip ?? false, signal, fetchChatDetail: context.fetchChatDetail, onLog });
        if (fetched.ok) { parsed = fetched.chat; dataSource = fetched.source; }
        else onLog(fetched.error, 'warn');
    }
    const resolved = await resolveChat(parsed, { id, title }, listItem,
        context.takeoutEngine && 'getTakeoutOfflineChat' in context.takeoutEngine ? context.takeoutEngine : null,
        currentSlot, undefined, onLog, { source: dataSource });
    if (signal.aborted) return { ok: false, id, title, error: 'aborted', diagnostics };
    if (resolved.isError) return { ok: false, id, title, error: `[${PDF_NO_MESSAGES}] ${resolved.errMsg}`, diagnostics };
    parsed = resolved.chat;
    dataSource = resolved.source;
    title = parsed.conversation.index.title;
    const drift = extractChatParseDrift(parsed);
    const usedLocalSnapshot = dataSource === 'local_snapshot'
        && listItem?.cloudAvailability !== 'deleted'
        && !(listItem?.hasTakeoutImport && listItem.cloudAvailability !== 'available');
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

    const pipelineChat: AssetPipelineChat = { id: parsed.conversation.index.id, title };
    const imageIds = collectDocumentResources(document).imageIds;
    const prepared = await preparePdfResources(parsed.conversation.detail, imageIds, parsed.acquisitionHints, {
        signal,
        acquire: pipeline ? (assetId, hint) => pipeline.acquireAssetBytes({ ...hint, assetId, localName: parsed.resourceHints[assetId]?.archivePath ?? hint.localName }, pipelineChat, {
            isImage: true, listTitle: title, signal, ...(typeof maxRetries === 'number' ? { maxRetries } : {}),
        }) : undefined,
        onFailure: (assetId, reason) => onLog(`[PDF] [${title || id}] 图片获取失败 (${assetId}): ${reason}`, 'warn'),
    });
    diagnostics.push(...prepared.diagnostics);
    if (prepared.aborted) return { ok: false, id, title, error: 'aborted', diagnostics };
    return { ok: true, id, title, document, resources: prepared.resources, diagnostics, drift, usedLocalSnapshot, sourceVersion: parsed.sourceVersion, messageCount: document.messages.length };
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
