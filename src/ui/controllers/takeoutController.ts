import type { TakeoutControllerContract } from '../../types/ui.js';
import TakeoutEngine from '../../core/engine/takeoutEngine.js';
import { __resolveModule } from '../../core/utils/moduleOverrides.js';
import ConversationsStore from '../state/conversationsStore.js';
import StorageService from '../../core/storage/storageService.js';
import { t } from '../uiCommon.js';
import { getErrorMessage } from '../../core/utils/messaging.js';

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
        const Storage = getStorage();
        const previous = await Storage.getConversations(slot);
        const previousIds = new Set(previous.map(row => JSON.stringify([row.providerId, row.id])));
        const res = await Takeout.parseTakeoutZip(file, (pct: number, txt: string) => {
            if (onProgress) onProgress(pct, txt);
            if (onLog) onLog(txt, 'info');
        }, slot);

        for (const diagnostic of res.diagnostics ?? []) {
            if (diagnostic.severity !== 'info') onLog?.(`${diagnostic.code}: ${diagnostic.message}`, 'warn');
        }
        const incoming = Array.isArray(res.conversations) ? res.conversations : [];

        const addedCount = incoming.filter(row => !previousIds.has(JSON.stringify([row.providerId, row.id]))).length;
        const accepted = await Storage.getConversations(slot);
        if (Store?.getCurrentSlot() === slot) Store.setConversations(accepted);

        if (Storage) {
            if (Storage.setTakeoutPromptCompleted) await Storage.setTakeoutPromptCompleted(true);
            if (Storage.setHasImportedTakeout) await Storage.setHasImportedTakeout(true);
        }

        const successMsg = typeof t === 'function'
            ? t('takeoutSuccessDetail', incoming.length, addedCount, res.totalMediaCount)
            : `Takeout 解析成功！发现 ${incoming.length} 条对话，已补全 ${addedCount} 条缺失历史，索引 ${res.totalMediaCount} 个离线资源`;

        if (onLog) onLog(successMsg, 'info');
        if (onFinished) onFinished({ res, addedCount, totalMediaCount: res.totalMediaCount, message: successMsg });
    } catch (err: unknown) {
        const errorDetail = getErrorMessage(err);
        const errMsg = typeof t === 'function' ? t('takeoutError', errorDetail) : `Takeout 导入失败: ${errorDetail}`;
        if (onLog) onLog(errMsg, 'error');
        if (onError) {
            const normalizedErr = err instanceof Error ? err : new Error(errorDetail);
            onError(normalizedErr, errMsg);
        }
    }
}

export const TakeoutController: TakeoutControllerContract = {
    handleTakeoutImport
};

export default TakeoutController;
