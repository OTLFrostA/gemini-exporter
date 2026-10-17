import { getOrCreateAccount } from '../core/domain/accountAdmission.js';
import { listAccounts, getAccount } from '../core/storage/accountRegistryStore.js';
import { ensureStorageReady } from '../core/storage/schemaMigration.js';

export function handleAccountRegistryMessage(message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void): boolean {
    if (!message || typeof message !== 'object' || !('action' in message) || message.action !== 'accountRegistry') return false;
    if (sender.id !== chrome.runtime.id) { respond({ ok: false, error: 'Foreign account registry sender' }); return true; }
    void (async () => {
        try {
            await ensureStorageReady();
            if (!('command' in message)) throw new TypeError('Missing account registry command');
            if (message.command === 'list') {
                const providerId = 'providerId' in message ? message.providerId : undefined;
                if (providerId !== undefined && typeof providerId !== 'string') throw new TypeError('Invalid provider ID');
                respond({ ok: true, value: await listAccounts(providerId) }); return;
            }
            if (message.command === 'get' && 'accountId' in message && typeof message.accountId === 'string') {
                respond({ ok: true, value: await getAccount(message.accountId) }); return;
            }
            if (message.command !== 'getOrCreate' || !('providerId' in message) || typeof message.providerId !== 'string'
                || !('providerAccountId' in message) || typeof message.providerAccountId !== 'string') throw new TypeError('Invalid account registry command');
            const email = 'email' in message ? message.email : undefined;
            const displayName = 'displayName' in message ? message.displayName : undefined;
            if (email !== undefined && typeof email !== 'string' || displayName !== undefined && typeof displayName !== 'string') throw new TypeError('Invalid account profile');
            respond({ ok: true, value: await getOrCreateAccount(message.providerId, message.providerAccountId, email, displayName) });
        } catch (error) { respond({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
    })();
    return true;
}
