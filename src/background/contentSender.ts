import { getAccount } from '../core/storage/storageService.js';
import { isAccountId } from '../core/domain/accountRegistry.js';

export function assertExtensionSender(sender: chrome.runtime.MessageSender): void {
    if (sender.id !== chrome.runtime.id) throw new Error('Foreign extension sender');
}
export function assertContentSender(sender: chrome.runtime.MessageSender): void {
    assertExtensionSender(sender);
    const url = sender.url && new URL(sender.url);
    if (sender.tab?.id === undefined || !url || url.origin !== 'https://gemini.google.com'
        || (sender.frameId !== undefined && sender.frameId !== 0)) throw new Error('Unsupported Provider Content sender');
}
export async function requireContentAccount(sender: chrome.runtime.MessageSender, accountId: unknown) {
    assertContentSender(sender);
    if (!isAccountId(accountId)) throw new TypeError('Expected Account UUID');
    const account = await getAccount(accountId);
    if (!account || account.providerId !== 'gemini') throw new Error('Content Account/Provider mismatch');
    return account;
}
/** Active operations must still belong to the sending document's current Account.
 * Passive ingestion deliberately uses requireContentAccount and its captured request identity.
 */
export async function requireCurrentContentAccount(sender: chrome.runtime.MessageSender, accountId: unknown) {
    const account = await requireContentAccount(sender, accountId);
    const response: unknown = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Current Tab Account check timed out')), 3000);
        try {
            chrome.tabs.sendMessage(sender.tab!.id!, { action: 'getAccountContext' },
                { frameId: 0, ...(sender.documentId ? { documentId: sender.documentId } : {}) }, value => {
                    clearTimeout(timer);
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message || 'Tab unavailable'));
                    else resolve(value);
                });
        } catch (error) { clearTimeout(timer); reject(error); }
    });
    const result = object(response);
    const context = object(result.accountContext);
    if (result.ok !== true || context.providerId !== account.providerId || context.accountId !== account.id) {
        throw new Error('Requested Account does not match the sending Tab');
    }
    return account;
}
export function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected message object');
    return value as Record<string, unknown>;
}
