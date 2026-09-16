// src/ui/controllers/takeoutController.ts - Takeout Import Controller
import type { TakeoutControllerContract } from '../../types/ui.js';
import TakeoutEngine from '../../core/engine/takeoutEngine.js';
import ConversationsStore from '../state/conversationsStore.js';
import StorageService from '../../core/storage/storageService.js';
import { deduplicateConversations as staticDeduplicateConversations } from '../../core/utils/mergeUtils.js';
import { t, normId } from '../uiCommon.js';

const getTakeoutEngine = () => (globalThis as any).TakeoutEngine || TakeoutEngine;
const getStore = () => (globalThis as any).ConversationsStore || ConversationsStore;
const getStorage = () => (globalThis as any).StorageService || StorageService;

export async function handleTakeoutImport(
    file: File,
    { onProgress, onLog, onFinished, onError }: {
        onProgress?: (pct: number, txt: string) => void;
        onLog?: (msg: string, level?: 'info' | 'warn' | 'error') => void;
        onFinished?: (result: { res: any; addedCount: number; totalMediaCount: number; message: string }) => void;
        onError?: (err: Error, errMsg?: string) => void;
    } = {}
): Promise<void> {
    if (!file) return;
    const Takeout = getTakeoutEngine();
    if (!Takeout || !Takeout.parseTakeoutZip) {
        const err = new Error('TakeoutEngine module not loaded');
        if (onError) onError(err);
        else throw err;
        return;
    }

    try {
        const Store = getStore();
        const slot = Store ? (Store.getCurrentSlot() || 'u0') : 'u0';
        const res = await Takeout.parseTakeoutZip(file, (pct: number, txt: string) => {
            if (onProgress) onProgress(pct, txt);
            if (onLog) onLog(txt, 'info');
        }, slot);

        const incoming = Array.isArray(res.conversations) ? res.conversations : [];

        // SSoT: merge via deduplicateConversations so multi-tier titles
        // (titles.takeout seeding), timestamps and ordering converge with the
        // online upsert path. A naive push-if-absent would drop takeout slots
        // for existing ids and store raw temp titles unsorted for new ids.
        const dedupe = (list: any[]) => {
            if (Store && typeof Store.normalizeAndDeduplicate === 'function') {
                return Store.normalizeAndDeduplicate(list);
            }
            const injected = (globalThis as any).GeminiUtils;
            if (injected && typeof injected.deduplicateConversations === 'function') {
                return injected.deduplicateConversations(list);
            }
            return staticDeduplicateConversations(list);
        };

        // Pure merge planner: given the freshest stored list, decide whether
        // anything changed. Returns null when the write can be skipped.
        // Must stay pure (no I/O, no awaits) — it runs inside the transaction
        // lock. Dedupe semantics are unchanged from the legacy path.
        const planMerge = (existing: any[]) => {
            const existingIds = new Set((existing || []).map((c: any) => normId(c?.id)));
            const addedCount = incoming.filter((tc: any) => tc?.id && !existingIds.has(normId(tc.id))).length;
            const { processed, changedCount } = dedupe([...(existing || []), ...incoming]);

            // Only rewrite the whole table when something actually changed. Note
            // deduplicateConversations counts every distinct id's first occurrence
            // as changed (!old => isChanged), so subtract those trivial counts:
            // repeatMods > 0 means a same-id merge really moved the record
            // (authoritative title / timestamp / message growth). Titles-dict-only
            // enrichment with an unchanged resolved title is immaterial and stays
            // unsaved; a later RPC merge re-seeds what it needs.
            const trivialFirstSeen = processed.length;
            const hasChangeSignal = typeof changedCount === 'number';
            // No signal (foreign mock without changedCount) -> assume changed when
            // there is incoming data (conservative: correctness over write saving).
            const repeatMods = hasChangeSignal ? changedCount - trivialFirstSeen : (incoming.length > 0 ? 1 : 0);
            if (!(addedCount > 0 || repeatMods > 0)) return null;
            return { processed, addedCount, changed: hasChangeSignal ? changedCount : 0 };
        };

        // Atomic read-merge-write (#402): the updater re-reads the freshest
        // stored list *inside* the cross-tab conversation lock, so a concurrent
        // tab's write can no longer be discarded by our stale snapshot.
        // Falls back to the legacy snapshot path only when the transactional
        // API is unavailable or unusable (e.g. StorageService present without
        // a real chrome.storage backend in unit tests).
        const Storage = getStorage();
        const currentSlot = Store ? (Store.getCurrentSlot() || 'u0') : 'u0';
        const canTransact = !!Store && !!Storage && typeof Storage.transactConversations === 'function';
        let addedCount = 0;
        let tx: { list: any[]; changed: number; written: boolean } | null = null;
        if (canTransact) {
            try {
                tx = await Storage.transactConversations(currentSlot, (existing: any[]) => {
                    const plan = planMerge(existing);
                    if (!plan) return null;
                    addedCount = plan.addedCount;
                    return { list: plan.processed, changed: plan.changed };
                });
            } catch (e) {
                console.warn('[GemExporter:takeout] transactConversations failed, falling back to legacy write:', e);
                tx = null;
            }
        }
        if (tx) {
            // Transaction ran: refresh the UI store's in-memory snapshot so the
            // options page keeps showing the freshest list.
            if (tx.written && Store && typeof Store.setConversations === 'function') {
                Store.setConversations(tx.list);
            }
        } else if (Store) {
            // Legacy path: snapshot read + blind whole-table write.
            const convs = Store.getConversations() || [];
            const plan = planMerge(convs);
            if (plan) {
                addedCount = plan.addedCount;
                await Store.saveConversations(currentSlot, plan.processed);
            }
        }

        if (Storage) {
            if (Storage.setTakeoutPromptCompleted) await Storage.setTakeoutPromptCompleted(true);
            if (Storage.setHasImportedTakeout) await Storage.setHasImportedTakeout(true);
        }

        const successMsg = typeof t === 'function'
            ? t('takeoutSuccessDetail', incoming.length, addedCount, res.totalMediaCount)
            : `Takeout 解析成功！发现 ${incoming.length} 条对话，已补全 ${addedCount} 条缺失历史，索引 ${res.totalMediaCount} 个离线资源`;

        if (onLog) onLog(successMsg, 'info');
        if (onFinished) onFinished({ res, addedCount, totalMediaCount: res.totalMediaCount, message: successMsg });
    } catch (err: any) {
        const errMsg = typeof t === 'function' ? t('takeoutError', err.message) : `Takeout 导入失败: ${err.message}`;
        if (onLog) onLog(errMsg, 'error');
        if (onError) onError(err, errMsg);
    }
}

export const TakeoutController: TakeoutControllerContract = {
    handleTakeoutImport
};

(TakeoutController as any).TakeoutController = TakeoutController;
(TakeoutController as any).default = TakeoutController;

if (typeof globalThis !== 'undefined') {
    (globalThis as any).TakeoutController = TakeoutController;
}
if (typeof module === 'object' && module.exports) {
    module.exports = TakeoutController;
}

export default TakeoutController;
