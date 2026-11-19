import { provideProviderHost } from '../../l1/client/providerHost.js';
import { OperationError } from '../../shared/errors/operationError.js';
import { readAccountContextReply } from '../../shared/types/accountContextReply.js';
import { resolveCurrentAccount } from '../content/accountContext.js';
import { getAccount } from './accountRegistry.js';

/** Runtime routing is frozen before acquisition, never inferred from SID or Slot. */
async function resolveGeminiRoute(accountId: string): Promise<string> {
    if (typeof document !== 'undefined' && location.hostname === 'gemini.google.com') {
        const context = await resolveCurrentAccount();
        if (context?.accountId === accountId) return context.slot;
    } else if (typeof chrome !== 'undefined' && chrome.tabs) {
        const failures: string[] = [];
        const tabs = [...await chrome.tabs.query({ url: ['https://gemini.google.com/*'] })]
            .sort((a, b) => Number(!!b.active) - Number(!!a.active));
        for (const tab of tabs) {
            if (tab.id === undefined) continue;
            try {
                const parsed = readAccountContextReply(await chrome.tabs.sendMessage(tab.id, { action: 'getAccountContext' }));
                if (!parsed.ok) {
                    failures.push(`tab ${tab.id}: ${parsed.error ?? 'invalid reply'}`);
                    continue;
                }
                const context = parsed.accountContext;
                if (context && context.accountId === accountId && context.slot && /^u\d+$/.test(context.slot)) {
                    return context.slot;
                }
                failures.push(`tab ${tab.id}: ${context === null ? 'unknown account' : 'account or slot mismatch'}`);
            } catch (error) { failures.push(`tab ${tab.id}: ${error instanceof Error ? error.message : String(error)}`); }
        }
        throw new OperationError('SOURCE_PAGE_UNAVAILABLE', 'No verified Gemini account route: ' + (failures.join('; ') || 'no Gemini tabs'));
    }
    throw new OperationError('SOURCE_PAGE_UNAVAILABLE', 'No verified Gemini account route');
}

export function installProviderHost(): void {
    provideProviderHost({ getAccount, resolveGeminiRoute });
}
