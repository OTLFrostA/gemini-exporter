import { hasPlatformAccess } from '../../l1/client/platformAccess.js';
import { getAccount } from '../../l3a/storageService.js';
import { isAccountId } from '../../l2/accountRegistry.js';
import { platformDisplayName, platformForPageUrl, type SourcePlatform } from '../../shared/platformHosts.js';
import { expectRecord } from '../../shared/utils/typeGuards.js';

export async function assertPlatformSiteAccess(providerId: SourcePlatform): Promise<void> {
    if (!await hasPlatformAccess(providerId)) {
        throw new Error(`${platformDisplayName(providerId)} site access revoked`);
    }
}

export function assertExtensionSender(sender: chrome.runtime.MessageSender): void {
    if (sender.id !== chrome.runtime.id) throw new Error('Foreign extension sender');
}

export function assertContentSender(sender: chrome.runtime.MessageSender): { providerId: SourcePlatform; tabId: number } {
    assertExtensionSender(sender);
    const providerId = platformForPageUrl(sender.url);
    const tabId = sender.tab?.id;
    if (tabId === undefined || !providerId || (sender.frameId !== undefined && sender.frameId !== 0)) {
        throw new Error('Unsupported Provider Content sender');
    }
    return { tabId, providerId };
}

export function contentProviderId(sender: chrome.runtime.MessageSender): SourcePlatform {
    return assertContentSender(sender).providerId;
}

export async function requireContentContext(sender: chrome.runtime.MessageSender, accountId: unknown) {
    const { providerId, tabId } = assertContentSender(sender);
    if (!isAccountId(accountId)) throw new TypeError('Expected Account UUID');
    const account = await getAccount(accountId);
    if (!account || account.providerId !== providerId) throw new Error('Content Account/Provider mismatch');
    await assertPlatformSiteAccess(providerId);
    return { account, tabId };
}

/** Active operations must still belong to the sending document's current Account.
 * Passive ingestion deliberately uses requireContentContext and its captured request identity.
 */
export async function requireCurrentContentAccount(sender: chrome.runtime.MessageSender, accountId: unknown) {
    const { account, tabId } = await requireContentContext(sender, accountId);
    const providerId = assertContentSender(sender).providerId;
    const response: unknown = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Current Tab Account check timed out')), 3000);
        try {
            chrome.tabs.sendMessage(tabId, { action: 'getAccountContext' },
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
    await assertPlatformSiteAccess(providerId);
    return account;
}

export function object(value: unknown): Record<string, unknown> {
    return expectRecord(value, 'Expected message object');
}
