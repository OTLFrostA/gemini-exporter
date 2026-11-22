import { applicationHost } from '../host.js';
import type { AIProvider } from '../../l1/client/aiProvider.js';
import type { Account } from '../../l2/accountRegistry.js';
import type { DomainConversationIndex } from '../../l2/conversationIndex.js';
import type { ConversationKey } from '../../l2/conversationKey.js';
import type { ReadonlyDomain } from '../../l2/runtimeValidation.js';
import { getExportRecord, getIndex, listExportRecords, listIndexes } from '../../l3a/storageService.js';
import { collectDocumentResources } from '../../l3b/ast/resourceReferences.js';
import { composeDomainDocument } from '../../l3b/compose/composeDomainDocument.js';
import { folderFileExists } from '../../l4/delivery/index.js';
import type { ExportPathPlan } from '../../l4/packaging/index.js';
import type { Diagnostic } from '../../shared/diagnostics/diagnostic.js';
import type { PreparedResources, ResourceResult } from '../../shared/resources/resourceResult.js';
import type { createSemaphore } from '../../shared/utils/concurrency.js';
import { prepareExportResources } from './prepareExportResources.js';
import type { ExportDiagnostic, ExportRecord, ExportRequest } from './types.js';
import {
    isFresh,
    type ExportPendingContent,
    type ExportRunOptions,
    type ExportSource,
    type PendingExport,
} from './exportPolicy.js';

export function createMetadataLoader(request: ExportRequest) {
    const accountKeyCounts = new Map<string, number>();
    for (const k of request.keys) {
        accountKeyCounts.set(k.accountId, (accountKeyCounts.get(k.accountId) ?? 0) + 1);
    }
    const accountCache = new Map<string, Promise<Account | null>>();
    const accountMetaCache = new Map<string, Promise<{
        indexes: ReadonlyMap<string, DomainConversationIndex>;
        records: Readonly<Record<string, ExportRecord>>;
    }>>();

    const loadAccountCached = (accountId: string): Promise<Account | null> => {
        const cached = accountCache.get(accountId);
        if (cached) return cached;
        const pendingAccount = applicationHost().getAccount(accountId).catch((error: unknown) => {
            accountCache.delete(accountId);
            throw error;
        });
        accountCache.set(accountId, pendingAccount);
        return pendingAccount;
    };

    const loadLocalMetadata = async (
        targetKey: ConversationKey,
        isRepeatKey: boolean,
    ): Promise<[Account | null, DomainConversationIndex | null, ExportRecord | null]> => {
        if (!isRepeatKey && (accountKeyCounts.get(targetKey.accountId) ?? 0) >= 4) {
            let metaPromise = accountMetaCache.get(targetKey.accountId);
            if (!metaPromise) {
                metaPromise = Promise.all([listIndexes(targetKey.accountId), listExportRecords(targetKey.accountId)])
                    .then(([rows, recordMap]) => ({
                        indexes: new Map(rows.map(row => [row.key.conversationId, row])),
                        records: recordMap,
                    }))
                    .catch((error: unknown) => {
                        accountMetaCache.delete(targetKey.accountId);
                        throw error;
                    });
                accountMetaCache.set(targetKey.accountId, metaPromise);
            }
            const [account, meta] = await Promise.all([loadAccountCached(targetKey.accountId), metaPromise]);
            return [account, meta.indexes.get(targetKey.conversationId) ?? null, meta.records[targetKey.conversationId] ?? null];
        }
        return Promise.all([loadAccountCached(targetKey.accountId), getIndex(targetKey), getExportRecord(targetKey)]);
    };

    return { loadLocalMetadata };
}

export function evaluateRefreshNeed(
    request: ExportRequest,
    options: ExportRunOptions,
    providerFor: (id: string) => AIProvider,
    targetKey: ConversationKey,
    account: Account,
    conversation: ReadonlyDomain | null,
): { needed: boolean; needsSourceReaders: boolean } {
    const needsSourceReaders = Boolean(request.includeAssets && conversation?.detail.assets.some(asset =>
        !options.importedResources?.has(targetKey, asset.id)
        && !/^https:\/\//i.test(asset.sourceUri ?? '')
        && !asset.document?.contentMarkdown
        && providerFor(account.providerId).canAcquireResourceDirectly?.(asset) !== true));
    const needed = Boolean(options.refreshDetail || !conversation || !isFresh(conversation) || needsSourceReaders);
    return { needed, needsSourceReaders };
}

