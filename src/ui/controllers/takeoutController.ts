// src/ui/controllers/takeoutController.ts - Takeout Import Controller
import type { TakeoutControllerContract } from '../../types/ui.js';
import TakeoutEngine from '../../core/engine/takeoutEngine.js';
import { __resolveModule } from '../../core/utils/moduleOverrides.js';
import ConversationsStore from '../state/conversationsStore.js';
import StorageService from '../../core/storage/storageService.js';
import { deduplicateConversations as staticDeduplicateConversations } from '../../core/utils/mergeUtils.js';
import { t, normId } from '../uiCommon.js';

const getTakeoutEngine = () => __resolveModule('TakeoutEngine', TakeoutEngine);
const getStore = () => __resolveModule('ConversationsStore', ConversationsStore);
const getStorage = () => __resolveModule('StorageService', StorageService);

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
            const injected = __resolveModule('GeminiUtils', null);
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

        const Storage = getStorage();
        const currentSlot = Store ? (Store.getCurrentSlot() || 'u0') : 'u0';
        let addedCount = 0;
        if (Storage && typeof Storage.transactConversations === 'function') {
            const tx = await Storage.transactConversations(currentSlot, (existing: any[]) => {
                const plan = planMerge(existing);
                if (!plan) return null;
                addedCount = plan.addedCount;
                return { list: plan.processed, changed: plan.changed };
            });
            if (tx?.written && Store && typeof Store.setConversations === 'function') {
                Store.setConversations(tx.list);
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

export default TakeoutController;
