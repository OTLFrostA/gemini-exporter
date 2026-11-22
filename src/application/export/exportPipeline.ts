import { OperationError, operationIssue, operationError } from '../../shared/errors/operationError.js';
import type { Diagnostic } from '../../shared/diagnostics/diagnostic.js';
import { createSemaphore } from '../../shared/utils/concurrency.js';
import { ConfirmedSourceEmptyError } from '../../l1/client/sourceErrors.js';
import { readConversation } from '../../l2/readConversation.js';
import { getSettings } from '../settings/index.js';
import { getDirectoryHandle } from '../../l3a/storageService.js';
import type { ConversationKey } from '../../l2/conversationKey.js';
import type { ReadonlyDomain } from '../../l2/runtimeValidation.js';
import type { AIProvider } from '../../l1/client/aiProvider.js';
import { createTaskProvider } from '../../l1/client/taskProvider.js';
import { createSourceResourceContext } from '../../l1/resources/sourceResources.js';
import type { ResourceFailure } from '../../shared/resources/resourceResult.js';
import { createExportPathPlanner, planExportPaths, buildExportFiles, buildResourceFiles, type ExportPathPlan } from '../../l4/packaging/index.js';
import type { ExportRequest, ExportResult, ExportItemUpdate, ExportDiagnostic } from './types.js';
import {
    buildExportRecord,
    emitDetailDiagnostics,
    keyIdentity,
    needsResourceRefresh,
    shouldSkipExport,
    type ExportFormatRendererSession,
    type ExportGroup,
    type ExportRunOptions,
    type ExportSource,
    type PendingExport,
} from './exportPolicy.js';
import { createDeliveryCoordinator } from './folderCommitQueue.js';
import {
    createMetadataLoader,
    describeExportSource,
    evaluateRefreshNeed,
    prepareSourceResources,
} from './sourceResolver.js';

export { shouldSkipExport, type ExportFormatRendererSession, type ExportRunOptions } from './exportPolicy.js';

const MAX_PENDING_FOLDER_CONVERSATIONS = 8;

