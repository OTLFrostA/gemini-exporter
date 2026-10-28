import { OperationError, operationIssue, operationError } from '../../shared/errors/operationError.js';
import { ConfirmedSourceEmptyError } from '../../l1/client/sourceErrors.js';
import { readConversation } from '../../l2/readConversation.js';
import { getSettings } from '../settings/index.js';
import { getAccount } from '../../runtime/api/accountRegistry.js';
import { getIndex, getExportRecord, putExportRecord, getDirectoryHandle } from '../../l3a/storageService.js';
import type { ConversationKey } from '../../l2/conversationKey.js';
import type { Account } from '../../l2/accountRegistry.js';
import { type ReadonlyDomain } from '../../l2/runtimeValidation.js';
import type { AIProvider } from '../../l1/client/aiProvider.js';
import { createTaskProvider } from '../../l1/client/taskProvider.js';
import { createSourceResourceContext } from '../../l1/resources/sourceResources.js';
import { composeDomainDocument } from '../../l3b/compose/composeDomainDocument.js';
import { collectDocumentResources } from '../../l3b/ast/resourceReferences.js';
import type { DocumentAst } from '../../l3b/ast/ast.js';
import { missingResource, type ResourceFailure } from '../../shared/resources/resourceResult.js';
import type { PreparedResources } from '../../shared/resources/resourceResult.js';
import { renderDocumentMarkdown } from '../../l4/format/markdown/renderMarkdown.js';
import { renderDocumentHtml } from '../../l4/format/html/renderHtml.js';
import { renderDocumentDocx } from '../../l4/format/docx/renderDocx.js';
import { serializeDomainJson } from '../../l4/format/json/serializeDomainJson.js';
import { createExportPathPlanner, planExportPaths, buildExportFiles, packageExportFiles, type ExportPathPlan } from '../../l4/packaging/index.js';
import type { ExportArtifact } from '../../l4/artifacts.js';
import { startBrowserDownload, writeToFolder } from '../../l4/delivery/index.js';
import { compileDocumentPdf } from '../../l4/format/pdf/compileDocumentPdf.js';
import { TypstSandboxCompiler } from '../../l4/format/pdf/typst/typstSandboxCompiler.js';
import { resolveLocalFonts } from '../../l4/format/pdf/typst/fonts/localFontProvider.js';
import { mountRuntimeFonts } from '../../l4/format/pdf/typst/fonts/mountRuntimeFonts.js';
import { prepareExportResources } from './prepareExportResources.js';
import type { ExportRequest, ExportRecord, ExportProgress, ExportResult, ExportItemUpdate, ExportDiagnostic } from './types.js';

// Domain and ExportRecord source versions must be finite, safe epoch-millisecond integers.
const comparable = (value: number | undefined): value is number => value !== undefined && Number.isSafeInteger(value);
export function shouldSkipExport(record: ExportRecord | null, updatedAt: number | undefined, request: ExportRequest): boolean {
    if (!request.skipUnchanged || !record || record.format !== request.format) return false;
    const issues = record.attachmentIssues;
    const expiredOnly = record.status === 'partial' && record.otherContentMissing !== true
        && issues !== undefined && issues.length > 0
        && issues.every(issue => issue.code === 'RESOURCE_SOURCE_EXPIRED' && issue.httpStatus === 404);
    return (record.status === 'ok' || expiredOnly) && comparable(record.chatTime)
        && comparable(updatedAt) && record.chatTime >= updatedAt;
}
function isFresh(conversation: ReadonlyDomain): boolean {
    return conversation.detail.quality.status === 'complete' && comparable(conversation.detail.savedAt)
        && comparable(conversation.index.updatedAt) && conversation.detail.savedAt >= conversation.index.updatedAt;
}
type PendingContent = { format: 'json'; document?: never }
    | { format: Exclude<ExportRequest['format'], 'json'>; document: DocumentAst };
type PendingExport = PendingContent & {
    key: ConversationKey;
    account: Account;
    conversation: ReadonlyDomain;
    prepared: PreparedResources;
    refreshFailed: boolean;
    fileIds: ReadonlySet<string>;
    folderBaseName?: string;
}
interface ExportGroup { key: ConversationKey; record: Omit<ExportRecord, 'exportedAt'>; files: ExportArtifact[] }

