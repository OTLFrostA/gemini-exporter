import test from 'node:test';
import assert from 'node:assert/strict';
import { readAccountFact, readAccountObservation, readAccountRegistry, resolveAccount } from '../src/core/domain/accountRegistry.js';
import { geminiAccountObservation } from '../src/core/provider/gemini/accountObservation.js';
import { getAccountContext, resolveCurrentAccount } from '../src/content/accountContext.js';

const alice = { id: 'a0000000-0000-4000-8000-000000000001', providerId: 'gemini', providerAccountId: '101', email: 'alice@example.com' };
const bob = { ...alice, id: 'b0000000-0000-4000-8000-000000000002', providerAccountId: '102' };

test('Registry reuses UUID by provider subject, preserves missing hints and isolates providers', () => {
    const before = structuredClone(alice);
    assert.deepEqual(resolveAccount([alice], { providerId: 'gemini', providerAccountId: '101' }), { resolution: 'existing', account: alice });
    const renamed = resolveAccount([alice], { providerId: 'gemini', providerAccountId: '101', email: 'new@example.com' });
    assert.equal(renamed.resolution, 'existing');
    if (renamed.resolution === 'existing') { assert.equal(renamed.account.id, alice.id); assert.equal(renamed.account.email, 'new@example.com'); }
    assert.equal(resolveAccount([alice], { providerId: 'claude', providerAccountId: '101', email: alice.email }).resolution, 'create');
    assert.equal(resolveAccount([alice], { providerId: 'gemini', providerAccountId: '102', email: alice.email }).resolution, 'create');
    assert.deepEqual(alice, before);
});
test('missing remote identity is not admitted and duplicate identities fail closed', () => {
    assert.throws(() => readAccountObservation({ providerId: 'gemini', email: alice.email }));
    assert.equal(geminiAccountObservation({ email: alice.email }), null);
    assert.throws(() => resolveAccount([alice, { ...alice, id: bob.id }], alice), /Duplicate/);
});
test('physical schema rejects slots, scan fields, malformed UUIDs and duplicate identities', () => {
    assert.deepEqual(readAccountFact(alice), alice);
    for (const patch of [{ id: 'u0' }, { id: alice.email }, { slot: 'u0' }, { count: 1 }, { lastSync: 'today' }, { email: null }, { displayName: '' }]) {
        assert.throws(() => readAccountFact({ ...alice, ...patch }), TypeError);
    }
    assert.throws(() => readAccountRegistry([alice, alice]), /Duplicate/);
    assert.throws(() => readAccountRegistry([alice, { ...alice, id: bob.id }]), /Duplicate/);
    assert.deepEqual(readAccountRegistry([alice, bob]).length, 2);
    assert.throws(() => readAccountObservation({ providerId: 'gemini', slot: 'u0' }));
});
test('Gemini adapter maps Gaia into a provider-neutral observation without runtime fields', () => {
    assert.deepEqual(geminiAccountObservation({ gaiaId: ' 101 ', email: ' ALICE@EXAMPLE.COM ', name: ' Alice ' }), {
        providerId: 'gemini', providerAccountId: '101', email: 'alice@example.com', displayName: 'Alice'
    });
});

async function runtimeFixture(run: (state: { email: string; slot: string; subject: string | undefined; calls: unknown[]; reply: (message: unknown) => Promise<unknown> }) => Promise<void>) {
    const names = ['chrome', 'document', 'location'] as const;
    const old = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
    const state = { email: 'runtime@example.com', slot: 'u0', subject: undefined as string | undefined, calls: [] as unknown[],
        reply: async (_message: unknown): Promise<unknown> => ({ ok: true, value: { resolution: 'existing', account: alice } }) };
    Object.defineProperty(globalThis, 'location', { configurable: true, get: () => ({ href: `https://gemini.google.com/u/${state.slot.slice(1)}/app` }) });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
        querySelectorAll: () => [{ getAttribute: (name: string) => name === 'data-email' ? state.email : null }],
        get defaultView() { return { _WIZ_global_data: { qDCSke: state.subject } }; }
    } });
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: { sendMessage: async (message: unknown) => { state.calls.push(message); return state.reply(message); } } } });
    getAccountContext();
    try { await run(state); } finally {
        state.email = 'cleared@example.com'; getAccountContext();
        for (const [name, descriptor] of old) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
        }
    }
}
test('upper identity path receives UUID from Registry; hints and slots never manufacture one', async () => runtimeFixture(async state => {
    assert.equal(await resolveCurrentAccount(), null);
    assert.equal(state.calls.length, 0);
    const context = await resolveCurrentAccount({ providerId: 'gemini', providerAccountId: '101' });
    assert.deepEqual(context, { providerId: 'gemini', accountId: alice.id, slot: 'u0' });
    assert.equal(await resolveCurrentAccount(undefined, 'u1'), null);
    assert.equal(getAccountContext()?.accountId, alice.id);
    assert.deepEqual(state.calls[0], { action: 'accountRegistry', command: 'observe', observation: { providerId: 'gemini', providerAccountId: '101' } });
    state.slot = 'u1';
    assert.equal(getAccountContext(), null);
    assert.equal((await resolveCurrentAccount({ providerId: 'gemini', providerAccountId: '101' }))?.accountId, alice.id);
    state.email = 'switched@example.com';
    assert.equal(getAccountContext(), null);
}));
test('delayed registration does not restore a switched account or supersede a newer binding', async () => runtimeFixture(async state => {
    let finish: (value: unknown) => void = () => { throw new Error('No pending response'); };
    state.reply = () => new Promise(resolve => { finish = resolve; });
    const pending = resolveCurrentAccount({ providerId: 'gemini', providerAccountId: '101' });
    state.email = 'next@example.com';
    state.reply = async () => ({ ok: true, value: { resolution: 'existing', account: bob } });
    assert.equal((await resolveCurrentAccount({ providerId: 'gemini', providerAccountId: '102' }))?.accountId, bob.id);
    finish({ ok: true, value: { resolution: 'created', account: alice } });
    assert.equal(await pending, null);
    assert.equal(getAccountContext()?.accountId, bob.id);
}));
test('storage errors and mismatched replies do not leave the old UUID bound', async () => runtimeFixture(async state => {
    await resolveCurrentAccount({ providerId: 'gemini', providerAccountId: '101' });
    state.reply = async () => ({ ok: true, value: { resolution: 'existing', account: alice } });
    await assert.rejects(resolveCurrentAccount({ providerId: 'gemini', providerAccountId: '102' }), /mismatch/);
    assert.equal(getAccountContext(), null);
    state.reply = async () => { throw new Error('disk failed'); };
    await assert.rejects(resolveCurrentAccount({ providerId: 'gemini', providerAccountId: '101' }), /disk failed/);
    assert.equal(getAccountContext(), null);
}));
