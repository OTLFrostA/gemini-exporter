import type { DomainConversationWithDetail } from '../../domain/conversation.js';
import type { ContentQuality } from '../../domain/quality.js';
import type { StorageService, FinalizeExportOptions } from '../../storage/storageService.js';
import type { TitleSources } from '../../../types/conversation.js';
import { normId } from '../../utils/pathUtils.js';
import {
    cleanTitle,
    isRealTitle,
    toTimestampMs,
    resolveTitle,
    normalizeReliableTitleSource,
    resolveReliableTitleSource
} from '../../utils/titleUtils.js';

export { normalizeReliableTitleSource, resolveReliableTitleSource };


/** Persistence return values are ignored; partial adapters remain supported. */
export interface ExportCompletionStorageAdapter {
    finalizeConversationExport?: (...args: Parameters<typeof StorageService.finalizeConversationExport<StandardExportRecord>>) => Promise<unknown>;
    saveExportRecord?: (...args: Parameters<typeof StorageService.saveExportRecord<StandardExportRecord>>) => Promise<unknown>;
}

/** Completion metadata only: accepts native messages, legacy containers, and count-only facts.
 * This structural contract does not establish Domain trust or validate raw storage. */
export interface ExportCompletionFacts {
    id?: string;
    title?: string;
    titleSource?: string;
    titles?: TitleSources;
    timestamp?: number | string | null;
    updatedAt?: number | string | null;
    createdAt?: number | string | null;
    chatTime?: number | string | null;
    messages?: Array<{ timestamp?: number | string | Date | null }> | number;
    turns?: unknown[] | number;
    messageCount?: number | string | null;
    isEmpty?: boolean;
    _empty?: boolean;
    quality?: ContentQuality;
}

export type ExportCompletionConversation = ExportCompletionFacts | DomainConversationWithDetail | string | number | boolean | null | undefined;

export interface BuildExportCompletionInput {
    /** The conversation object with messages/turns/timestamps */
    conversation?: ExportCompletionConversation;
    /** Raw or normalized conversation ID */
    conversationId?: string | number | null;
    /** Export format (default: 'markdown') */
    format?: string;
    /** When export landed (ISO string, ms number, or Date) */
    exportedAt?: string | number | Date;
    /** Failed assets list or count */
    failedAssets?: unknown[] | number | null;
    /** Status override if known (e.g. 'empty', 'partial', 'ok', 'failed') */
    statusOverride?: 'ok' | 'partial' | 'empty' | 'failed';
    /** Explicit candidate title if available */
    titleCandidate?: string | null;
    /** Explicit provenance/source of candidate title (e.g. 'rpc', 'takeout', 'dom', 'sniff') */
    titleProvenance?: string | null;
    /** Explicit titles map if available */
    titles?: TitleSources | null;
    /** Explicit message count if already calculated */
    messageCount?: number;
    /** Explicit authoritative timestamp if available */
    chatTime?: number | string | Date | null;
    evidence?: import('../../domain/quality.js').QualityEvidence;
    usedLocalSnapshot?: boolean;
}

export type StandardExportRecord = {
    title: string;
    exportedAt: string;
    format: string;
    messageCount: number;
    status: 'ok' | 'partial' | 'empty' | 'failed';
    hasFailedAssets: boolean;
    chatTime?: number;
    isTruncated?: boolean;
    truncateReason?: string;
}

export interface ExportCompletionResult {
    /** Canonical normalized conversation ID without c_ prefix */
    targetId: string;
    /** Standardized ExportRecord to store in exportedIds SSoT */
    exportRecord: StandardExportRecord;
}

/**
 * Computes canonical message count across available message/turn containers.
 */
