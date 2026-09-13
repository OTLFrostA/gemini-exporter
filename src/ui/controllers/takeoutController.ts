// src/ui/controllers/takeoutController.ts - Takeout Import Controller
import type { TakeoutControllerContract } from '../../types/ui.js';
import TakeoutEngine from '../../core/engine/takeoutEngine.js';
import ConversationsStore from '../state/conversationsStore.js';
import StorageService from '../../core/storage/storageService.js';
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

        const convs = Store ? Store.getConversations() : [];
        const existingMap = new Map();
        for (const c of convs) {
            existingMap.set(normId(c.id).toLowerCase(), c);
        }

        let addedCount = 0;
        for (const tc of res.conversations) {
            const nid = normId(tc.id).toLowerCase();
            if (!existingMap.has(nid)) {
                convs.push(tc);
                existingMap.set(nid, tc);
                addedCount++;
            }
        }

        if (addedCount > 0 && Store) {
            const currentSlot = Store.getCurrentSlot() || 'u0';
            await Store.saveConversations(currentSlot, convs);
        }

        const Storage = getStorage();
        if (Storage) {
            if (Storage.setTakeoutPromptCompleted) await Storage.setTakeoutPromptCompleted(true);
            if (Storage.setHasImportedTakeout) await Storage.setHasImportedTakeout(true);
        }

        const successMsg = typeof t === 'function'
            ? t('takeoutSuccessDetail', res.conversations.length, addedCount, res.totalMediaCount)
            : `Takeout 解析成功！发现 ${res.conversations.length} 条对话，已补全 ${addedCount} 条缺失历史，索引 ${res.totalMediaCount} 个离线资源`;

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
