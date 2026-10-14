import type { Conversation, TitleSource, TitleSources } from '../../types/conversation.js';

/** List/detail ingestion can omit fields; merge returns normalized required metadata. */
export type ConversationMergeInput = Partial<Conversation>;
export type MergedConversation = Conversation & {
    titles: TitleSources;
    titleSource: TitleSource;
    updatedAt: number | null;
    createdAt: number | null;
};

import { normId, isReservedRoute } from './pathUtils.js';
import { cleanTitle, isRealTitle, resolveTitle, compareConversations, toTimestampMs, isBrandPlaceholderTitle as isBadTitle, normalizeReliableTitleSource } from './titleUtils.js';

export interface MergeConversationOptions {
    source?: string;
    targetSlot?: string;
}

export interface MergeConversationResult {
    merged: MergedConversation;
    isChanged: boolean;
    hasDirtyTitles: boolean;
}

export interface DeduplicateResult {
    processed: Conversation[];
    changedCount: number;
    hasDirtyTitles: boolean;
}

/**
 * SSoT: "any authoritative title slot already holds a title" guard.
 * The legacy fallback below must not fabricate a zombie `legacy` slot when a
 * real source slot (rpc / api-detail / dom / takeout / openai / sniff) already has a
 * title. `legacy` itself is excluded (the guard checks it separately) and
 * rank-0 `default` is intentionally not authoritative.
 */
function hasAuthoritativeTitleSlot(titles: TitleSources): boolean {
    return Boolean(
        titles.rpc ||
        titles['api-detail'] ||
        titles.dom ||
        titles.takeout ||
        titles.openai ||
        titles.sniff
    );
}

