import { listAccounts, getAccount, getOrCreateAccount } from '../../core/api/accountRegistry.js';
import type { TakeoutControllerContract, TakeoutImportResult } from '../../types/ui.js';
import { importTakeout } from '../../core/imports/takeout/importTakeout.js';
import { updateSettings } from '../../core/application/index.js';
import { __resolveModule } from '../../core/utils/moduleOverrides.js';
import ConversationsStore from '../state/conversationsStore.js';
import * as StorageService from '../../core/storage/storageService.js';
import { t } from '../uiCommon.js';
import { getErrorMessage } from '../../core/utils/messaging.js';

const getStore = () => __resolveModule('ConversationsStore', ConversationsStore);
const getStorage = () => __resolveModule('StorageService', StorageService);

export async function handleTakeoutImport(
    file: File,
    { onProgress, onLog, onFinished, onError }: {
        onProgress?: (pct: number, txt: string) => void;
        onLog?: (msg: string, level?: 'info' | 'warn' | 'error') => void;
        onFinished?: (result: { res: TakeoutImportResult; addedCount: number; message: string }) => void;
        onError?: (err: Error, errMsg?: string) => void;
    } = {}
): Promise<void> {
    if (!file) return;
    try {
        const Store = getStore();
        const Storage = getStorage();
        const selected = Store?.getCurrentAccountId();
        const available = await listAccounts('gemini');
        const account = !available.length ? await getOrCreateAccount('gemini', 'default')
            : selected ? await getAccount(selected) : null;
        if (!account || account.providerId !== 'gemini') throw new Error('Select a Gemini account before importing Takeout');
        const slot = account.id;
        if (selected !== slot) Store?.setCurrentAccountId(slot);
        const previous = await Storage.listIndexes(slot);
        const previousIds = new Set(previous.map(row => JSON.stringify([row.key.accountId, row.key.conversationId])));
        const res = await importTakeout(file, slot, pct => onProgress?.(pct, t('importingTakeout')));
        const accepted = await Storage.listIndexes(slot);
        const addedCount = accepted.filter(row => !previousIds.has(JSON.stringify([row.key.accountId, row.key.conversationId]))).length;
        if (Store?.getCurrentAccountId() === slot) Store.setConversations(accepted);
        if (res.imported > 0) await updateSettings({ takeoutPromptCompleted: true });
        const successMsg = t(res.status === 'partial' ? 'takeoutImportPartialResult' : 'takeoutImportResult', res.imported, addedCount);

        if (onLog) onLog(successMsg, res.status === 'partial' ? 'warn' : 'info');
        if (onFinished) onFinished({ res, addedCount, message: successMsg });
    } catch (err: unknown) {
        const errorDetail = getErrorMessage(err);
        const errMsg = typeof t === 'function' ? t('takeoutError', errorDetail) : `Takeout 导入失败: ${errorDetail}`;
        if (onLog) onLog(errMsg, 'error');
        if (onError) {
            const normalizedErr = err instanceof Error ? err : new Error(errorDetail);
            onError(normalizedErr, errMsg);
        } else throw err;
    }
}

export const TakeoutController: TakeoutControllerContract = {
    handleTakeoutImport
};

export default TakeoutController;
