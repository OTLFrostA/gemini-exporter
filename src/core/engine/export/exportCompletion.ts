import type { ChatParseDrift } from './parseDrift.js';
import type { StorageService, FinalizeExportOptions } from '../../storage/storageService.js';
import type { Conversation, TitleSources } from '../../../types/conversation.js';
import { normId } from '../../utils/pathUtils.js';
import {
    cleanTitle,
    isRealTitle,
    toTimestampMs,
    resolveTitle,
    TITLE_SOURCE_PRIORITY,
    type TitleSource,
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
export interface ExportCompletionFacts extends Partial<Pick<Conversation,
    'id' | 'title' | 'titleSource' | 'titles' | 'timestamp' | 'updatedAt' | 'createdAt' | 'chatTime'
>> {
    messages?: Array<{ timestamp?: number | string | Date | null }> | number;
    turns?: unknown[] | number;
    messageCount?: number | string | null;
    isEmpty?: boolean;
    _empty?: boolean;
    truncated?: boolean;
    isTruncated?: boolean;
    truncateReason?: string;
    completeness?: { status: string };
}

export type ExportCompletionConversation = ExportCompletionFacts | string | number | boolean | null | undefined;

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
    /** Truncation flag */
    isTruncated?: boolean;
    truncateReason?: string;
    /** Integrity evidence facts */
    evidence?: ChatParseDrift;
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

export interface StandardConversationUpdate {
    title: string;
    titleSource?: string;
    titles?: Record<string, string>;
    messageCount: number;
    chatTime?: number;
    updatedAt?: number;
}

export interface ExportCompletionResult {
    /** Canonical normalized conversation ID without c_ prefix */
    targetId: string;
    /** Standardized ExportRecord to store in exportedIds SSoT */
    exportRecord: StandardExportRecord;
    /** Standardized update payload for gemini_conversations write-back */
    conversationUpdate: StandardConversationUpdate;
}

/**
 * Computes canonical message count across available message/turn containers.
 */
export function computeExportMessageCount(conversation: ExportCompletionConversation, explicitCount?: number): number {
    if (typeof explicitCount === 'number' && Number.isFinite(explicitCount) && explicitCount > 0) {
        return explicitCount;
    }
    if (!conversation || typeof conversation !== 'object') return 0;
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
    const metadata = conversation && typeof conversation === 'object' ? conversation : undefined;
    let tsFromMessages = 0;
    if (Array.isArray(metadata?.messages)) {
        for (const m of metadata.messages) {
            const mt = toTimestampMs(m?.timestamp);
            if (mt && mt > tsFromMessages) tsFromMessages = mt;
        }
    }
    const max = Math.max(tsFromMessages, ...[
        explicitTime, metadata?.chatTime, metadata?.updatedAt, metadata?.timestamp, metadata?.createdAt,
    ].map(value => toTimestampMs(value) ?? 0));
    return max > 0 ? max : undefined;
}

export interface ResolveExportRecordStatusOptions {
    failedAssetsCount?: number;
    statusOverride?: 'ok' | 'partial' | 'empty' | 'failed';
    messageCount?: number;
    isEmpty?: boolean;
    evidence?: ChatParseDrift;
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
        || options.evidence?.sourcePartial || (options.evidence?.turnsRejected ?? 0) > 0
        || options.evidence?.hasHeuristicDocs || options.evidence?.truncated) {
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
 * ExportRecord and ConversationUpdate metadata, eliminating semantic drift between
 * live-save and batch exports.
 */
export function buildExportCompletion(input: BuildExportCompletionInput): ExportCompletionResult {
    const chat = input.conversation && typeof input.conversation === 'object' ? input.conversation : {};
    const rawId = input.conversationId || chat.id || '';
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

    // Merge titles map: strictly gate canonical provenance domain
    const mergedTitles: Record<string, string> = {};
    const addCanonicalTitles = (srcObj: unknown) => {
        if (srcObj && typeof srcObj === 'object') {
            for (const [k, v] of Object.entries(srcObj)) {
                const reliableK = normalizeReliableTitleSource(k);
                if (reliableK && typeof v === 'string' && v) {
                    mergedTitles[reliableK] = v;
                } else if (k === 'legacy' && typeof v === 'string' && v) {
                    mergedTitles.legacy = v;
                }
            }
        }
    };
    addCanonicalTitles(chat.titles);
    addCanonicalTitles(input.titles);

    // Resolve provenance: only adopt if reliable (in TITLE_SOURCE_PRIORITY and not default/legacy/export)
    let candidateProvenance: TitleSource | undefined = resolveReliableTitleSource(
        input.titleProvenance,
        chat.titleSource
    );

    // If still unresolved, check if candidateTitle matches a reliable tier in mergedTitles
    if (!candidateProvenance && mergedTitles && typeof mergedTitles === 'object') {
        for (const source of TITLE_SOURCE_PRIORITY) {
            const reliableSource = normalizeReliableTitleSource(source);
            if (reliableSource && mergedTitles[reliableSource] && cleanTitle(mergedTitles[reliableSource]) === candidateTitle) {
                candidateProvenance = reliableSource;
                break;
            }
        }
    }

    // 2. Resolve timestamps
    const nowMs = toTimestampMs(input.exportedAt) || Date.now();
    const exportedAtIso = new Date(nowMs).toISOString();
    const chatTime = computeAuthoritativeTimestamp(chat, input.chatTime);

    // 3. Resolve message count
    const messageCount = computeExportMessageCount(chat, input.messageCount);

    // 4. Resolve status & failed assets
    const failedAssetsCount = Array.isArray(input.failedAssets)
        ? input.failedAssets.length
        : (typeof input.failedAssets === 'number' ? input.failedAssets : 0);

    const isTruncated = Boolean(
        input.isTruncated ||
        chat.truncated ||
        chat.isTruncated ||
        input.evidence?.truncated ||
        Boolean(input.truncateReason) ||
        Boolean(chat.truncateReason)
    );

    const statusInfo = resolveExportRecordStatus({
        failedAssetsCount,
        statusOverride: input.statusOverride,
        messageCount,
        isEmpty: !!chat.isEmpty || !!chat._empty,
        usedLocalSnapshot: input.usedLocalSnapshot,
        evidence: {
            schemaDrift: input.evidence?.schemaDrift ?? [],
            sourcePartial: chat.completeness?.status === 'partial' || !!input.evidence?.sourcePartial,
            turnsRejected: input.evidence?.turnsRejected ?? 0,
            hasHeuristicDocs: input.evidence?.hasHeuristicDocs ?? false,
            truncated: isTruncated,
        },
    });

    const exportRecord: StandardExportRecord = {
        title: candidateTitle,
        exportedAt: exportedAtIso,
        format: input.format || 'markdown',
        messageCount,
        status: statusInfo.status,
        hasFailedAssets: statusInfo.hasFailedAssets,
        ...(chatTime ? { chatTime } : {}),
        ...(isTruncated ? { isTruncated: true, truncateReason: input.truncateReason || chat.truncateReason || 'truncated' } : {})
    };

    const conversationUpdate: StandardConversationUpdate = {
        title: candidateTitle,
        ...(candidateProvenance ? { titleSource: candidateProvenance } : {}),
        ...(Object.keys(mergedTitles).length > 0 ? { titles: mergedTitles } : {}),
        messageCount,
        ...(chatTime ? { chatTime, updatedAt: chatTime } : {})
    };

    return {
        targetId,
        exportRecord,
        conversationUpdate
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
        skipConversationUpdate?: boolean;
    }
): Promise<ExportCompletionResult> {
    const completion = buildExportCompletion(input);

    if (typeof storageAdapter?.finalizeConversationExport === 'function') {
        await storageAdapter.finalizeConversationExport(
            slot,
            completion.targetId,
            completion.exportRecord,
            {
                conversationUpdate: completion.conversationUpdate,
                skipConversationUpdate: options?.skipConversationUpdate,
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
            `[completeConversationExport] storageAdapter must implement finalizeConversationExport or saveExportRecord for conversation ${completion.targetId} (slot ${slot || 'u0'})`
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