export function mergeConversation(
    old: ConversationMergeInput | null | undefined,
    incoming: ConversationMergeInput | null | undefined,
    options?: MergeConversationOptions
): MergeConversationResult {
    const id = normId(incoming?.id || old?.id || '');
    const mergedTitles: TitleSources = {};
    if (old?.titles && typeof old.titles === 'object') {
        for (const [k, v] of Object.entries(old.titles)) {
            const relK = normalizeReliableTitleSource(k);
            if (relK && typeof v === 'string' && v) {
                mergedTitles[relK] = v;
            } else if (k === 'legacy' && typeof v === 'string' && v) {
                mergedTitles.legacy = v;
            }
        }
    }

    const reliableOldSource = normalizeReliableTitleSource(old?.titleSource);
    if (reliableOldSource && old?.title && !mergedTitles[reliableOldSource]) {
        const cleanOldT = cleanTitle(old.title);
        if (cleanOldT && (isRealTitle(cleanOldT, id) || reliableOldSource === 'takeout')) {
            mergedTitles[reliableOldSource] = cleanOldT;
        }
    } else if (old && old.title && !mergedTitles.legacy && !hasAuthoritativeTitleSlot(mergedTitles)) {
        const cleanOldT = cleanTitle(old.title);
        if (cleanOldT && isRealTitle(cleanOldT, id)) {
            mergedTitles.legacy = cleanOldT;
        }
    }

    if (incoming?.titles && typeof incoming.titles === 'object') {
        for (const [k, v] of Object.entries(incoming.titles)) {
            const relK = normalizeReliableTitleSource(k);
            if (relK && typeof v === 'string') {
                const cleanV = cleanTitle(v);
                if (cleanV && (isRealTitle(cleanV, id) || relK === 'takeout')) {
                    if (relK === 'sniff' && mergedTitles.sniff && mergedTitles.sniff !== cleanV) {
                        if (mergedTitles.sniff.startsWith(cleanV) && cleanV.length < mergedTitles.sniff.length) {
                            continue;
                        }
                    }
                    mergedTitles[relK] = cleanV;
                }
            }
        }
    }

    // 2. Merge incoming title + titleSource
    const reliableInSrc = normalizeReliableTitleSource(incoming?.titleSource);
    if (reliableInSrc && incoming?.title) {
        const cleanT = cleanTitle(incoming.title);
        if (cleanT && (isRealTitle(cleanT, id) || reliableInSrc === 'takeout')) {
            if (reliableInSrc === 'sniff' && mergedTitles.sniff && mergedTitles.sniff !== cleanT) {
                if (mergedTitles.sniff.startsWith(cleanT) && cleanT.length < mergedTitles.sniff.length) {
                    // Do not overwrite longer sniff with truncated prefix
                } else {
                    mergedTitles.sniff = cleanT;
                }
            } else {
                mergedTitles[reliableInSrc] = cleanT;
            }
        }
    } else if (incoming?.title && !mergedTitles.legacy && !hasAuthoritativeTitleSlot(mergedTitles)) {
        const cleanT = cleanTitle(incoming.title);
        if (cleanT && isRealTitle(cleanT, id)) {
            mergedTitles.legacy = cleanT;
        }
    }

    const { title: resolvedTitle, source: resolvedSource } = resolveTitle({
        id,
        titles: mergedTitles,
        title: incoming?.title || old?.title,
        titleSource: reliableInSrc || reliableOldSource || 'legacy'
    });
    const previousTitle = old ? old.title : incoming?.title;
    const hasDirtyTitles = isBadTitle(previousTitle) || previousTitle !== resolvedTitle;

    // Preserve raw updatedAt precedence even when that value cannot be parsed.
    const cUpdated = toTimestampMs(incoming?.updatedAt ?? incoming?.timestamp);
    const oldUpdated = toTimestampMs(old?.updatedAt ?? old?.timestamp);
    const bestUpdatedAt = Math.max(oldUpdated ?? 0, cUpdated ?? 0) || null;
    const cCreated = toTimestampMs(incoming?.createdAt);
    const oldCreated = toTimestampMs(old?.createdAt);
    // Creation uses the earliest valid server fact, independently of activity.
    const bestCreatedAt = cCreated === null ? oldCreated : oldCreated === null ? cCreated : Math.min(oldCreated, cCreated);
    // Reuse timestamp conversions when updatedAt was absent; retain old-first fallback order.
    const bestTimestamp = bestUpdatedAt
        ?? (old?.updatedAt == null ? oldUpdated : toTimestampMs(old.timestamp))
        ?? (incoming?.updatedAt == null ? cUpdated : toTimestampMs(incoming.timestamp));

    // null means the body was not loaded; zero means an explicitly empty body.
    const oldBodyLen = Array.isArray(old?.messages) ? old.messages.length : null;
    const inBodyLen = Array.isArray(incoming?.messages) ? incoming.messages.length : null;
    const oldTurnsLen = Array.isArray(old?.turns) ? old.turns.length : null;
    const inTurnsLen = Array.isArray(incoming?.turns) ? incoming.turns.length : null;
    const oldMsgCount = typeof old?.messageCount === 'number' ? old.messageCount : null;
    const inMsgCount = typeof incoming?.messageCount === 'number' ? incoming.messageCount : null;
    const effectiveMessageCount = (declared: Conversation['messageCount'], body: number | null, turns: number | null): number => {
        const n = Number(declared);
        return Math.max(Number.isFinite(n) && n > 0 ? n : 0, body ?? 0, turns ?? 0);
    };
    const oldMsgLen = effectiveMessageCount(old?.messageCount, oldBodyLen, oldTurnsLen);
    const inMsgLen = effectiveMessageCount(incoming?.messageCount, inBodyLen, inTurnsLen);
    const bestMsgLen = Math.max(oldMsgLen, inMsgLen);
    const incomingShrinksMessages = !!old && oldMsgLen > inMsgLen;

    const toMs = (v: unknown): number | null => {
        if (v === null || v === undefined || v === '') return null;
        const ms = typeof v === 'string' ? new Date(v).getTime() : Number(v);
        return Number.isFinite(ms) && ms > 0 ? ms : null;
    };
    const oldSeenMs = toMs(old?.lastSeen);
    const inSeenMs = toMs(incoming?.lastSeen);
    const bestLastSeen = oldSeenMs !== null && (inSeenMs === null || oldSeenMs >= inSeenMs)
        ? old?.lastSeen : inSeenMs !== null ? incoming?.lastSeen : null;

    const oldAttCount = typeof old?.attachmentCount === 'number' ? old.attachmentCount : null;
    const inAttCount = typeof incoming?.attachmentCount === 'number' ? incoming.attachmentCount : null;
    const isChanged = !old || Boolean(
        old.title !== resolvedTitle ||
        (!old.timestamp && bestTimestamp) ||
        (bestUpdatedAt && bestUpdatedAt !== oldUpdated) ||
        (inMsgCount !== null && (oldMsgCount === null || inMsgCount > oldMsgCount)) ||
        (inBodyLen !== null && (oldBodyLen === null ? (oldMsgLen === 0 && inBodyLen > 0) : inBodyLen > oldBodyLen)) ||
        (oldAttCount !== null && inAttCount !== null && oldAttCount !== inAttCount) ||
        bestMsgLen > oldMsgLen
    );

    const merged: MergedConversation = {
        ...(old || {}),
        ...(incoming || {}),
        id,
        title: resolvedTitle,
        titleSource: resolvedSource,
        titles: mergedTitles,
        timestamp: bestTimestamp,
        updatedAt: bestTimestamp,
        createdAt: bestCreatedAt,
        sidebarIndex: typeof incoming?.sidebarIndex === 'number'
            ? incoming.sidebarIndex
            : old?.sidebarIndex
    };

    // Preserve loaded full bodies and slim IDB metadata with the same integrity guard.
    if (incomingShrinksMessages || (oldBodyLen ?? 0) > (inBodyLen ?? 0)) {
        if (oldBodyLen !== null) merged.messages = old?.messages;
        else delete merged.messages;
    }
    if (incomingShrinksMessages || (oldTurnsLen ?? 0) > (inTurnsLen ?? 0)) {
        if (oldTurnsLen !== null) merged.turns = old?.turns;
        else delete merged.turns;
    }
    if (incomingShrinksMessages) {
        // Slim records must not attach partial incoming bodies and overwrite fuller IDB detail.
        if (oldMsgCount !== null) merged.messageCount = oldMsgCount;
        else if (bestMsgLen > 0) merged.messageCount = bestMsgLen;
    } else if (oldMsgCount !== null && inMsgCount !== null) {
        merged.messageCount = Math.max(oldMsgCount, inMsgCount);
    }
    if (bestLastSeen !== null) merged.lastSeen = bestLastSeen;
    if (options?.source) {
        merged.source = options.source;
    }
    if (options?.targetSlot) {
        merged.accountSlot = options.targetSlot;
    }

    return { merged, isChanged, hasDirtyTitles };
}

