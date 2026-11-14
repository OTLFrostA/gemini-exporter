import { OperationError } from '../../../shared/errors/operationError.js';
import type { Account } from '../../../l2/accountRegistry.js';
import { getAccount, listAccounts, getOrCreateAccount } from '../../../runtime/api/accountRegistry.js';
import { importOpenAI, type OpenAIImportResult } from '../../../application/imports/importOpenAI.js';
import { importTakeout, type TakeoutParseResult } from '../../../application/imports/importTakeout.js';
import type { SourceResourceContext } from '../../../application/resources.js';
import { updateSettings } from '../../../application/settings/index.js';

export type ArchiveImportOutcome =
    | { readonly kind: 'openai'; readonly result: OpenAIImportResult }
    | { readonly kind: 'takeout'; readonly result: TakeoutParseResult };

export async function handleTakeoutImport(file: File, selectedAccountId: string | null, options: {
    onTarget: (id: string) => Promise<void>; onProgress?: (percent: number) => void; resources?: SourceResourceContext;
}, ports = { getAccount, listAccounts, getOrCreateAccount, importTakeout, updateSettings }) {
    const accounts = await ports.listAccounts();
    const account = !accounts.length ? await ports.getOrCreateAccount('gemini', 'default')
        : selectedAccountId ? await ports.getAccount(selectedAccountId) : null;
    if (!account || account.providerId !== 'gemini')
        throw new OperationError('GEMINI_ACCOUNT_REQUIRED', 'Select a Gemini account before importing Takeout');
    await options.onTarget(account.id);
    await ports.updateSettings({ takeoutPromptCompleted: true });
    return options.resources
        ? ports.importTakeout(file, account.id, options.onProgress, options.resources)
        : ports.importTakeout(file, account.id, options.onProgress);
}

/** Unified UI controller for platform ZIP archive imports (OpenAI export ZIP and Google Takeout ZIP). */
export async function handlePlatformArchiveImport(file: File, selectedAccount: Account | undefined, selectedAccountId: string | null, options: {
    onStartKind?: (kind: 'openai' | 'takeout') => void;
    onTarget: (id: string) => Promise<void>;
    onProgress?: (percent: number) => void;
    resources?: SourceResourceContext;
}): Promise<ArchiveImportOutcome> {
    if (selectedAccount?.providerId === 'chatgpt') {
        options.onStartKind?.('openai');
        const result = await importOpenAI(file, selectedAccount.id, options.onProgress, options.resources);
        return { kind: 'openai', result };
    }
    options.onStartKind?.('takeout');
    const result = await handleTakeoutImport(file, selectedAccountId, options);
    return { kind: 'takeout', result };
}
