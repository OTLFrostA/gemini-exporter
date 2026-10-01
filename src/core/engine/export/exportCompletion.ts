import { normId } from '../../utils/pathUtils.js';
import {
    cleanTitle,
    isRealTitle,
    toTimestampMs,
    getEffectiveTimestamp,
    resolveTitle,
    TITLE_SOURCE_PRIORITY,
    type TitleSource
} from '../../utils/titleUtils.js';

export interface BuildExportCompletionInput {
    /** The conversation object with messages/turns/timestamps */
    conversation?: any;
    /** Raw or normalized conversation ID */
    conversationId?: string | number | null;
    /** Export format (default: 'markdown') */
    format?: string;
    /** When export landed (ISO string, ms number, or Date) */
    exportedAt?: string | number | Date;
    /** Failed assets list or count */
    failedAssets?: Array<{ file?: string; error?: string } | any> | number | null;
    /** Status override if known (e.g. 'empty', 'partial', 'ok', 'failed') */
    statusOverride?: 'ok' | 'partial' | 'empty' | 'failed';
    /** Explicit candidate title if available */
    titleCandidate?: string | null;
    /** Explicit provenance/source of candidate title (e.g. 'rpc', 'takeout', 'dom', 'sniff') */
    titleProvenance?: string | null;
    /** Explicit titles map if available */
    titles?: Record<string, string> | null;
    /** Truncation flag */
    isTruncated?: boolean;
    truncateReason?: string;
}

export interface StandardExportRecord {
    title: string;
    exportedAt: string;
    format: string;
    messageCount: number;
    status: 'ok' | 'partial' | 'empty' | 'failed';
    hasFailedAssets: boolean;
    chatTime?: number;
    isTruncated?: boolean;
    truncateReason?: string;
    [key: string]: any;
}

export interface StandardConversationUpdate {
    title: string;
    titleSource?: string;
    titles?: Record<string, string>;
    messageCount: number;
    chatTime?: number;
    updatedAt?: number;
    lastActiveAt?: number;
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
export function computeExportMessageCount(conversation: any, explicitCount?: number): number {
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
export function computeAuthoritativeTimestamp(conversation: any, explicitTime?: number | string | Date | null): number | undefined {
    const tsFromExplicit = toTimestampMs(explicitTime);
    const tsFromEffective = getEffectiveTimestamp(conversation);
    const tsFromLastActive = toTimestampMs(conversation?.lastActiveAt);
    const tsFromUpdated = toTimestampMs(conversation?.updatedAt);
    const tsFromTimestamp = toTimestampMs(conversation?.timestamp);
    const tsFromCreated = toTimestampMs(conversation?.createdAt);

    const max = Math.max(
        tsFromExplicit ?? 0,
        tsFromEffective ?? 0,
        tsFromLastActive ?? 0,
        tsFromUpdated ?? 0,
        tsFromTimestamp ?? 0,
        tsFromCreated ?? 0
    );
    return max > 0 ? max : undefined;
}

/**
 * Resolves standard export record status and failed assets indicator.
 */
export function resolveExportRecordStatus(options: {
    failedAssetsCount: number;
    statusOverride?: 'ok' | 'partial' | 'empty' | 'failed';
    messageCount: number;
    isEmpty?: boolean;
}): { status: 'ok' | 'partial' | 'empty' | 'failed'; hasFailedAssets: boolean } {
    const hasFailed = options.failedAssetsCount > 0;
    if (options.statusOverride) {
        const st = (hasFailed && options.statusOverride !== 'empty') ? 'partial' : options.statusOverride;
        return { status: st, hasFailedAssets: hasFailed };
    }
    if (options.messageCount === 0 || options.isEmpty) {
        return { status: 'empty', hasFailedAssets: hasFailed };
    }
    if (hasFailed) {
        return { status: 'partial', hasFailedAssets: true };
    }
    return { status: 'ok', hasFailedAssets: false };
}

/**
 * Unified factory that transforms raw export completion facts into standardized
 * ExportRecord and ConversationUpdate metadata, eliminating semantic drift between
 * live-save and batch exports.
 */
export function buildExportCompletion(input: BuildExportCompletionInput): ExportCompletionResult {
    const chat = input.conversation || {};
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

    // Resolve provenance: only adopt if reliable (in TITLE_SOURCE_PRIORITY and not default/legacy)
    let candidateProvenance: string | undefined = undefined;
    const rawProvenance = input.titleProvenance || chat.titleSource;
    if (
        typeof rawProvenance === 'string' &&
        rawProvenance !== 'default' &&
        rawProvenance !== 'legacy' &&
        rawProvenance !== 'export' &&
        TITLE_SOURCE_PRIORITY.includes(rawProvenance as TitleSource)
    ) {
        candidateProvenance = rawProvenance;
    }

    // Merge titles map
    const mergedTitles: Record<string, string> = {};
    if (chat.titles && typeof chat.titles === 'object') {
        Object.assign(mergedTitles, chat.titles);
    }
    if (input.titles && typeof input.titles === 'object') {
        Object.assign(mergedTitles, input.titles);
    }

    // 2. Resolve timestamps
    const nowMs = toTimestampMs(input.exportedAt) || Date.now();
    const exportedAtIso = new Date(nowMs).toISOString();
    const chatTime = computeAuthoritativeTimestamp(chat);

    // 3. Resolve message count
    const messageCount = computeExportMessageCount(chat);

    // 4. Resolve status & failed assets
    const failedAssetsCount = Array.isArray(input.failedAssets)
        ? input.failedAssets.length
        : (typeof input.failedAssets === 'number' ? input.failedAssets : 0);

    const statusInfo = resolveExportRecordStatus({
        failedAssetsCount,
        statusOverride: input.statusOverride,
        messageCount,
        isEmpty: !!chat.isEmpty || !!chat._empty
    });

    const isTruncated = !!(input.isTruncated || chat.truncated || chat.isTruncated);

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
        ...(chatTime ? { chatTime, updatedAt: chatTime } : {}),
        lastActiveAt: toTimestampMs(chat.lastActiveAt) || nowMs
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
    storageAdapter: any,
    slot: string | null | undefined,
    input: BuildExportCompletionInput,
    options?: {
        onItemExported?: (id: string, record: any) => void;
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
    }

    return completion;
}

export default {
    buildExportCompletion,
    completeConversationExport,
    computeExportMessageCount,
    computeAuthoritativeTimestamp,
    resolveExportRecordStatus
};
