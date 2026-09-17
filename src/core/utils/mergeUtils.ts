// mergeUtils.ts - Conversation merging and deduplication utilities

import { normId, isReservedRoute } from './pathUtils.js';
import { cleanTitle, isRealTitle, resolveTitle, compareConversations, toTimestampMs, isBrandPlaceholderTitle as isBadTitle, TITLE_TIER_RANK } from './titleUtils.js';

export interface MergeConversationOptions {
    isRpcSource?: boolean;
    now?: number | string;
    source?: string;
    targetSlot?: string;
}

export interface MergeConversationResult {
    merged: any;
    isChanged: boolean;
    hasDirtyTitles: boolean;
}

export interface DeduplicateResult {
    processed: any[];
    changedCount: number;
    hasDirtyTitles: boolean;
}


/**
 * SSoT: Merge an incoming conversation into an existing conversation.
 * Accurately arbitrates multi-tier titles, dates/timestamps, message counts, and dirty title status.
 */
export function mergeConversation(
    old: any,
    incoming: any,
    options?: MergeConversationOptions
): MergeConversationResult {
    const id = normId(incoming?.id || old?.id || '');
    const mergedTitles: Record<string, string> = { ...(old?.titles || {}) };

    // 0. Seed old title and source into mergedTitles if present
    if (old && old.titleSource && old.title && !mergedTitles[old.titleSource]) {
        const cleanOldT = cleanTitle(old.title);
        if (cleanOldT && (isRealTitle(cleanOldT, id) || old.titleSource === 'takeout')) {
            mergedTitles[old.titleSource] = cleanOldT;
        }
    } else if (old && old.title && !mergedTitles.legacy && !mergedTitles.rpc && !mergedTitles.dom && !mergedTitles.takeout) {
        const cleanOldT = cleanTitle(old.title);
        if (cleanOldT && isRealTitle(cleanOldT, id)) {
            mergedTitles.legacy = cleanOldT;
        }
    }

    // 1. Merge incoming.titles if provided
    if (incoming?.titles && typeof incoming.titles === 'object') {
        for (const [k, v] of Object.entries(incoming.titles)) {
            if (typeof v === 'string') {
                const cleanV = cleanTitle(v);
                if (cleanV && (isRealTitle(cleanV, id) || k === 'takeout')) {
                    if (k === 'sniff' && mergedTitles.sniff && mergedTitles.sniff !== cleanV) {
                        if (mergedTitles.sniff.startsWith(cleanV) && cleanV.length < mergedTitles.sniff.length) {
                            continue;
                        }
                    }
                    mergedTitles[k] = cleanV;
                }
            }
        }
    }

    // 2. Merge incoming title + titleSource
    if (incoming?.titleSource && incoming?.title) {
        const cleanT = cleanTitle(incoming.title);
        if (cleanT && (isRealTitle(cleanT, id) || incoming.titleSource === 'takeout')) {
            const inSrc = incoming.titleSource;
            if (inSrc === 'sniff' && mergedTitles.sniff && mergedTitles.sniff !== cleanT) {
                if (mergedTitles.sniff.startsWith(cleanT) && cleanT.length < mergedTitles.sniff.length) {
                    // Do not overwrite longer sniff with truncated prefix
                } else {
                    mergedTitles.sniff = cleanT;
                }
            } else {
                mergedTitles[inSrc] = cleanT;
            }
        }
    } else if (incoming?.title && !mergedTitles.legacy && !mergedTitles.rpc && !mergedTitles.dom && !mergedTitles.takeout) {
        const cleanT = cleanTitle(incoming.title);
        if (cleanT && isRealTitle(cleanT, id)) {
            mergedTitles.legacy = cleanT;
        }
    }

    // 4. Resolve authoritative title
    const tempChat = {
        id,
        titles: mergedTitles,
        title: incoming?.title || old?.title,
        titleSource: incoming?.titleSource || old?.titleSource
    };
    const resolved = resolveTitle(tempChat);
    const resolvedTitle = resolved.title;
    const resolvedSource = resolved.source;

    // 5. Detect dirty title
    let hasDirtyTitles = false;
    if (!old) {
        if (isBadTitle(incoming?.title) || incoming?.title !== resolvedTitle) {
            hasDirtyTitles = true;
        }
    } else {
        if (isBadTitle(old.title) || old.title !== resolvedTitle) {
            hasDirtyTitles = true;
        }
    }

    // 6. Timestamps arbitration
    let cUpdated: any = toTimestampMs(incoming?.updatedAt ?? incoming?.timestamp);
    if (cUpdated !== null && cUpdated <= 0) cUpdated = null;

    let oldUpdated: any = toTimestampMs(old?.updatedAt ?? old?.timestamp);
    if (oldUpdated !== null && oldUpdated <= 0) oldUpdated = null;

    const isRpcSource = options?.isRpcSource ?? (
        options?.source === 'network-list' ||
        options?.source === 'network-detail' ||
        (typeof options?.source === 'string' && options.source.startsWith('stream-')) ||
        incoming?.titleSource === 'rpc' ||
        incoming?.source === 'network-list'
    );

    let bestUpdatedAt: number | null = null;
    if (cUpdated && oldUpdated) {
        bestUpdatedAt = Math.max(oldUpdated, cUpdated);
    } else {
        bestUpdatedAt = cUpdated || oldUpdated || null;
    }



    let cCreated: any = toTimestampMs(incoming?.createdAt);
    if (cCreated !== null && cCreated <= 0) cCreated = null;

    let oldCreated: any = toTimestampMs(old?.createdAt);
    if (oldCreated !== null && oldCreated <= 0) oldCreated = null;

    // 2. createdAt must never advance into the future. If both exist, take the earliest timestamp.
    let bestCreatedAt: number | null = null;
    if (cCreated && oldCreated) {
        bestCreatedAt = Math.min(oldCreated, cCreated);
    } else {
        bestCreatedAt = cCreated || oldCreated || null;
    }

    // 3. bestTimestamp mirrors bestUpdatedAt (the latest activity time)
    const bestTimestamp = bestUpdatedAt || old?.timestamp || incoming?.timestamp || null;

    // 3b. Preserve fuller message payloads and count monotonicity
    const effectiveMessageCount = (c: any): number => {
        if (!c || typeof c !== 'object') return 0;
        const n = Number(c.messageCount);
        const m = Array.isArray(c.messages) ? c.messages.length : 0;
        const t = Array.isArray(c.turns) ? c.turns.length : 0;
        return Math.max(Number.isFinite(n) && n > 0 ? n : 0, m, t);
    };
    const oldMsgLen = effectiveMessageCount(old);
    const inMsgLen = effectiveMessageCount(incoming);
    const bestMsgLen = Math.max(oldMsgLen, inMsgLen);
    const incomingShrinksMessages = !!old && oldMsgLen > inMsgLen;

    // 3c. lastSeen monotonicity
    const toMs = (v: any): number | null => {
        if (v === null || v === undefined || v === '') return null;
        const ms = typeof v === 'string' ? new Date(v).getTime() : Number(v);
        return Number.isFinite(ms) && ms > 0 ? ms : null;
    };
    const oldSeenMs = toMs(old?.lastSeen);
    const inSeenMs = toMs(incoming?.lastSeen);
    let bestLastSeen: any = null;
    if (oldSeenMs !== null && inSeenMs !== null) {
        bestLastSeen = oldSeenMs >= inSeenMs ? old.lastSeen : incoming.lastSeen;
    } else {
        bestLastSeen = oldSeenMs !== null ? old.lastSeen : (inSeenMs !== null ? incoming.lastSeen : null);
    }

    // 3d. lastActiveAt monotonicity
    const oldActiveMs = toMs((old as any)?.lastActiveAt);
    const inActiveMs = toMs((incoming as any)?.lastActiveAt);
    const bestActiveMs = Math.max(oldActiveMs ?? 0, inActiveMs ?? 0);

    // 7. Check if meaningful change occurred
    const oldMsgCount = typeof old?.messageCount === 'number' ? old.messageCount : null;
    const inMsgCount = typeof incoming?.messageCount === 'number' ? incoming.messageCount : null;
    const oldBodyLen = Array.isArray(old?.messages) ? old.messages.length : null;
    const inBodyLen = Array.isArray(incoming?.messages) ? incoming.messages.length : null;
    const oldAttCount = typeof (old as any)?.attachmentCount === 'number' ? (old as any).attachmentCount : null;
    const inAttCount = typeof (incoming as any)?.attachmentCount === 'number' ? (incoming as any).attachmentCount : null;
    let isChanged = false;
    if (!old) {
        isChanged = true;
    } else if (
        old.title !== resolvedTitle ||
        (!old.timestamp && bestTimestamp) ||
        (bestUpdatedAt && bestUpdatedAt !== oldUpdated) ||
        (oldMsgCount !== null && inMsgCount !== null && oldMsgCount !== inMsgCount) ||
        (oldBodyLen !== null && inBodyLen !== null && oldBodyLen !== inBodyLen) ||
        ((oldBodyLen === null || oldBodyLen === 0) && inBodyLen !== null && inBodyLen > 0) ||
        (oldAttCount !== null && inAttCount !== null && oldAttCount !== inAttCount) ||
        bestMsgLen > oldMsgLen ||
        bestActiveMs > (oldActiveMs ?? 0)
    ) {
        isChanged = true;
    }

    // 8. Assemble merged conversation
    const merged: any = {
        ...(old || {}),
        ...(incoming || {}),
        id,
        title: resolvedTitle,
        titleSource: resolvedSource,
        titles: mergedTitles,
        timestamp: bestTimestamp,
        updatedAt: bestUpdatedAt || bestTimestamp,
        createdAt: bestCreatedAt,
        sidebarIndex: typeof incoming?.sidebarIndex === 'number'
            ? incoming.sidebarIndex
            : old?.sidebarIndex
    };

    // Fuller existing message body wins over shorter incoming
    const oldBodyLen2 = Array.isArray(old?.messages) ? old.messages.length : 0;
    const inBodyLen2 = Array.isArray(incoming?.messages) ? incoming.messages.length : 0;
    if (oldBodyLen2 > 0 && inBodyLen2 < oldBodyLen2) {
        merged.messages = old.messages;
    }
    if (oldMsgCount !== null && inMsgCount !== null) {
        merged.messageCount = Math.max(oldMsgCount, inMsgCount);
    }

    if (options?.now) {
        merged.lastSeen = options.now;
    } else if (bestLastSeen !== null) {
        merged.lastSeen = bestLastSeen;
    }
    if (bestActiveMs > 0) {
        merged.lastActiveAt = bestActiveMs;
    }
    if (incomingShrinksMessages) {
        if (Array.isArray(old.messages)) merged.messages = old.messages;
        if (Array.isArray(old.turns)) merged.turns = old.turns;
        if (typeof old.messageCount === 'number') merged.messageCount = old.messageCount;
        else if (bestMsgLen > 0) merged.messageCount = bestMsgLen;
    }
    if (options?.source) {
        merged.source = options.source || old?.source || 'unknown';
    }
    if (options?.targetSlot) {
        merged.accountSlot = options.targetSlot;
    }

    return { merged, isChanged, hasDirtyTitles };
}

/**
 * SSoT: Deduplicate an array of conversations, merging items with identical normId
 * and sorting by authoritative compareConversations.
 */
export function deduplicateConversations(
    list: any[],
    options?: MergeConversationOptions
): DeduplicateResult {
    if (!Array.isArray(list)) return { processed: [], changedCount: 0, hasDirtyTitles: false };
    const dedupMap = new Map<string, any>();
    let changedCount = 0;
    let hasDirtyTitles = false;

    for (const item of list) {
        if (!item || !item.id) continue;
        const u = ((item as any).url || (item as any).href || '').toString();
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
