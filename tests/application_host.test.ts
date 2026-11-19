import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationHost, provideApplicationHost, type ApplicationHost } from '../src/application/host.js';

test('Application host requires provision and preserves the supplied operations', async () => {
    assert.throws(() => applicationHost(), /Application host has not been provided/);
    const account = { id: 'account', providerId: 'gemini', providerAccountId: 'source' };
    const notifications: string[] = [];
    const host: ApplicationHost = {
        async getAccount(id) { return id === account.id ? account : null; },
        async getOrCreateAccount() { return account; },
        notifyDomainChanged(id) { notifications.push(id); },
    };
    provideApplicationHost(host);
    assert.equal(applicationHost(), host);
    assert.equal(await applicationHost().getAccount(account.id), account);
    assert.equal(await applicationHost().getAccount('missing'), null);
    assert.equal(await applicationHost().getOrCreateAccount('gemini', 'source'), account);
    applicationHost().notifyDomainChanged(account.id);
    assert.deepEqual(notifications, [account.id]);
    provideApplicationHost({ ...host, async getAccount() { throw new Error('lookup failed'); } });
    await assert.rejects(applicationHost().getAccount(account.id), /lookup failed/);
});