export function computeExportMessageCount(conversation: ExportCompletionConversation, explicitCount?: number): number {
    if (typeof explicitCount === 'number' && Number.isFinite(explicitCount) && explicitCount > 0) {
        return explicitCount;
    }
    if (!conversation || typeof conversation !== 'object') return 0;
    if ('index' in conversation) return conversation.detail.messages.length;
    const candidates = [
        conversation.messageCount,
        Array.isArray(conversation.messages) ? conversation.messages.length : 0,
        Array.isArray(conversation.turns) ? conversation.turns.length : 0
    ];
    let max = 0;
    for (const v of candidates) {
        const n = Number(v);
        if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
}

/**
 * Computes the authoritative timestamp for a conversation across candidate fields.
 */
export function computeAuthoritativeTimestamp(conversation: ExportCompletionConversation, explicitTime?: number | string | Date | null): number | undefined {
    // Native metadata may be newer than the retained body; only its explicit capture version proves freshness.
    if (conversation && typeof conversation === 'object' && 'index' in conversation) return conversation.detail.savedAt ?? toTimestampMs(explicitTime) ?? undefined;
    const metadata = conversation && typeof conversation === 'object' ? conversation : undefined;
    // A saved/exported version is a source update value. Neither local export time,
    // creation time nor arbitrary message dates can manufacture that version.
    return toTimestampMs(explicitTime) ?? toTimestampMs(metadata?.updatedAt)
        ?? toTimestampMs(metadata?.chatTime) ?? toTimestampMs(metadata?.timestamp) ?? undefined;
}

export interface ResolveExportRecordStatusOptions {
    failedAssetsCount?: number;
    statusOverride?: 'ok' | 'partial' | 'empty' | 'failed';
    messageCount?: number;
    isEmpty?: boolean;
    quality?: ContentQuality;
    evidence?: import('../../domain/quality.js').QualityEvidence;
    usedLocalSnapshot?: boolean;
}

/**
 * Resolves standard export record status and failed assets indicator.
 * Strict priority order:
 * 1. 'failed'  -> always 'failed'
 * 2. 'empty'   -> stays 'empty'
 * 3. 'partial' -> 'partial'
 * 4. 'ok' + failedAssets -> 'partial'
 * 5. 'ok' + no failedAssets -> 'ok'
 */
export function resolveExportRecordStatus(options: ResolveExportRecordStatusOptions): {
    status: 'ok' | 'partial' | 'empty' | 'failed';
    hasFailedAssets: boolean;
} {
    const hasFailed = (options.failedAssetsCount ?? 0) > 0;
    if (options.statusOverride === 'failed') {
        return { status: 'failed', hasFailedAssets: hasFailed };
    }
    if (options.statusOverride === 'empty' || (typeof options.messageCount === 'number' && options.messageCount === 0) || options.isEmpty) {
        return { status: 'empty', hasFailedAssets: hasFailed };
    }
    if (options.statusOverride === 'partial' || hasFailed || options.usedLocalSnapshot
        || options.quality?.status === 'partial') {
        return { status: 'partial', hasFailedAssets: hasFailed };
    }
    return { status: 'ok', hasFailedAssets: false };
}

/**
 * Applies runtime asset failure outcome to an existing canonical export record.
 * Preserves 'empty' or 'failed' status, upgrading successful 'ok' to 'partial'.
 */
export function applyAssetFailureToExportRecord(record: { status?: string; hasFailedAssets?: boolean } | null | undefined): void {
    if (!record || typeof record !== 'object') return;
    Object.assign(record, resolveExportRecordStatus({
        failedAssetsCount: 1,
        statusOverride: record.status === 'empty' || record.status === 'failed' ? record.status : undefined,
    }));
}

/**
 * Unified factory that transforms raw export completion facts into standardized
 * delivery records, eliminating semantic drift between
 * live-save and batch exports.
 */
export function buildExportCompletion(input: BuildExportCompletionInput): ExportCompletionResult {
    const value = input.conversation && typeof input.conversation === 'object' ? input.conversation : {};
    const native = 'index' in value ? value : undefined;
    const chat: ExportCompletionFacts = native ? native.index : value as ExportCompletionFacts;
    const rawId = input.conversationId || native?.index.key.conversationId || chat.id || '';
    const targetId = normId(rawId);

    // 1. Resolve title candidate & provenance
    const resolvedFromChat = resolveTitle(chat);
    let candidateTitle = cleanTitle(input.titleCandidate);
    if (!isRealTitle(candidateTitle, targetId)) {
        const chatTitle = cleanTitle(chat.title);
        if (isRealTitle(chatTitle, targetId)) {
            candidateTitle = chatTitle;
        } else if (isRealTitle(resolvedFromChat.title, targetId)) {
            candidateTitle = resolvedFromChat.title;
        } else {
            candidateTitle = candidateTitle || chatTitle || resolvedFromChat.title || '未命名对话';
        }
    }

    // 2. Resolve timestamps
    const nowMs = toTimestampMs(input.exportedAt) || Date.now();
    const exportedAtIso = new Date(nowMs).toISOString();
    const chatTime = computeAuthoritativeTimestamp(native ?? chat, input.chatTime);

    // 3. Resolve message count
    const messageCount = computeExportMessageCount(native ?? chat, input.messageCount);

    // 4. Resolve status & failed assets
    const failedAssetsCount = Array.isArray(input.failedAssets)
        ? input.failedAssets.length
        : (typeof input.failedAssets === 'number' ? input.failedAssets : 0);

    const quality = native?.detail.quality ?? chat.quality;
    const statusInfo = resolveExportRecordStatus({
        failedAssetsCount,
        statusOverride: input.statusOverride,
        messageCount,
        isEmpty: !!chat.isEmpty || !!chat._empty,
        usedLocalSnapshot: input.usedLocalSnapshot,
        quality,
    });

    const exportRecord: StandardExportRecord = {
        title: candidateTitle,
        exportedAt: exportedAtIso,
        format: input.format || 'markdown',
        messageCount,
        status: statusInfo.status,
        hasFailedAssets: statusInfo.hasFailedAssets,
        ...(chatTime ? { chatTime } : {}),
        ...(input.evidence?.truncation ? { isTruncated: true, truncateReason: input.evidence.truncation } : {})
    };


    return {
        targetId,
        exportRecord,
    };
}

/**
 * Executes standardized export completion and persistence against a storage adapter.
 */
export async function completeConversationExport(
    storageAdapter: ExportCompletionStorageAdapter | null | undefined,
    slot: string | null | undefined,
    input: BuildExportCompletionInput,
    options?: {
        onItemExported?: FinalizeExportOptions<StandardExportRecord>['onItemExported'];
    }
): Promise<ExportCompletionResult> {
    const completion = buildExportCompletion(input);

    if (typeof storageAdapter?.finalizeConversationExport === 'function') {
        await storageAdapter.finalizeConversationExport(
            slot,
            completion.targetId,
            completion.exportRecord,
            {
                onItemExported: options?.onItemExported
            }
        );
    } else if (typeof storageAdapter?.saveExportRecord === 'function') {
        await storageAdapter.saveExportRecord(slot, completion.targetId, completion.exportRecord);
        try {
            options?.onItemExported?.(completion.targetId, completion.exportRecord);
        } catch { /* callback errors must not abort export completion */ }
    } else {
        throw new Error(
            `[completeConversationExport] storageAdapter must implement finalizeConversationExport or saveExportRecord for conversation ${completion.targetId} (slot ${slot || ''})`
        );
    }

    return completion;
}

export default {
    buildExportCompletion,
    completeConversationExport,
    computeExportMessageCount,
    computeAuthoritativeTimestamp,
    resolveExportRecordStatus,
    applyAssetFailureToExportRecord,
    normalizeReliableTitleSource,
    resolveReliableTitleSource
};
