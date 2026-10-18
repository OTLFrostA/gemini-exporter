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
export function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected message object');
    return value as Record<string, unknown>;
}