/** Core export workflow engine, decoupled from heavyweight format backends. */
export async function executeExportWithSession(
    request: ExportRequest,
    createRendererSession: () => ExportFormatRendererSession,
    options: ExportRunOptions = {},
): Promise<ExportResult> {
    const failed: ConversationKey[] = [];
    const result: ExportResult = { exported: 0, skipped: 0, partial: 0, failed, aborted: false };
    const controller = new AbortController();
    const signal = controller.signal;
    const cancel = (): void => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) cancel();
    else options.signal?.addEventListener('abort', cancel, { once: true });

    const downstreamSemaphore = createSemaphore(4);
    const assetAcquireSemaphore = createSemaphore(6);
    const detailPrefetchSemaphore = createSemaphore(3);
    const activeDownstream = new Set<Promise<void>>();
    let retireChain = Promise.resolve();
    const drainDownstream = async (): Promise<void> => {
        while (activeDownstream.size > 0) await Promise.all([...activeDownstream]);
        await retireChain;
    };

    interface PrefetchedDetailOutcome {
        readonly before: ReadonlyDomain | null;
        readonly needsSourceReaders: boolean;
        readonly diagnostics: readonly Diagnostic[];
        readonly error?: unknown;
    }
    const prefetchedDetails = new Map<number, Promise<PrefetchedDetailOutcome | null>>();
    let saveCancelledFiles: (() => Promise<void>) | undefined;
    const queued = new Map<string, Promise<void>>();
    const resources = createSourceResourceContext();
    const providers = new Map<string, AIProvider>();
    const downloadedResources = new Set<string>();
    const rendererSession = createRendererSession();
    let locale: 'zh' | 'en' = 'en';

    const stopOnRateLimit = (error: unknown): boolean => {
        if (!(error instanceof OperationError) || error.retryAt === undefined) return false;
        result.rateLimitedUntil = Math.max(result.rateLimitedUntil ?? 0, error.retryAt);
        controller.abort(error);
        return true;
    };
    const cancelled = (error: unknown): boolean =>
        stopOnRateLimit(error) || signal.aborted || (error instanceof Error && error.name === 'AbortError');
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
            const diagnostic: ExportDiagnostic = { key, stage: 'export', code: 'EXPORT_FAILED', severity: 'error', issue, message: issue.message };
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

    const delivery = createDeliveryCoordinator({
        request, result, signal, report, diagnose, fail, onBodyDelivered: options.onBodyDelivered,
    });

    const renderGroup = async (item: PendingExport, plan: ExportPathPlan): Promise<ExportGroup> => {
        const { conversation, prepared, key } = item;
        let otherContentMissing = item.refreshFailed || conversation.detail.quality.status !== 'complete';
        emitDetailDiagnostics(conversation, key, diagnose);
        const failures = Object.fromEntries([...prepared].filter((entry): entry is [string, ResourceFailure] => !entry[1].ok));
        for (const failure of Object.values(failures)) {
            diagnose({
                key, stage: 'resource', severity: 'warning', code: failure.code, message: failure.reason,
                issue: failure.issue, details: { resourceId: failure.resourceId, httpStatus: failure.httpStatus ?? null },
            });
        }
        const rendered = await rendererSession.render({
            ...(item.format === 'json' ? { format: 'json' } : { format: item.format, document: item.document }),
            key, account: item.account, conversation, prepared, resources: plan.resources, locale, failures, signal, diagnose,
        });
        if (rendered.otherContentMissing) otherContentMissing = true;
        signal.throwIfAborted();
        return {
            key,
            files: buildExportFiles(request.format, plan, rendered.content, prepared),
            record: buildExportRecord(request, item, plan, failures, otherContentMissing),
        };
    };

    try {
        signal.throwIfAborted();
        const language = request.format === 'json' ? undefined : (await getSettings()).language;
        locale = language ?? (navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en');
        const directory = request.delivery === 'folderWriter' ? await getDirectoryHandle() : null;
        if (request.delivery === 'folderWriter' && !directory) throw new OperationError('DIRECTORY_UNAVAILABLE', 'Export directory unavailable');
        const linked = request.format === 'markdown' || request.format === 'html' || request.format === 'json';
        const folderPlanner = !linked && directory ? createExportPathPlanner(request.format) : undefined;
        const resourceScope = crypto.randomUUID();
        const linkedPlanner = linked ? createExportPathPlanner(request.format, directory ? undefined : resourceScope) : undefined;
        const bodies: { group: ExportGroup; hasAttachments: boolean }[] = [];
        const settledBodies = new Map<ExportGroup, ExportGroup>();

        const deliverBrowserBodies = async (savingCancelled = false): Promise<void> => {
            const staged = bodies.filter(({ group }) => !delivery.isDelivered(group.key)
                && !failed.some(key => keyIdentity(key) === keyIdentity(group.key)));
            const groups = staged.map(({ group }) => {
                const settled = settledBodies.get(group);
                const files = new Map([...group.files, ...(settled?.files ?? [])].map(file => [file.fileName, file]));
                return { ...group, record: settled?.record ?? group.record, files: [...files.values()] };
            });
            try {
                await delivery.deliver(groups, directory, savingCancelled);
                for (const group of groups) delivery.bodyDelivered(group.key);
                await delivery.finalize(groups.filter((_, index) => !staged[index].hasAttachments || settledBodies.has(staged[index].group)));
            } catch (error) {
                if (cancelled(error) && !savingCancelled) throw error;
                fail(groups.map(group => group.key), error);
            }
        };
        if (linked && !directory) saveCancelledFiles = async () => {
            await drainDownstream();
            await deliverBrowserBodies(true);
        };

        const firstOccurrenceIndex = new Map<string, number>();
        for (const [idx, k] of request.keys.entries()) {
            const id = keyIdentity(k);
            if (!firstOccurrenceIndex.has(id)) firstOccurrenceIndex.set(id, idx);
        }
        const { loadLocalMetadata } = createMetadataLoader(request);
        const seenKeyIdentities = new Set<string>();
        const verifiedRemoteAccounts = new Set<string>();

        const scheduleLookaheadDetailPrefetch = (afterIndex: number): void => {
            if (signal.aborted || request.keys.length <= 2) return;
            let scheduled = 0;
            for (let target = afterIndex + 1; target < request.keys.length && scheduled < 4; target++) {
                if (prefetchedDetails.has(target)) { scheduled++; continue; }
                const candidateKey = request.keys[target];
                if (!verifiedRemoteAccounts.has(candidateKey.accountId)) continue;
                const id = keyIdentity(candidateKey);
                if (firstOccurrenceIndex.get(id) !== target || queued.has(id)) continue;
                scheduled++;
                const job = detailPrefetchSemaphore.run(async (): Promise<PrefetchedDetailOutcome | null> => {
                    if (signal.aborted) return null;
                    const [account, localIndex, record] = await loadLocalMetadata(candidateKey, false);
                    if (!account) return null;
                    if (!options.refreshDetail && localIndex && shouldSkipExport(record, localIndex.updatedAt, request)) return null;
                    const before = await readConversation(candidateKey);
                    if (signal.aborted) return null;
                    const refreshNeed = evaluateRefreshNeed(request, options, providerFor, candidateKey, account, before);
                    if (!refreshNeed.needed) return null;
                    const diagnostics: Diagnostic[] = [];
                    try {
                        await providerFor(account.providerId).fetchConversationDetail(
                            candidateKey.accountId, candidateKey.conversationId, signal,
                            diagnostic => { diagnostics.push(diagnostic); },
                        );
                        return { before, needsSourceReaders: refreshNeed.needsSourceReaders, diagnostics };
                    } catch (error) {
                        stopOnRateLimit(error);
                        return { before, needsSourceReaders: refreshNeed.needsSourceReaders, diagnostics, error };
                    }
                }, signal).catch((error: unknown): PrefetchedDetailOutcome | null => {
                    stopOnRateLimit(error);
                    return null;
                });
                prefetchedDetails.set(target, job);
            }
        };

        const pendingSlots: (PendingExport | undefined)[] = [];
        for (const [index, key] of request.keys.entries()) {
            while (directory && queued.size >= MAX_PENDING_FOLDER_CONVERSATIONS) {
                signal.throwIfAborted();
                await Promise.race(queued.values());
            }
            const keyId = keyIdentity(key);
            const isRepeatKey = seenKeyIdentities.has(keyId);
            seenKeyIdentities.add(keyId);
            const previous = queued.get(keyId);
            if (previous) await previous;
            signal.throwIfAborted();
            options.onProgress?.({ current: index + 1, total: request.keys.length, key });
            scheduleLookaheadDetailPrefetch(index);
            let handedOff = false;
            try {
                const [account, localIndex, record] = await loadLocalMetadata(key, isRepeatKey);
                if (!account) throw new OperationError('ACCOUNT_UNAVAILABLE', 'Account unavailable');
                if (!options.refreshDetail && localIndex && shouldSkipExport(record, localIndex.updatedAt, request)) {
                    result.skipped++;
                    report({ key, status: 'skipped' });
                    continue;
                }
                const prefetched = await prefetchedDetails.get(index);
                prefetchedDetails.delete(index);
                let conversation = prefetched ? prefetched.before : await readConversation(key);
                let refreshFailed = false;
                let refreshFailure: { error: unknown } | undefined;
                const refreshCheck = prefetched
                    ? { needed: true, needsSourceReaders: prefetched.needsSourceReaders }
                    : evaluateRefreshNeed(request, options, providerFor, key, account, conversation);
                const needsSourceReaders = refreshCheck.needsSourceReaders;
                if (refreshCheck.needed) {
                    const before = conversation;
                    try {
                        if (prefetched) {
                            for (const diagnostic of prefetched.diagnostics) diagnose({ key, stage: 'source_parse', ...diagnostic });
                            if (prefetched.error !== undefined) throw prefetched.error;
                        } else {
                            await providerFor(account.providerId).fetchConversationDetail(key.accountId, key.conversationId, signal,
                                diagnostic => diagnose({ key, stage: 'source_parse', ...diagnostic }));
                        }
                        verifiedRemoteAccounts.add(key.accountId);
                        scheduleLookaheadDetailPrefetch(index);
                    } catch (error) {
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
                    conversation = await readConversation(key);
                    diagnose({
                        key, stage: 'source_refresh', severity: 'info', code: 'DETAIL_REFRESH_RESULT',
                        message: 'Persisted detail observed after source refresh',
                        details: {
                            refreshFailed, requestedExplicitly: options.refreshDetail ?? false, needsSourceReaders: needsSourceReaders ?? false,
                            before: { savedAt: before?.detail.savedAt ?? null, indexUpdatedAt: before?.index.updatedAt ?? null,
                                quality: before?.detail.quality.status ?? null, messageCount: before?.detail.messages.length ?? null },
                            after: { savedAt: conversation?.detail.savedAt ?? null, indexUpdatedAt: conversation?.index.updatedAt ?? null,
                                quality: conversation?.detail.quality.status ?? null, messageCount: conversation?.detail.messages.length ?? null },
                        },
                    });
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
                const source: ExportSource = describeExportSource(request, key, account, conversation, refreshFailed, record?.folderBaseName);
                options.onConversationPrepared?.(key);

                const prepare = (targetSource: ExportSource, targetPlan: ExportPathPlan | undefined, prev?: PendingExport['prepared']) =>
                    prepareSourceResources({
                        source: targetSource, plan: targetPlan, previous: prev, directory, signal,
                        options, providerFor, assetAcquireSemaphore, downloadedResources, diagnose,
                    });

                const plan = linkedPlanner?.(conversation, new Map(), source.fileIds, source.folderBaseName, source.requiredIds, directory ? account : undefined);
                const body = plan ? await renderGroup({ ...source, prepared: new Map(), reused: new Set() }, { ...plan, externalResourceIds: new Set() }) : undefined;
                let bodyWritten: Promise<void> | undefined;
                if (body) {
                    if (directory) {
                        bodyWritten = delivery.writeFolder(body.files, directory).then(() => delivery.bodyDelivered(key));
                        void bodyWritten.catch(() => {});
                    } else {
                        bodies.push({ group: body, hasAttachments: source.requiredIds.size > 0 });
                        report({ key, status: 'prepared' });
                    }
                    if (!source.requiredIds.size && !directory) continue;
                }

                const pendingSlot = !body && !(folderPlanner && directory) ? pendingSlots.push(undefined) - 1 : -1;
                type AcquiredOutcome =
                    | { readonly ok: true; readonly item: PendingExport; readonly finalPlan: ExportPathPlan | undefined; readonly sourceChanged: boolean }
                    | { readonly ok: false; readonly error: unknown };
                const acquisitionPromise: Promise<AcquiredOutcome> = downstreamSemaphore.run(async (): Promise<AcquiredOutcome> => {
                    signal.throwIfAborted();
                    let item = await prepare(source, plan);
                    let finalPlan = plan;
                    let sourceChanged = false;
                    if (needsResourceRefresh(item.prepared)) {
                        diagnose({ key, stage: 'resource_refresh', severity: 'info', code: 'RESOURCE_REFRESH_STARTED', message: 'Refreshing source after attachment access failure' });
                        let refreshed = false;
                        try {
                            await providerFor(account.providerId).fetchConversationDetail(key.accountId, key.conversationId, signal,
                                diagnostic => diagnose({ key, stage: 'source_parse', ...diagnostic }));
                            refreshed = true;
                        } catch (error) {
                            if (cancelled(error) || (error instanceof Error && error.message === 'conversation_not_found')) throw error;
                            diagnose({ key, stage: 'resource_refresh', severity: 'warning', code: 'RESOURCE_REFRESH_FAILED',
                                issue: operationIssue(error), message: error instanceof Error ? error.message : String(error) });
                        }
                        signal.throwIfAborted();
                        if (refreshed) {
                            const refreshedConversation = await readConversation(key);
                            if (!refreshedConversation) throw new OperationError('DETAIL_UNAVAILABLE', 'No usable local Detail after resource refresh');
                            refreshFailed = false;
                            const refreshedSource = describeExportSource(request, key, account, refreshedConversation, false, record?.folderBaseName);
                            const initial = item.prepared;
                            if (body && plan && linkedPlanner && JSON.stringify(source.conversation) !== JSON.stringify(refreshedConversation)) {
                                const revised = linkedPlanner(refreshedConversation, new Map(), refreshedSource.fileIds,
                                    refreshedSource.folderBaseName, refreshedSource.requiredIds, directory ? account : undefined);
                                finalPlan = {
                                    ...revised,
                                    fileName: plan.fileName,
                                    resources: Object.fromEntries(Object.entries(revised.resources).map(([id, path]) => [id, plan.resources[id] ?? path])),
                                };
                                sourceChanged = true;
                            }
                            item = await prepare(refreshedSource, finalPlan, initial);
                        }
                    }
                    return { ok: true, item, finalPlan, sourceChanged };
                }, signal).catch((error: unknown): AcquiredOutcome => {
                    if (cancelled(error)) controller.abort(error);
                    return { ok: false, error };
                });
                const acquireDone = acquisitionPromise.then(() => undefined);
                activeDownstream.add(acquireDone);
                void acquireDone.finally(() => { activeDownstream.delete(acquireDone); });

                const preparedGroup = body && !source.requiredIds.size ? Promise.resolve(body)
                    : retireChain.then(async (): Promise<ExportGroup | undefined> => {
                        const outcome = await acquisitionPromise;
                        if (!outcome.ok) throw outcome.error;
                        signal.throwIfAborted();
                        const { item, finalPlan, sourceChanged } = outcome;
                        const { prepared, fileIds } = item;
                        if (body && finalPlan) {
                            const failures = Object.fromEntries([...prepared].filter((entry): entry is [string, ResourceFailure] => !entry[1].ok));
                            const correction = sourceChanged || Object.keys(failures).length
                                ? await renderGroup(item, {
                                    ...finalPlan,
                                    resources: Object.fromEntries(Object.entries(finalPlan.resources).filter(([id]) => prepared.get(id)?.ok || item.reused.has(id))),
                                    externalResourceIds: new Set(),
                                }) : undefined;
                            const nextRecord = correction?.record ?? buildExportRecord(request, item, finalPlan, failures, body.record.otherContentMissing ?? false);
                            const availablePlan = {
                                ...finalPlan,
                                externalResourceIds: new Set([...finalPlan.externalResourceIds].filter(id => prepared.get(id)?.ok)),
                            };
                            const files = [...(correction?.files ?? []), ...buildResourceFiles(availablePlan, prepared)];
                            if (nextRecord.attachmentIssues?.length) {
                                files.push({
                                    fileName: `attachment-reports/${resourceScope}/${finalPlan.fileName}/report.json`,
                                    mimeType: 'application/json',
                                    content: JSON.stringify({
                                        document: finalPlan.fileName,
                                        conversationId: key.conversationId,
                                        failures: nextRecord.attachmentIssues.map(issue => ({ ...issue, path: finalPlan.resources[issue.resourceId] })),
                                    }, null, 2),
                                });
                            }
                            const group: ExportGroup = { key, record: nextRecord, files };
                            if (directory) return group;
                            settledBodies.set(body, group);
                        } else if (folderPlanner && directory) {
                            return renderGroup(item, folderPlanner(item.conversation, prepared, fileIds, item.folderBaseName));
                        } else if (pendingSlot >= 0) {
                            pendingSlots[pendingSlot] = item;
                        }
                    });
                const taskPromise: Promise<void> = preparedGroup.then(async group => {
                    await bodyWritten;
                    if (group && directory) {
                        if (group !== body) {
                            signal.throwIfAborted();
                            if (group.files.length) await delivery.writeFolder(group.files, directory);
                        }
                        await delivery.finalize([group]);
                    }
                }).catch(error => {
                    if (cancelled(error)) controller.abort(error);
                    else {
                        console.warn('[Gemini Exporter] Export item failed', key, error);
                        fail([key], error);
                    }
                }).finally(async () => {
                    await bodyWritten?.catch(() => {});
                    resources.releaseConversation(key);
                    if (queued.get(keyId) === taskPromise) queued.delete(keyId);
                    activeDownstream.delete(taskPromise);
                });
                retireChain = preparedGroup.then(() => {}, error => { if (cancelled(error)) controller.abort(error); });
                handedOff = true;
                activeDownstream.add(taskPromise);
                queued.set(keyId, taskPromise);
            } catch (error) {
                if (cancelled(error)) throw error;
                console.warn('[Gemini Exporter] Export item failed', key, error);
                fail([key], error);
            } finally {
                if (!handedOff && !prefetchedDetails.has(index)) resources.releaseConversation(key);
            }
        }
        await drainDownstream();
        signal.throwIfAborted();
        if (linked) {
            if (!directory) await deliverBrowserBodies();
            result.aborted = signal.aborted;
            return result;
        }
        const pending = pendingSlots.filter((item): item is PendingExport => item !== undefined);
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
                await delivery.deliver(groups, directory);
                await delivery.finalize(groups);
            } catch (error) {
                if (cancelled(error)) throw error;
                console.warn('[Gemini Exporter] Batch delivery failed', error);
                fail(groups.map(group => group.key), error);
            }
        }
        result.aborted = signal.aborted;
        return result;
    } catch (error) {
        diagnose({
            stage: 'run',
            code: cancelled(error) ? 'EXPORT_CANCELLED' : 'EXPORT_RUN_FAILED',
            severity: cancelled(error) ? 'info' : 'error',
            issue: operationIssue(error),
            message: error instanceof Error ? error.message : String(error),
        });
        if (!cancelled(error)) throw error;
        controller.abort(error);
        await saveCancelledFiles?.();
        result.aborted = true;
        return result;
    } finally {
        controller.abort();
        await Promise.allSettled([...prefetchedDetails.values()]);
        await drainDownstream();
        options.signal?.removeEventListener('abort', cancel);
        resources.release();
        rendererSession.dispose?.();
    }
}
