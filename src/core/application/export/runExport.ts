import { getAccount } from '../../api/accountRegistry.js';
import { getIndex, getDetail, getExportRecord, putExportRecord, getDirectoryHandle } from '../../storage/storageService.js';
import type { ConversationKey } from '../../domain/conversationKey.js';
import type { Account } from '../../domain/accountRegistry.js';
import { withConversationMetadata, type ReadonlyDomain } from '../../domain/runtimeValidation.js';
import type { AIProvider } from '../../provider/aiProvider.js';
import { createTaskProvider } from '../../provider/taskProvider.js';
import { createSourceResourceContext } from '../../provider/sourceResources.js';
import { composeDomainDocument } from '../../document/compose/composeDomainDocument.js';
import { collectDocumentResources } from '../../document/ast/resourceReferences.js';
import type { DocumentAst } from '../../document/ast/ast.js';
import type { PreparedResources } from '../../resources/resourceResult.js';
import { renderDocumentMarkdown } from '../../renderers/markdown/renderMarkdown.js';
import { renderDocumentHtml } from '../../renderers/html/renderHtml.js';
import { serializeDomainJson } from '../../renderers/json/serializeDomainJson.js';
import { planExportPaths, buildExportFiles, packageExportFiles } from '../../export/packaging/index.js';
import type { ExportArtifact } from '../../export/artifacts.js';
import { startBrowserDownload, writeToFolder } from '../../export/delivery/index.js';
import { compileDocumentPdf } from '../../export/pdf/compileDocumentPdf.js';
import { TypstSandboxCompiler } from '../../export/typst/typstSandboxCompiler.js';
import { resolveLocalFonts } from '../../export/typst/fonts/localFontProvider.js';
import { mountRuntimeFonts } from '../../export/typst/fonts/mountRuntimeFonts.js';
import { prepareExportResources } from './prepareExportResources.js';
import type { ExportRequest, ExportRecord, ExportProgress, ExportResult } from './types.js';

// Missing-resource diagnostics are expected when the user explicitly omits bytes.
const expectedMissingResource = new Set(['HTML_ASSET_UNRESOLVED', 'TYPST_V8_IMAGE_MISSING', 'TYPST_V8_INLINE_IMAGE_MISSING']);
const comparable = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value);
export function shouldSkipExport(record: ExportRecord | null, updatedAt: number | undefined, request: ExportRequest): boolean {
    return request.skipUnchanged && record?.status === 'ok' && record.format === request.format
        && comparable(record.chatTime) && comparable(updatedAt) && record.chatTime >= updatedAt;
}
function isFresh(conversation: ReadonlyDomain): boolean {
    return conversation.detail.quality.status === 'complete' && comparable(conversation.detail.savedAt)
        && comparable(conversation.index.updatedAt) && conversation.detail.savedAt >= conversation.index.updatedAt;
}
interface PendingExport {
    key: ConversationKey;
    account: Account;
    conversation: ReadonlyDomain;
    document?: DocumentAst;
    prepared: PreparedResources;
}
interface ExportGroup { key: ConversationKey; record: ExportRecord; files: ExportArtifact[] }