/** One runtime task for every trigger and format. No sessions, checkpoints or delivery receipts. */
export async function runExport(request: ExportRequest, options: {
    onProgress?: (progress: ExportProgress) => void;
    /** Settled items and staged browser files; only 'exported' carries a committed record. */
    onItemUpdate?: (update: ExportItemUpdate) => void;
    onDiagnostic?: (diagnostic: ExportDiagnostic) => void;
    signal?: AbortSignal;
    /** A completed reply requires a new source snapshot even if cached timestamps match. */
    refreshDetail?: boolean;
    /** User-selected ZIP readers owned by the open workbench, released by that page. */
    importedResources?: import('../../l1/resources/sourceResources.js').SourceResourceContext;
} = {}): Promise<ExportResult> {
    const failed: ConversationKey[] = [];
    const result: ExportResult = { exported: 0, skipped: 0, partial: 0, failed, aborted: false };
    const signal = options.signal ?? new AbortController().signal;
    const resources = createSourceResourceContext();
    const providers = new Map<string, AIProvider>();
    let compiler: import('../../l4/format/pdf/typst/typstSandboxCompiler.js').TypstSandboxCompiler | undefined;
    let locale: 'zh' | 'en' = 'en';
    let fontDiagnostics: readonly import('../../shared/diagnostics/diagnostic.js').Diagnostic[] = [];
    const cancelled = (error: unknown): boolean => signal.aborted || (error instanceof Error && error.name === 'AbortError');
    const report = (update: ExportItemUpdate): void => {
        try { options.onItemUpdate?.(update); }
        catch (error) { console.warn('[Gemini Exporter] Export progress listener failed', error); }
    };
    const diagnose = (diagnostic: ExportDiagnostic): void => {
        try { options.onDiagnostic?.(diagnostic); }
        catch (error) { console.warn('[Gemini Exporter] Export diagnostic listener failed', error); }
    };
    const fail = (keys: readonly ConversationKey[], _error?: unknown): void => {
        const issue = operationIssue(_error);
        for (const key of keys) {
            const diagnostic: ExportDiagnostic = { key, stage: 'export', code: 'EXPORT_FAILED', severity: 'error', issue,
                message: issue.message };
            diagnose(diagnostic);
            if (!failed.some(item => item.accountId === key.accountId && item.conversationId === key.conversationId)) {
                failed.push(key);
                report({ key, status: 'failed', diagnostic });
            }
        }
    };
    const providerFor = (id: string): AIProvider => {
        let provider = providers.get(id);
        if (!provider) {
            provider = createTaskProvider(id, resources);
            providers.set(id, provider);
        }
        return provider;
    };
    const readLocal = readConversation;
    const finalize = async (groups: readonly ExportGroup[]): Promise<void> => {
        // Once Delivery returned, cancellation cannot suppress records for that group/ZIP.
        const exportedAt = Date.now();
        for (const group of groups) {
            try {
                const record: ExportRecord = { ...group.record, exportedAt };
                await putExportRecord(group.key, record);
                result.exported++;
                if (group.record.status === 'partial') { result.partial++; result.otherPartial ??= 0; }
                if (group.record.attachmentIssues?.length) result.attachmentIssues = [...(result.attachmentIssues ?? []), ...group.record.attachmentIssues];
                if (group.record.attachmentIssues?.some(issue => issue.code === 'RESOURCE_SOURCE_EXPIRED')) result.expiredConversations = (result.expiredConversations ?? 0) + 1;
                if (group.record.status === 'partial' && (!group.record.attachmentIssues?.length
                    || group.record.otherContentMissing)) result.otherPartial = (result.otherPartial ?? 0) + 1;
                report({ key: group.key, status: 'exported', record });
            } catch (error) {
                console.warn('[Gemini Exporter] ExportRecord write failed', group.key, error);
                fail([group.key], operationError(error, 'RECORD_WRITE_FAILED'));
            }
        }
    };
    const renderGroup = async (item: PendingExport, plan: ExportPathPlan): Promise<ExportGroup> => {
        const { conversation, document, prepared, key, format } = item;
        let otherContentMissing = item.refreshFailed || conversation.detail.quality.status !== 'complete'
            || (comparable(conversation.detail.savedAt) && comparable(conversation.index.updatedAt)
                && conversation.detail.savedAt < conversation.index.updatedAt);
        if (conversation.detail.quality.status !== 'complete') diagnose({ key, stage: 'detail',
            severity: 'warning', code: 'DETAIL_NOT_COMPLETE', message: 'Persisted source detail is not complete',
            details: { quality: conversation.detail.quality.status, messageCount: conversation.detail.messages.length } });
        if (comparable(conversation.detail.savedAt) && comparable(conversation.index.updatedAt)
            && conversation.detail.savedAt < conversation.index.updatedAt) diagnose({ key, stage: 'detail',
            severity: 'warning', code: 'DETAIL_STALE', message: 'Detail source timestamp is older than Index',
            details: { savedAt: conversation.detail.savedAt, updatedAt: conversation.index.updatedAt } });
        const failures = Object.fromEntries([...prepared].filter((entry): entry is [string, ResourceFailure] => !entry[1].ok));
        for (const failure of Object.values(failures)) diagnose({ key, stage: 'resource', severity: 'warning',
            code: failure.code, message: failure.reason, issue: failure.issue,
            details: { resourceId: failure.resourceId, httpStatus: failure.httpStatus ?? null } });
        const renderOptions = { locale, resourceFailures: failures };
        let partial = otherContentMissing || Object.keys(failures).length > 0;
        let content: string | Uint8Array;
        switch (format) {
            case 'json': content = serializeDomainJson(conversation, item.account, plan.resources); break;
            case 'markdown': content = renderDocumentMarkdown(document, plan.resources, renderOptions); break;
            case 'docx': {
                content = await renderDocumentDocx(document, plan.resources, prepared, renderOptions);
                break;
            }
            case 'html': {
                const html = renderDocumentHtml(document, plan.resources, renderOptions);
                for (const diagnostic of html.diagnostics) diagnose({ key, stage: 'html', ...diagnostic });
                content = html.html;
                otherContentMissing ||= html.diagnostics.some(diagnostic => diagnostic.code === 'FORMAT_CONTENT_OMITTED');
                partial ||= otherContentMissing;
                break;
            }
            case 'pdf': {
                if (!compiler) {
                    compiler = new TypstSandboxCompiler();
                    fontDiagnostics = (await mountRuntimeFonts(await resolveLocalFonts(), compiler)).effectiveFonts.diagnostics;
                }
                for (const diagnostic of fontDiagnostics) diagnose({ key, stage: 'pdf', ...diagnostic });
                const pdf = await compileDocumentPdf(document, plan.resources, prepared, compiler,
                    { signal, reportProgress() {} }, renderOptions);
                content = pdf.pdfBytes;
                for (const diagnostic of pdf.diagnostics) {
                    diagnose({ key, stage: 'pdf', ...diagnostic });
                    if (diagnostic.code === 'FORMAT_CONTENT_OMITTED' && diagnostic.path?.startsWith('asset:')) {
                        const id = diagnostic.path.slice(6);
                        failures[id] = missingResource(id, diagnostic.message, 'RESOURCE_PROCESSING_FAILED');
                    }
                }
                otherContentMissing ||= pdf.diagnostics.some(diagnostic => diagnostic.code === 'FORMAT_CONTENT_OMITTED' && !diagnostic.path?.startsWith('asset:'));
                partial ||= Object.keys(failures).length > 0;
                partial ||= otherContentMissing;
                break;
            }
        }
        signal.throwIfAborted();
        const group: ExportGroup = { key, files: buildExportFiles(request.format, plan, content, prepared),
            record: { format: request.format, status: partial ? 'partial' : 'ok',
                ...(request.delivery === 'folderWriter'
                    ? { folderBaseName: plan.fileName.replace(/\.[^.]+$/, '') }
                    : item.folderBaseName ? { folderBaseName: item.folderBaseName } : {}),
                ...(partial ? { otherContentMissing } : {}),
                ...(Object.keys(failures).length ? { attachmentIssues: Object.values(failures).map(failure => {
                    const asset = conversation.detail.assets.find(asset => asset.id === failure.resourceId);
                    const sourceUri = asset?.sourceUri;
                    return { resourceId: failure.resourceId, name: asset?.name || failure.resourceId, code: failure.code,
                        ...(failure.httpStatus ? { httpStatus: failure.httpStatus } : {}),
                        ...(sourceUri && /^https:\/\//i.test(sourceUri) ? { sourceUrl: sourceUri } : {}) };
                }) } : {}),
                ...(comparable(conversation.detail.savedAt) ? { chatTime: conversation.detail.savedAt } : {}) } };
        return group;
    };
    try {
        signal.throwIfAborted();
        // The user setting controls only renderer-owned text, not Domain, JSON, paths or records.
        const language = request.format === 'json' ? undefined : (await getSettings()).language;
        locale = language ?? (navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en');
        const directory = request.delivery === 'folderWriter' ? await getDirectoryHandle() : null;
        if (request.delivery === 'folderWriter' && !directory) throw new OperationError('DIRECTORY_UNAVAILABLE', 'Export directory unavailable');
        const folderPlanner = directory ? createExportPathPlanner(request.format) : undefined;
        const pending: PendingExport[] = [];
        for (const [index, key] of request.keys.entries()) {
            signal.throwIfAborted();
            options.onProgress?.({ current: index + 1, total: request.keys.length, key });
            try {
                // These local facts are independent; don't serialize three storage round trips.
                const [account, localIndex, record] = await Promise.all([
                    getAccount(key.accountId), getIndex(key),
                    getExportRecord(key),
                ]);
                if (!account) throw new OperationError('ACCOUNT_UNAVAILABLE', 'Account unavailable');
                if (!options.refreshDetail && localIndex && shouldSkipExport(record, localIndex.updatedAt, request)) {
                    result.skipped++;
                    report({ key, status: 'skipped' });
                    continue;
                }
                let conversation = await readLocal(key);
                let refreshFailed = false;
                let refreshFailure: { error: unknown } | undefined;
                // Inline packets and expiring locators are task-owned, never cached bytes.
                // A fresh Detail alone cannot rehydrate these resources in a later export.
                const needsSourceReaders = request.includeAssets && conversation?.detail.assets.some(asset =>
                    !options.importedResources?.has(key, asset.id) && !/^https:\/\//i.test(asset.sourceUri ?? '') && !asset.document?.contentMarkdown
                    && providerFor(account.providerId).canAcquireResourceDirectly?.(asset) !== true);
                if (options.refreshDetail || !conversation || !isFresh(conversation) || needsSourceReaders) {
                    try { await providerFor(account.providerId).fetchConversationDetail(key.accountId, key.conversationId, signal,
                            diagnostic => diagnose({ key, stage: 'source_parse', ...diagnostic })); }
                    catch (error) {
                        // L1 has reliably confirmed deletion and L2 has removed the local Key.
                        // Unlike a transient refresh failure, this must never fall back to old Detail.
                        if (cancelled(error) || (error instanceof Error && error.message === 'conversation_not_found')) throw error;
                        if (error instanceof ConfirmedSourceEmptyError) {
                            result.skipped++;
                            diagnose({ key, stage: 'source_refresh', code: 'SOURCE_CONVERSATION_EMPTY', message: error.message });
                            report({ key, status: 'skipped' });
                            continue;
                        }
                        refreshFailed = true;
                        refreshFailure = { error };
                    }
                    // Even a failed refresh may have committed useful facts. Never export a response DTO.
                    conversation = await readLocal(key);
                    if (conversation && refreshFailure) {
                        const issue = operationIssue(refreshFailure.error);
                        diagnose({ key, stage: 'source_refresh', severity: 'warning', code: 'SOURCE_REFRESH_FAILED', issue, message: issue.message });
                    }
                }
                signal.throwIfAborted();
                if (!conversation) {
                    if (refreshFailure) throw refreshFailure.error;
                    throw new OperationError('DETAIL_UNAVAILABLE', 'No usable local Detail');
                }
                const prepare = async (snapshot: ReadonlyDomain): Promise<PendingExport> => {
                    const view: PendingContent = request.format === 'json' ? { format: 'json' }
                        : { format: request.format, document: composeDomainDocument(snapshot, account) };
                    const references = view.format === 'json'
                        ? { referencedIds: new Set(snapshot.detail.assets.map(asset => asset.id)), fileIds: new Set<string>() }
                        : collectDocumentResources(view.document);
                    const requiredIds = request.includeAssets ? references.referencedIds : new Set<string>();
                    // File nodes are exported as originals even for PDF; Image nodes may be embedded.
                    const fileIds = references.fileIds;
                    const prepared = await prepareExportResources(snapshot.detail.assets, requiredIds,
                        (asset, abort) => options.importedResources?.has(key, asset.id)
                            ? options.importedResources.acquire(key, asset, abort,
                                () => providerFor(account.providerId).acquireResource(key, asset, abort))
                            : providerFor(account.providerId).acquireResource(key, asset, abort), signal);
                    return { ...view, key, account, conversation: snapshot, prepared, fileIds, refreshFailed,
                        ...(record?.folderBaseName ? { folderBaseName: record.folderBaseName } : {}) };
                };
                let item = await prepare(conversation);
                // Body timestamps do not establish whether signed resource URLs remain usable.
                // Refresh once on an actual access/expiry response, then rebuild references from
                // committed facts: a new source URI may also change the resource's identity.
                if ([...item.prepared.values()].some(value => !value.ok
                    && value.httpStatus !== undefined && [401, 403, 404, 410].includes(value.httpStatus))) {
                    let refreshed = false;
                    try {
                        await providerFor(account.providerId).fetchConversationDetail(key.accountId, key.conversationId, signal,
                            diagnostic => diagnose({ key, stage: 'source_parse', ...diagnostic }));
                        refreshed = true;
                    } catch (error) {
                        if (cancelled(error) || (error instanceof Error && error.message === 'conversation_not_found')) throw error;
                        diagnose({ key, stage: 'resource_refresh', severity: 'warning', code: 'RESOURCE_REFRESH_FAILED', issue: operationIssue(error),
                            message: error instanceof Error ? error.message : String(error) });
                        // Cached body freshness is unchanged; retain the original attachment failures.
                    }
                    signal.throwIfAborted();
                    if (refreshed) {
                        conversation = await readLocal(key);
                        if (!conversation) throw new OperationError('DETAIL_UNAVAILABLE', 'No usable local Detail after resource refresh');
                        refreshFailed = false;
                        item = await prepare(conversation);
                    }
                }
                const { prepared, fileIds } = item;
                if (folderPlanner && directory) {
                    const group = await renderGroup(item, folderPlanner(conversation, prepared, fileIds, item.folderBaseName));
                    await writeToFolder(group.files, directory);
                    await finalize([group]);
                } else pending.push(item);
            } catch (error) {
                if (cancelled(error)) throw error;
                console.warn('[Gemini Exporter] Export item failed', key, error);
                fail([key], error);
            } finally {
                // Free captured inline/Takeout readers as soon as this Folder item settles.
                if (folderPlanner) resources.releaseConversation(key);
            }
        }
        signal.throwIfAborted();
        let plans: readonly ExportPathPlan[];
        try {
            plans = folderPlanner ? [] : planExportPaths(pending, request.format);
        } catch (error) {
            if (cancelled(error)) throw error;
            console.warn('[Gemini Exporter] Export path planning failed', error);
            fail(pending.map(item => item.key), operationError(error, 'PACKAGING_FAILED'));
            return result;
        }
        const groups: ExportGroup[] = [];
        for (const [index, item] of pending.entries()) {
            signal.throwIfAborted();
            try {
                const group = await renderGroup(item, plans[index]);
                groups.push(group);
                // Browser batches are staged only. Do not mark success until the final download is initiated.
                report({ key: group.key, status: 'prepared' });
            } catch (error) {
                if (cancelled(error)) throw error;
                console.warn('[Gemini Exporter] Export format or delivery failed', item.key, error);
                fail([item.key], error);
            }
        }
        signal.throwIfAborted();
        if (groups.length) {
            try {
                let files: ExportArtifact[];
                try { files = await packageExportFiles(groups.map(group => group.files), request.delivery); }
                catch (error) { throw operationError(error, 'PACKAGING_FAILED'); }
                signal.throwIfAborted();
                if (request.delivery === 'browserDownload') {
                    if (files.length !== 1) throw new Error('Browser delivery requires one final file');
                    await startBrowserDownload(files[0]);
                } else {
                    if (!directory) throw new OperationError('DIRECTORY_UNAVAILABLE', 'Export directory unavailable');
                    await writeToFolder(files, directory);
                }
                await finalize(groups);
            } catch (error) {
                if (cancelled(error)) throw error;
                console.warn('[Gemini Exporter] Batch delivery failed', error);
                fail(groups.map(group => group.key), error);
            }
        }
        result.aborted = signal.aborted;
        return result;
    } catch (error) {
        diagnose({ stage: 'run', code: cancelled(error) ? 'EXPORT_CANCELLED' : 'EXPORT_RUN_FAILED',
            severity: cancelled(error) ? 'info' : 'error', issue: operationIssue(error),
            message: error instanceof Error ? error.message : String(error) });
        if (!cancelled(error)) throw error;
        result.aborted = true;
        return result;
    } finally {
        resources.release();
        compiler?.dispose();
    }
}