export function deduplicateConversations(
    list: (ConversationMergeInput | null | undefined)[],
    options?: MergeConversationOptions
): DeduplicateResult {
    if (!Array.isArray(list)) return { processed: [], changedCount: 0, hasDirtyTitles: false };
    const dedupMap = new Map<string, Conversation>();
    let changedCount = 0;
    let hasDirtyTitles = false;

    for (const item of list) {
        if (!item || !item.id) continue;
        const u = (item.url || item.href || '').toString();
        if (/accounts\.google\.com|SignOutOptions/i.test(u)) continue;

        const nid = normId(item.id);
        const uRouteMatch = u.match(/\/app\/([A-Za-z0-9_-]+)/);
        const uRoute = uRouteMatch ? uRouteMatch[1] : '';
        if (isReservedRoute(nid) || isReservedRoute(item.id) || isReservedRoute(uRoute)) {
            changedCount++;
            hasDirtyTitles = true;
            continue;
        }

        const existing = dedupMap.get(nid);
        const res = mergeConversation(existing, item, options);
        if (res.isChanged) changedCount++;
        if (res.hasDirtyTitles) hasDirtyTitles = true;
        dedupMap.set(nid, res.merged);
    }

    const processed = Array.from(dedupMap.values());
    processed.sort(compareConversations);
    return { processed, changedCount, hasDirtyTitles };
}

export interface TakeoutMergePlan {
    processed: Conversation[];
    addedCount: number;
    changed: number;
}

export function planTakeoutMerge(
    existing: (ConversationMergeInput | null | undefined)[],
    incoming: (ConversationMergeInput | null | undefined)[],
    dedupeFn: (list: (ConversationMergeInput | null | undefined)[]) => DeduplicateResult = deduplicateConversations
): TakeoutMergePlan | null {
    const existingList = existing || [];
    const incomingList = incoming || [];
    const existingIds = new Set(existingList.map((c) => normId(c?.id)));
    const addedCount = incomingList.filter((tc) => tc?.id && !existingIds.has(normId(tc.id))).length;
    const { processed, changedCount } = dedupeFn([...existingList, ...incomingList]);

    const trivialFirstSeen = processed.length;
    const hasChangeSignal = typeof changedCount === 'number';
    const repeatMods = hasChangeSignal ? changedCount - trivialFirstSeen : (incomingList.length > 0 ? 1 : 0);
    if (!(addedCount > 0 || repeatMods > 0)) return null;
    return { processed, addedCount, changed: hasChangeSignal ? changedCount : 0 };
}