export function describeExportSource(
    request: ExportRequest,
    key: ConversationKey,
    account: Account,
    snapshot: ReadonlyDomain,
    refreshFailed: boolean,
    folderBaseName?: string,
): ExportSource {
    const view: ExportPendingContent = request.format === 'json'
        ? { format: 'json' }
        : { format: request.format, document: composeDomainDocument(snapshot, account) };
    const references = view.format === 'json'
        ? { referencedIds: new Set(snapshot.detail.assets.map(asset => asset.id)), fileIds: new Set<string>() }
        : collectDocumentResources(view.document);
    return {
        ...view,
        key,
        account,
        conversation: snapshot,
        refreshFailed,
        requiredIds: request.includeAssets ? references.referencedIds : new Set<string>(),
        fileIds: references.fileIds,
        ...(folderBaseName ? { folderBaseName } : {}),
    };
}

export async function prepareSourceResources(params: {
    source: ExportSource;
    plan: ExportPathPlan | undefined;
    previous?: PreparedResources;
    directory: FileSystemDirectoryHandle | null;
    signal: AbortSignal;
    options: ExportRunOptions;
    providerFor: (id: string) => AIProvider;
    assetAcquireSemaphore: ReturnType<typeof createSemaphore>;
    downloadedResources: Set<string>;
    diagnose: (diagnostic: ExportDiagnostic) => void;
}): Promise<PendingExport> {
    const {
        source,
        plan,
        previous,
        directory,
        signal,
        options,
        providerFor,
        assetAcquireSemaphore,
        downloadedResources,
        diagnose,
    } = params;
    const { key, account } = source;
    const reused = new Set<string>();
    if (directory && plan) {
        const checks = [...source.requiredIds].flatMap(id => {
            const path = plan.resources[id];
            return path ? [{ id, path }] : [];
        });
        const remaining = checks.values();
        let stopped = false;
        const checkExisting = async (): Promise<void> => {
            try {
                for (const { id, path } of remaining) {
                    if (stopped) return;
                    signal.throwIfAborted();
                    if (await folderFileExists(directory, path)) reused.add(id);
                }
            } catch (error) {
                stopped = true;
                throw error;
            }
        };
        // Independent read-only folder probes must not serialize every attachment.
        const settled = await Promise.allSettled(Array.from({ length: Math.min(4, checks.length) }, checkExisting));
        for (const outcome of settled) if (outcome.status === 'rejected') throw outcome.reason;
    }
    // A refresh retries failed identities only; successful bytes remain task-owned.
    const requiredIds = new Set([...source.requiredIds].filter(id => !reused.has(id) && !previous?.get(id)?.ok));
    const acquired = await prepareExportResources(
        source.conversation.detail.assets,
        requiredIds,
        (asset, abort) => assetAcquireSemaphore.run(() => {
            const observe = (diagnostic: Diagnostic) => diagnose({
                key,
                stage: 'resource',
                ...diagnostic,
                details: { resourceId: asset.id, providerId: account.providerId, observation: diagnostic.details ?? null },
            });
            return options.importedResources?.has(key, asset.id)
                ? options.importedResources.acquire(key, asset, abort,
                    () => providerFor(account.providerId).acquireResource(key, asset, abort, observe), observe)
                : providerFor(account.providerId).acquireResource(key, asset, abort, observe);
        }, abort ?? signal),
        signal,
        (completed, total, result) => {
            if (result?.ok) downloadedResources.add(JSON.stringify([key.accountId, key.conversationId, result.resourceId]));
            options.onResourceProgress?.({
                key,
                completed: completed + reused.size,
                total: total + reused.size,
                downloaded: downloadedResources.size,
            });
            diagnose({
                key,
                stage: 'resource',
                severity: 'info',
                code: 'RESOURCE_ACQUISITION_PROGRESS',
                message: `Attachments ${completed}/${total}`,
                details: { completed, total, downloaded: downloadedResources.size },
            });
        },
    );
    const prepared = new Map<string, ResourceResult>();
    for (const id of source.requiredIds) {
        const value = acquired.get(id) ?? previous?.get(id);
        if (value && !reused.has(id)) prepared.set(id, value);
    }
    return { ...source, prepared, reused };
}
