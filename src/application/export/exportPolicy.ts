import type { Account } from '../../l2/accountRegistry.js';
import type { ConversationKey } from '../../l2/conversationKey.js';
import type { ReadonlyDomain } from '../../l2/runtimeValidation.js';
import type { SourceResourceContext } from '../../l1/resources/sourceResources.js';
import type { DocumentAst } from '../../l3b/ast/ast.js';
import type { ExportArtifact } from '../../l4/artifacts.js';
import type { ExportPathPlan } from '../../l4/packaging/index.js';
import type { ResourceBindings } from '../../l4/shared/resourceBindings.js';
import {
    resourceIssueKind,
    type PreparedResources,
    type ResourceFailure,
} from '../../shared/resources/resourceResult.js';
import type {
    ExportDiagnostic,
    ExportItemUpdate,
    ExportProgress,
    ExportRecord,
    ExportRequest,
} from './types.js';

export type ExportPendingContent =
    | { format: 'json'; document?: never }
    | { format: Exclude<ExportRequest['format'], 'json'>; document: DocumentAst };

type ExportRenderInput = ExportPendingContent & {
    key: ConversationKey;
    account: Account;
    conversation: ReadonlyDomain;
    prepared: PreparedResources;
    resources: ResourceBindings;
    locale: 'zh' | 'en';
    failures: Record<string, ResourceFailure>;
    signal: AbortSignal;
    diagnose: (diagnostic: ExportDiagnostic) => void;
};

export interface ExportFormatRendererSession {
    render(input: ExportRenderInput): Promise<{ content: string | Uint8Array; otherContentMissing?: boolean }>;
    dispose?(): void;
}

export interface ExportRunOptions {
    /** Foreground, user-authorized destination for the packaged export. */
    saveToDrive?: (fileName: string, data: Blob) => Promise<void>;
    onProgress?: (progress: ExportProgress) => void;
    /** A usable body is ready for resource preparation; skipped targets do not count. */
    onConversationPrepared?: (key: ConversationKey) => void;
    /** The document was written to a folder or included in an initiated browser download. */
    onBodyDelivered?: (key: ConversationKey) => void;
    /** downloaded counts distinct successful resource identities across this task, including refreshes. */
    onResourceProgress?: (progress: { key: ConversationKey; completed: number; total: number; downloaded: number }) => void;
    /** Settled items and staged browser files; only 'exported' carries a committed record. */
    onItemUpdate?: (update: ExportItemUpdate) => void;
    onDiagnostic?: (diagnostic: ExportDiagnostic) => void;
    signal?: AbortSignal;
    /** A completed reply requires a new source snapshot even if cached timestamps match. */
    refreshDetail?: boolean;
    /** User-selected ZIP readers owned by the open workbench, released by that page. */
    importedResources?: SourceResourceContext;
}

export type ExportSource = ExportPendingContent & {
    key: ConversationKey;
    account: Account;
    conversation: ReadonlyDomain;
    requiredIds: ReadonlySet<string>;
    refreshFailed: boolean;
    fileIds: ReadonlySet<string>;
    folderBaseName?: string;
};

export type PendingExport = ExportSource & {
    prepared: PreparedResources;
    reused: ReadonlySet<string>;
};

export interface ExportGroup {
    key: ConversationKey;
    record: Omit<ExportRecord, 'exportedAt'>;
    files: ExportArtifact[];
}

// Domain and ExportRecord source versions must be finite, safe epoch-millisecond integers.
export const comparable = (value: number | undefined): value is number =>
    value !== undefined && Number.isSafeInteger(value);

export const keyIdentity = (key: ConversationKey): string =>
    JSON.stringify([key.accountId, key.conversationId]);

export function shouldSkipExport(
    record: ExportRecord | null,
    updatedAt: number | undefined,
    request: ExportRequest,
): boolean {
    if (!request.skipUnchanged || !record || record.format !== request.format) return false;
    if (request.includeAssets && record.includeAssets !== true) return false;
    if (record.sourceTurn && record.sourceTurn !== 'finished' && record.sourceTurn !== 'interrupted') return false;
    const issues = record.attachmentIssues;
    const expiredOnly = record.status === 'partial' && record.otherContentMissing !== true
        && issues !== undefined && issues.length > 0
        && issues.every(issue => resourceIssueKind(issue) === 'expired' && issue.httpStatus === 404);
    return (record.status === 'ok' || expiredOnly) && comparable(record.chatTime)
        && comparable(updatedAt) && record.chatTime >= updatedAt;
}