/** One runtime task for every trigger and format. No sessions, checkpoints or delivery receipts. */
export async function runExport(request: ExportRequest, options: {
    onProgress?: (progress: ExportProgress) => void;
    signal?: AbortSignal;
} = {}): Promise<ExportResult> {
    const failed: ConversationKey[] = [];
    const result = { exported: 0, skipped: 0, partial: 0, failed, aborted: false };
    const signal = options.signal ?? new AbortController().signal;
    const resources = createSourceResourceContext();
    const providers = new Map<string, AIProvider>();
    let compiler: import('../../export/typst/typstSandboxCompiler.js').TypstSandboxCompiler | undefined;
    let pdfFonts: import('../../export/typst/fonts/localFontProvider.js').LocalFontResolution | undefined;
    const cancelled = (error: unknown): boolean => signal.aborted || (error instanceof Error && error.name === 'AbortError');
    const fail = (keys: readonly ConversationKey[]): void => {
        for (const key of keys) {
            if (!failed.some(item => item.accountId === key.accountId && item.conversationId === key.conversationId)) failed.push(key);
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
    const readLocal = async (key: ConversationKey): Promise<ReadonlyDomain | null> => {
        const index = await getIndex(key);
        const detail = await getDetail(key);
        return index && detail ? withConversationMetadata(detail, index) : null;
    };
    const finalize = async (groups: readonly ExportGroup[]): Promise<void> => {
        // Once Delivery returned, cancellation cannot suppress records for that group/ZIP.
        const exportedAt = Date.now();
        for (const group of groups) {
            try {
                await putExportRecord(group.key, { ...group.record, exportedAt });
                result.exported++;
                if (group.record.status === 'partial') result.partial++;
            } catch (error) {
                console.warn('[Gemini Exporter] ExportRecord write failed', group.key, error);
                fail([group.key]);
            }
        }
    };
    try {
        signal.throwIfAborted();
        const directory = request.delivery === 'folderWriter' ? await getDirectoryHandle() : null;
        if (request.delivery === 'folderWriter' && !directory) throw new Error('Export directory unavailable');
        const pending: PendingExport[] = [];
        for (const [index, key] of request.keys.entries()) {
            signal.throwIfAborted();
            options.onProgress?.({ current: index + 1, total: request.keys.length, key });
            try {
                const account = await getAccount(key.accountId);
                if (!account) throw new Error('Account unavailable');
                const localIndex = await getIndex(key);
                const record = request.skipUnchanged ? await getExportRecord(key) : null;
                if (localIndex && shouldSkipExport(record, localIndex.updatedAt, request)) {
                    result.skipped++;
                    continue;
                }
                let conversation = await readLocal(key);
                if (!conversation || !isFresh(conversation)) {
                    try { await providerFor(account.providerId).fetchConversationDetail(key.accountId, key.conversationId, signal); }
                    catch (error) { if (cancelled(error)) throw error; }
                    // Even a failed refresh may have committed useful facts. Never export a response DTO.
                    conversation = await readLocal(key);
                }
                signal.throwIfAborted();
                if (!conversation) throw new Error('No usable local Detail');
                const document = request.format === 'json' ? undefined : composeDomainDocument(conversation, account);
                const references = document && collectDocumentResources(document);
                const requiredIds = !request.includeAssets ? new Set<string>() : request.format === 'json'
                    ? new Set(conversation.detail.assets.map(asset => asset.id))
                    : request.format === 'pdf' ? references!.imageIds : references!.referencedIds;
                const prepared = await prepareExportResources(conversation.detail.assets, requiredIds,
                    (asset, abort) => providerFor(account.providerId).acquireResource(key, asset, abort), signal);
                pending.push({ key, account, conversation, document, prepared });
            } catch (error) {
                if (cancelled(error)) throw error;
                console.warn('[Gemini Exporter] Export preparation failed', key, error);
                fail([key]);
            }
        }
        signal.throwIfAborted();
        let plans: ReturnType<typeof planExportPaths>;
        try {
            plans = planExportPaths(pending, request.format);
        } catch (error) {
            if (cancelled(error)) throw error;
            console.warn('[Gemini Exporter] Export path planning failed', error);
            fail(pending.map(item => item.key));
            return result;
        }
        const groups: ExportGroup[] = [];
        for (const [index, item] of pending.entries()) {
            signal.throwIfAborted();
            try {
                const { conversation, document, prepared, key } = item;
                const plan = plans[index];
                let partial = conversation.detail.quality.status !== 'complete'
                    || (comparable(conversation.detail.savedAt) && comparable(conversation.index.updatedAt)
                        && conversation.detail.savedAt < conversation.index.updatedAt)
                    || [...prepared.values()].some(value => !value.ok);
                let content: string | Uint8Array;
                switch (request.format) {
                    case 'json': content = serializeDomainJson(conversation, item.account, plan.resources); break;
                    case 'markdown': content = renderDocumentMarkdown(document!, plan.resources); break;
                    case 'html': {
                        const html = renderDocumentHtml(document!, plan.resources);
                        content = html.html;
                        partial ||= html.diagnostics.some(diagnostic => diagnostic.severity !== 'info' && (request.includeAssets || !expectedMissingResource.has(diagnostic.code)));
                        break;
                    }
                    case 'pdf': {
                        if (!compiler) {
                            compiler = new TypstSandboxCompiler();
                            const mounted = await mountRuntimeFonts(await resolveLocalFonts(), compiler);
                            pdfFonts = mounted.effectiveFonts;
                        }
                        const pdf = await compileDocumentPdf(document!, plan.resources, prepared, compiler,
                            { signal, reportProgress() {} });
                        content = pdf.pdfBytes;
                        partial ||= [...(pdfFonts?.diagnostics ?? []), ...pdf.diagnostics].some(diagnostic => diagnostic.severity !== 'info' && (request.includeAssets || !expectedMissingResource.has(diagnostic.code)));
                        break;
                    }
                }
                signal.throwIfAborted();
                const group: ExportGroup = { key, files: buildExportFiles(request.format, plan, content, prepared),
                    record: { exportedAt: 0, format: request.format, status: partial ? 'partial' : 'ok',
                        ...(comparable(conversation.detail.savedAt) ? { chatTime: conversation.detail.savedAt } : {}) } };
                if (request.delivery === 'folderWriter' && !request.useZip) {
                    await writeToFolder(group.files, directory!);
                    await finalize([group]);
                } else groups.push(group);
            } catch (error) {
                if (cancelled(error)) throw error;
                console.warn('[Gemini Exporter] Export format or delivery failed', item.key, error);
                fail([item.key]);
            }
        }
        signal.throwIfAborted();
        if (groups.length) {
            try {
                const files = await packageExportFiles(groups.map(group => group.files), request.delivery, request.useZip);
                signal.throwIfAborted();
                if (request.delivery === 'browserDownload') {
                    if (files.length !== 1) throw new Error('Browser delivery requires one final file');
                    await startBrowserDownload(files[0]);
                } else await writeToFolder(files, directory!);
                await finalize(groups);
            } catch (error) {
                if (cancelled(error)) throw error;
                console.warn('[Gemini Exporter] Batch delivery failed', error);
                fail(groups.map(group => group.key));
            }
        }
        result.aborted = signal.aborted;
        return result;
    } catch (error) {
        if (!cancelled(error)) throw error;
        result.aborted = true;
        return result;
    } finally {
        resources.release();
        compiler?.dispose();
    }
}
