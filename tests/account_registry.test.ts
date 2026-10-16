import test from 'node:test';
import { accountRuntime, ACCOUNT_UUID } from './helpers/accountRuntime.js';
import assert from 'node:assert/strict';
import { readAccountFact, readAccountObservation, readAccountRegistry, resolveAccount } from '../src/core/domain/accountRegistry.js';
import { geminiAccountObservation } from '../src/core/provider/gemini/accountObservation.js';
import { chatgptAccountObservation } from '../src/core/provider/chatgpt/accountObservation.js';
import { getAccountContext, resolveCurrentAccount, invalidateAccountContext, matchesCurrentAccount } from '../src/content/accountContext.js';

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
test('ChatGPT tuple isolates login users and workspaces while email stays mutable profile data', () => {
    const session = { user: { id: 'user-a', email: ' ALICE@EXAMPLE.COM ', name: ' Alice ' },
        account: { id: 'workspace-a' }, accessToken: 'must-not-persist', sessionToken: 'must-not-persist' };
    const observation = chatgptAccountObservation(session);
    assert.deepEqual(observation, { providerId: 'chatgpt', providerAccountId: '["user-a","workspace-a"]',
        email: 'alice@example.com', displayName: 'Alice' });
    if (!observation) throw new Error('Expected identified ChatGPT session');
    const account = { ...observation, id: alice.id };
    const changed = chatgptAccountObservation({ ...session, user: { ...session.user, email: 'new@example.com' } });
    if (!changed) throw new Error('Expected identified ChatGPT session');
    assert.deepEqual(resolveAccount([account], changed), { resolution: 'existing', account: { ...account, email: 'new@example.com' } });
    for (const other of [
        { ...session, account: { id: 'workspace-b' } },
        { ...session, user: { ...session.user, id: 'user-b' } },
    ]) {
        const next = chatgptAccountObservation(other);
        if (!next) throw new Error('Expected identified ChatGPT session');
        assert.equal(resolveAccount([account], next).resolution, 'create');
    }
    for (const invalid of [null, {}, { user: session.user }, { account: session.account },
        { user: { id: ' ' }, account: session.account }, { user: session.user, account: { id: 'default' } },
        { user: [], account: session.account }, { user: { id: 123 }, account: session.account }]) {
        assert.equal(chatgptAccountObservation(invalid), null);
    }
    assert.deepEqual(chatgptAccountObservation({ user: { id: 'user-a' }, account: session.account }), {
        providerId: 'chatgpt', providerAccountId: observation.providerAccountId
    });
    assert.notEqual(chatgptAccountObservation({ user: { id: 'a:b' }, account: { id: 'c' } })?.providerAccountId,
        chatgptAccountObservation({ user: { id: 'a' }, account: { id: 'b:c' } })?.providerAccountId);
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
    invalidateAccountContext();
    try { await run(state); } finally {
        invalidateAccountContext();
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
    assert.equal(getAccountContext()?.accountId, alice.id, 'DOM email is not stable identity evidence');
}));
test('same Gaia keeps UUID visible during profile update and deduplicates identical observations', async () => runtimeFixture(async state => {
    const observation = { providerId: 'gemini', providerAccountId: '101', email: alice.email };
    await resolveCurrentAccount(observation);
    const calls = state.calls.length;
    await resolveCurrentAccount({ ...observation });
    assert.equal(state.calls.length, calls);
    let finish!: (value: unknown) => void;
    state.reply = () => new Promise(resolve => { finish = resolve; });
    const update = resolveCurrentAccount({ ...observation, email: 'changed@example.com' });
    const duplicate = resolveCurrentAccount({ ...observation, email: 'changed@example.com' });
    assert.equal(state.calls.length, calls + 1);
    assert.equal(getAccountContext()?.accountId, alice.id);
    assert.equal(matchesCurrentAccount({ ...observation, providerAccountId: '102' }), false);
    finish({ ok: true, value: { resolution: 'existing', account: { ...alice, email: 'changed@example.com' } } });
    assert.equal((await update)?.accountId, alice.id);
    assert.equal((await duplicate)?.accountId, alice.id);
}));
test('loss of stable observation clears cached identity even with unchanged email and slot', async () => runtimeFixture(async () => {
    await resolveCurrentAccount({ providerId: 'gemini', providerAccountId: '101' });
    assert.equal(await resolveCurrentAccount(null), null);
    assert.equal(getAccountContext(), null);
}));
test('a failed same-Gaia profile update remains retryable and does not hide the committed UUID', async () => runtimeFixture(async state => {
    const observation = { providerId: 'gemini', providerAccountId: '101' };
    await resolveCurrentAccount(observation);
    state.reply = async () => { throw new Error('disk failed'); };
    await assert.rejects(resolveCurrentAccount({ ...observation, email: 'changed@example.com' }), /disk failed/);
    assert.equal(getAccountContext()?.accountId, alice.id);
    const calls = state.calls.length;
    state.reply = async () => ({ ok: true, value: { resolution: 'existing', account: alice } });
    await resolveCurrentAccount({ ...observation, email: 'changed@example.com' });
    assert.equal(state.calls.length, calls + 1);
    assert.equal(await resolveCurrentAccount(), null, 'an unavailable MAIN bridge cannot return a stale cached account');
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

test('concurrent fresh queries await one committed Registry binding', async () => runtimeFixture(async () => {
    const runtime = accountRuntime();
    try {
        const contexts = await Promise.all([resolveCurrentAccount(), resolveCurrentAccount(), resolveCurrentAccount()]);
        assert.deepEqual(contexts.map(context => context?.accountId), [ACCOUNT_UUID, ACCOUNT_UUID, ACCOUNT_UUID]);
    } finally { runtime.restore(); }
}));