export function isFresh(conversation: ReadonlyDomain): boolean {
    return conversation.detail.quality.status === 'complete'
        && (!conversation.detail.quality.sourceTurn || ['finished', 'interrupted'].includes(conversation.detail.quality.sourceTurn))
        && comparable(conversation.detail.savedAt)
        && comparable(conversation.index.updatedAt) && conversation.detail.savedAt >= conversation.index.updatedAt;
}

export function needsResourceRefresh(prepared: PreparedResources): boolean {
    return [...prepared.values()].some(value => !value.ok
        && value.code !== 'RESOURCE_LOCATOR_UNAVAILABLE'
        && value.httpStatus !== undefined && [401, 403, 404, 410].includes(value.httpStatus));
}

export function buildExportRecord(
    request: ExportRequest,
    item: PendingExport,
    plan: ExportPathPlan,
    failures: Readonly<Record<string, ResourceFailure>>,
    otherContentMissing: boolean,
): Omit<ExportRecord, 'exportedAt'> {
    const { conversation } = item;
    const partial = otherContentMissing || Object.keys(failures).length > 0;
    return {
        format: request.format,
        includeAssets: request.includeAssets,
        status: partial ? 'partial' : 'ok',
        ...(request.delivery === 'folderWriter'
            ? { folderBaseName: plan.fileName.replace(/\.[^.]+$/, '') }
            : item.folderBaseName ? { folderBaseName: item.folderBaseName } : {}),
        ...(conversation.detail.quality.sourceTurn ? { sourceTurn: conversation.detail.quality.sourceTurn } : {}),
        ...(partial ? { otherContentMissing } : {}),
        ...(Object.keys(failures).length ? {
            attachmentIssues: Object.values(failures).map(failure => {
                const asset = conversation.detail.assets.find(asset => asset.id === failure.resourceId);
                const sourceUri = asset?.sourceUri;
                return {
                    resourceId: failure.resourceId,
                    name: asset?.name || failure.resourceId,
                    code: failure.code,
                    ...(failure.httpStatus ? { httpStatus: failure.httpStatus } : {}),
                    ...(sourceUri && /^https:\/\//i.test(sourceUri) ? { sourceUrl: sourceUri } : {}),
                };
            }),
        } : {}),
        ...(comparable(conversation.detail.savedAt) ? { chatTime: conversation.detail.savedAt } : {}),
    };
}

export function emitDetailDiagnostics(
    conversation: ReadonlyDomain,
    key: ConversationKey,
    diagnose: (diagnostic: ExportDiagnostic) => void,
): void {
    const sourceTurn = conversation.detail.quality.sourceTurn;
    if (sourceTurn && sourceTurn !== 'finished') {
        diagnose({
            key,
            stage: 'detail',
            severity: 'info',
            code: 'SOURCE_TURN_' + sourceTurn.toUpperCase(),
            message: 'Available source content is exported independently of source turn completion',
            details: { sourceTurn, snapshotCoverage: conversation.detail.quality.status },
        });
    }
    if (conversation.detail.quality.status !== 'complete') {
        diagnose({
            key,
            stage: 'detail',
            severity: 'warning',
            code: 'DETAIL_NOT_COMPLETE',
            message: 'Persisted source detail is not complete',
            details: {
                quality: conversation.detail.quality.status,
                messageCount: conversation.detail.messages.length,
                savedAt: conversation.detail.savedAt ?? null,
                indexUpdatedAt: conversation.index.updatedAt ?? null,
                lastMessageId: conversation.detail.messages.at(-1)?.id ?? null,
                lastMessageRole: conversation.detail.messages.at(-1)?.role ?? null,
            },
        });
    }
    if (comparable(conversation.detail.savedAt) && comparable(conversation.index.updatedAt)
        && conversation.detail.savedAt < conversation.index.updatedAt) {
        diagnose({
            key,
            stage: 'detail',
            severity: 'warning',
            code: 'DETAIL_STALE',
            message: 'Detail source timestamp is older than Index',
            details: {
                savedAt: conversation.detail.savedAt,
                updatedAt: conversation.index.updatedAt,
                lagMs: conversation.index.updatedAt - conversation.detail.savedAt,
            },
        });
    }
}
