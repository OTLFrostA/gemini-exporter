// src/core/engine/export/exportSession.ts - Export session bootstrap.
// Split out of exportOrchestrator.ts (P1: god-file decomposition).
// Responsibility: resolve the account slot, load persisted exportedIds, build
// the per-run payload (payloadIds / skippedItems), and open the session
// status record. Pure-ish: all host lookups are injected via deps so the
// module has no import cycle back into the orchestrator.

import type { ExportOptions } from './exportTypes.js';

export interface ExportSession {
    payloadIds: any[];
    skippedItems: any[];
    totalSelected: number;
    slot: string;
    Storage: any;
    curIds: Record<string, any>;
    abortSignal: AbortSignal | null;
    /** Non-null when this module created the AbortController for the run. */
    abortController: AbortController | null;
}

export interface ExportSessionDeps {
    normId: (id?: string | number | null) => string;
    checkIsUpdated: (c: any, rec?: any) => boolean;
    getUtils: () => any;
    getSessionRecovery: () => any;
    /** Reset per-run rate-limiter state; injected to avoid importing the orchestrator. */
    resetRateLimiter?: () => void;
    /** Log callback for the upfront skip report. */
    onLog?: (msg: string, level?: string) => void;
}

/**
 * Build the export session. Throws when nothing is selected.
 */
export async function initExportSession(
    options: ExportOptions,
    deps: ExportSessionDeps
): Promise<ExportSession> {
    const {
        selected = [],
        format = 'markdown',
        useZip = true,
        currentSlot = 'u0',
        skip = false,
        conversations = []
    } = options;

    if (!selected.length) {
        throw new Error('No items selected');
    }

    if (deps.resetRateLimiter) {
        try { deps.resetRateLimiter(); } catch (_) { /* intentional: best effort */ }
    }
    const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const abortSignal = abortController ? abortController.signal : null;

    const slot = currentSlot || 'u0';
    const Storage = (typeof (globalThis as any).StorageService !== 'undefined') ? (globalThis as any).StorageService : ((globalThis as any).StorageService || null);
    let curIds: Record<string, any> = Storage ? await Storage.getExportedIds(slot) : {};
    if (!Storage && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const expKey = slot === 'u0' ? 'exportedIds' : `gemini_exported_${slot}`;
        const store = await chrome.storage.local.get([expKey]);
        curIds = store[expKey] || {};
    }
    if (options.exportedIds && typeof options.exportedIds === 'object') {
        curIds = { ...curIds, ...options.exportedIds };
    }

    const payloadIds: any[] = [];
    const skippedItems: any[] = [];

    const utils = deps.getUtils();
    const checkUpdatedFn = (utils && typeof utils.checkIsUpdated === 'function')
        ? utils.checkIsUpdated
        : deps.checkIsUpdated;

    for (const s of selected) {
        const sid = typeof s === 'string' ? s : s?.id;
        const nid = deps.normId(sid);
        const itemPayload = {
            id: sid,
            title: s.title || sid,
            url: s.url || s.href || `https://gemini.google.com/app/${sid}`,
            timestamp: s.timestamp,
            lastSeen: s.lastSeen
        };

        if (skip) {
            const rec = curIds[sid] || curIds['c_' + nid] || curIds[nid] || null;
            if (rec) {
                const conv = (Array.isArray(conversations) ? conversations.find((c: any) => deps.normId(c.id) === nid) : null) || (typeof s === 'object' ? s : null);
                const isUpdated = checkUpdatedFn(conv || itemPayload, rec);
                if (!isUpdated) {
                    skippedItems.push(itemPayload);
                    // Same upfront skip report as the pre-split orchestrator.
                    const sTitle = itemPayload.title || sid;
                    const I18n = (globalThis as any).I18n;
                    (deps.onLog || (() => { /* intentional */ }))(
                        typeof I18n !== 'undefined'
                            ? (I18n.t('logExportSkippedAlreadyExported', sTitle) || `[${sTitle}] 跳过已导出内容 (无更新)`)
                            : `[${sTitle}] 跳过已导出内容 (无更新)`,
                        'info'
                    );
                    continue;
                }
            }
        }
        payloadIds.push(itemPayload);
    }

    const recovery = deps.getSessionRecovery();
    if (recovery && recovery.updateSessionStatus) {
        await recovery.updateSessionStatus({
            status: 'running',
            slot,
            total: selected.length,
            current: skippedItems.length,
            format,
            useZip,
            startTime: Date.now()
        });
    }

    return {
        payloadIds,
        skippedItems,
        totalSelected: selected.length,
        slot,
        Storage,
        curIds,
        abortSignal,
        abortController
    };
}

export default { initExportSession };
