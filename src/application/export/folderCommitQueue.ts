import type { ConversationKey } from '../../l2/conversationKey.js';
import { putExportRecord } from '../../l3a/storageService.js';
import { putExportRecords } from '../../l3a/batchStorageService.js';
import type { ExportArtifact } from '../../l4/artifacts.js';
import { packageExportFiles } from '../../l4/packaging/index.js';
import { startBrowserDownload, writeToFolder } from '../../l4/delivery/index.js';
import { OperationError, operationError } from '../../shared/errors/operationError.js';
import { resourceIssueKind } from '../../shared/resources/resourceResult.js';
import type { ExportDiagnostic, ExportItemUpdate, ExportRecord, ExportRequest, ExportResult } from './types.js';
import { keyIdentity, type ExportGroup } from './exportPolicy.js';

const MAX_FOLDER_WRITES = 3;

interface DeliveryCoordinatorHooks {
    readonly request: ExportRequest;
    readonly result: ExportResult;
    readonly signal: AbortSignal;
    readonly report: (update: ExportItemUpdate) => void;
    readonly diagnose: (diagnostic: ExportDiagnostic) => void;
    readonly fail: (keys: readonly ConversationKey[], error?: unknown) => void;
    readonly onBodyDelivered?: (key: ConversationKey) => void;
}

export function createDeliveryCoordinator(hooks: DeliveryCoordinatorHooks) {
    const { request, result, signal, report, diagnose, fail, onBodyDelivered } = hooks;
    const folderWrites = new Set<Promise<void>>();
    const deliveredBodies = new Set<string>();

    const bodyDelivered = (key: ConversationKey): void => {
        if (deliveredBodies.has(keyIdentity(key))) return;
        deliveredBodies.add(keyIdentity(key));
        diagnose({ key, stage: 'delivery', code: 'DOCUMENT_DELIVERED', severity: 'info', message: 'Document delivery initiated' });
        try { onBodyDelivered?.(key); }
        catch (error) { console.warn('[Gemini Exporter] Body delivery listener failed', error); }
    };

    const writeFolder = async (files: readonly ExportArtifact[], directory: FileSystemDirectoryHandle): Promise<void> => {
        while (folderWrites.size >= MAX_FOLDER_WRITES) {
            signal.throwIfAborted();
            await Promise.race(folderWrites);
        }
        signal.throwIfAborted();
        const writing = writeToFolder(files, directory);
        // Capacity waiters must not inherit another conversation's write failure.
        const settled = writing.catch(() => {});
        folderWrites.add(settled);
        try { await writing; }
        finally { folderWrites.delete(settled); }
    };

    const applyCommittedGroupStats = (group: ExportGroup, record: ExportRecord): void => {
        result.exported++;
        if (group.record.status === 'partial') { result.partial++; result.otherPartial ??= 0; }
        if (group.record.attachmentIssues?.length) {
            result.attachmentIssues = [...(result.attachmentIssues ?? []), ...group.record.attachmentIssues];
        }
        if (group.record.attachmentIssues?.some(issue => resourceIssueKind(issue) === 'expired')) {
            result.expiredConversations = (result.expiredConversations ?? 0) + 1;
        }
        if (group.record.status === 'partial' && (!group.record.attachmentIssues?.length
            || group.record.otherContentMissing)) {
            result.otherPartial = (result.otherPartial ?? 0) + 1;
        }
        report({ key: group.key, status: 'exported', record });
    };

    const finalize = async (groups: readonly ExportGroup[]): Promise<void> => {
        if (groups.length === 0) return;
        // Once Delivery returned, cancellation cannot suppress records for that group/ZIP.
        const exportedAt = Date.now();
        if (groups.length > 1) {
            for (const group of groups) bodyDelivered(group.key);
            const entries = groups.map(group => ({ key: group.key, record: { ...group.record, exportedAt } }));
            try {
                await putExportRecords(entries);
                for (const [idx, group] of groups.entries()) {
                    applyCommittedGroupStats(group, entries[idx].record);
                }
                return;
            } catch {
                // Fall back to per-item writes so one bad record never drops sibling receipts.
            }
        }
        for (const group of groups) {
            bodyDelivered(group.key);
            try {
                const record: ExportRecord = { ...group.record, exportedAt };
                await putExportRecord(group.key, record);
                applyCommittedGroupStats(group, record);
            } catch (error) {
                console.warn('[Gemini Exporter] ExportRecord write failed', group.key, error);
                fail([group.key], operationError(error, 'RECORD_WRITE_FAILED'));
            }
        }
    };

    const deliver = async (
        groups: readonly ExportGroup[],
        savingCancelled = false,
    ): Promise<void> => {
        if (!groups.length) return;
        let files: ExportArtifact[];
        try { files = await packageExportFiles(groups.map(group => group.files), request.delivery); }
        catch (error) { throw operationError(error, 'PACKAGING_FAILED'); }
        if (!savingCancelled) signal.throwIfAborted();
        if (request.delivery !== 'browserDownload') throw new OperationError('DIRECTORY_UNAVAILABLE', 'Export directory unavailable');
        if (files.length !== 1) throw new Error('Browser delivery requires one final file');
        await startBrowserDownload(files[0]);
    };

    return {
        isDelivered: (key: ConversationKey): boolean => deliveredBodies.has(keyIdentity(key)),
        bodyDelivered,
        writeFolder,
        finalize,
        deliver,
    };
}
