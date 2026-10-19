import { getAccount, listAccounts, getOrCreateAccount } from '../../core/api/accountRegistry.js';
import { importTakeout } from '../../core/imports/takeout/importTakeout.js';
import { updateSettings } from '../../core/application/settings/index.js';

export async function handleTakeoutImport(file: File, selectedAccountId: string | null, options: {
    onTarget: (id: string) => Promise<void>; onProgress?: (percent: number) => void;
}, ports = { getAccount, listAccounts, getOrCreateAccount, importTakeout, updateSettings }) {
    const accounts = await ports.listAccounts();
    const account = !accounts.length ? await ports.getOrCreateAccount('gemini', 'default')
        : selectedAccountId ? await ports.getAccount(selectedAccountId) : null;
    if (!account || account.providerId !== 'gemini') throw new Error('Select a Gemini account before importing Takeout');
    await options.onTarget(account.id);
    await ports.updateSettings({ takeoutPromptCompleted: true });
    return ports.importTakeout(file, account.id, options.onProgress);
}
