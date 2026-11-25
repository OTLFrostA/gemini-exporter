import { describe as __suiteDescribe } from 'node:test';
import { test } from "node:test";
import assert from "node:assert/strict";
import { readAccount } from "../src/l2/accountRegistry.js";
import { readAccountParameters } from "../src/l2/accountRegistry.js";
import { readAccountRegistry } from "../src/l2/accountRegistry.js";
import { findAccount } from "../src/l2/accountRegistry.js";
import { geminiAccountObservation } from "../src/l1/client/gemini/accountObservation.js";
import { chatgptAccountObservation } from "../src/l1/client/chatgpt/accountObservation.js";
import { resolveCurrentAccount } from "../src/runtime/content/accountContext.js";
import { resolveRequestAccount } from "../src/runtime/content/accountContext.js";
import { getAccountContext } from "../src/runtime/content/accountContext.js";
import { invalidateAccountContext } from "../src/runtime/content/accountContext.js";
import { configureAccountAdapter } from "../src/runtime/content/accountContext.js";
import { createGeminiAccountAdapter } from "../src/runtime/content/adapters/geminiAccountAdapter.js";
import { accountRuntime } from "./helpers/accountRuntime.js";
import { ACCOUNT_UUID } from "./helpers/accountRuntime.js";
import { OTHER_ACCOUNT_UUID } from "./helpers/accountRuntime.js";
import { ACCOUNT_OBSERVATION } from "./helpers/accountRuntime.js";
import test__s1 from "node:test";
import { indexStorage } from "./helpers/indexStorage.js";
import { getOrCreateAccount } from "../src/l2/accountAdmission.js";
import { getAccount } from "../src/l3a/storageService.js";
import { listAccounts } from "../src/l3a/storageService.js";
import { putAccount } from "../src/l3a/storageService.js";

__suiteDescribe("account_registry", () => {
configureAccountAdapter(createGeminiAccountAdapter());
const alice = { id: ACCOUNT_UUID, providerId: 'gemini', providerAccountId: '101', email: 'alice@example.com' };

test('matching preserves UUID and missing profile fields; mutable email is not identity', () => {
    assert.deepEqual(findAccount([alice], 'gemini', '101'), alice);
    assert.deepEqual(findAccount([alice], 'gemini', '101', 'new@example.com'), { ...alice, email: 'new@example.com' });
    assert.equal(findAccount([alice], 'claude', '101', alice.email), null);
    assert.equal(findAccount([alice], 'gemini', '102', alice.email), null);
    assert.equal(alice.email, 'alice@example.com');
});
test('only Account is durable; UUID, identity, extra fields and duplicates are validated', () => {
    assert.deepEqual(readAccount(alice), alice);
    for (const patch of [{ id: 'u0' }, { id: alice.email }, { slot: 'u0' }, { count: 1 }, { email: null }, { displayName: '' }]) {
        assert.throws(() => readAccount({ ...alice, ...patch }), TypeError);
    }
    assert.throws(() => readAccountRegistry([alice, alice]), /Duplicate/);
    assert.throws(() => readAccountRegistry([alice, { ...alice, id: OTHER_ACCOUNT_UUID }]), /Duplicate/);
    assert.throws(() => readAccountParameters({ providerId: 'gemini', email: alice.email }));
});
test('default is a normal UUID account with a provider-local reserved key and no borrowed profile', () => {
    const fallback = { id: OTHER_ACCOUNT_UUID, providerId: 'gemini', providerAccountId: 'default' };
    assert.deepEqual(readAccount({ ...fallback, email: alice.email, displayName: 'Unverified' }), fallback);
    assert.deepEqual(findAccount([fallback], 'gemini', 'default', alice.email), fallback);
    assert.equal(findAccount([fallback], 'chatgpt', 'default'), null);
    assert.equal(findAccount([fallback], 'gemini', alice.providerAccountId), null);
});
test('Gemini requires Gaia and normalizes only its verified profile', () => {
    assert.equal(geminiAccountObservation({ email: alice.email }), null);
    assert.deepEqual(geminiAccountObservation({ gaiaId: ' 101 ', email: ' ALICE@EXAMPLE.COM ', name: ' Alice ' }), {
        providerId: 'gemini', providerAccountId: '101', email: alice.email, displayName: 'Alice'
    });
});
test('ChatGPT user/workspace tuple isolates subjects and keeps email mutable', () => {
    const session = { user: { id: 'user-a', email: ' ALICE@EXAMPLE.COM ', name: ' Alice ' }, account: { id: 'workspace-a' }, accessToken: 'never-persist' };
    const parameters = chatgptAccountObservation(session)!;
    assert.deepEqual(parameters, { providerId: 'chatgpt', providerAccountId: '["user-a","workspace-a"]', email: alice.email, displayName: 'Alice' });
    const account = { ...parameters, id: ACCOUNT_UUID };
    assert.equal(findAccount([account], 'chatgpt', parameters.providerAccountId, 'new@example.com')?.id, ACCOUNT_UUID);
    for (const other of [{ ...session, account: { id: 'workspace-b' } }, {   ...session, user: { id: 'user-b' } }]) {
        assert.notEqual(chatgptAccountObservation(other)?.providerAccountId, parameters.providerAccountId);
    }
    for (const invalid of [null, {}, { user: session.user }, { user: session.user, account: { id: 'default' } }]) assert.equal(chatgptAccountObservation(invalid), null);
    assert.notEqual(chatgptAccountObservation({ user: { id: 'a:b' }, account: { id: 'c' } })?.providerAccountId,
        chatgptAccountObservation({ user: { id: 'a' }, account: { id: 'b:c' } })?.providerAccountId);
});
test('concurrent Gaia discovery reuses UUID; Gaia loss clears context without allocating a default', async () => {
    const runtime = accountRuntime();
    try {
        const contexts = await Promise.all([resolveCurrentAccount(), resolveCurrentAccount(), resolveCurrentAccount()]);
        assert.deepEqual(contexts.map(context => context?.accountId), [ACCOUNT_UUID, ACCOUNT_UUID, ACCOUNT_UUID]);
        runtime.state.observation = null;
        const fallback = await resolveCurrentAccount();
        assert.equal(fallback, null);
        assert.equal(getAccountContext(), null);
        runtime.state.observation = { ...ACCOUNT_OBSERVATION };
        assert.equal((await resolveCurrentAccount())?.accountId, ACCOUNT_UUID);
    } finally { runtime.restore(); }
});
test('late response keeps the captured account after a same-slot switch; unknown maps to existing first real account', async () => {
    const runtime = accountRuntime();
    try {
        await resolveCurrentAccount();
        runtime.state.observation = { providerId: 'gemini', providerAccountId: 'other-gaia' };
        assert.equal((await resolveCurrentAccount())?.accountId, OTHER_ACCOUNT_UUID);
        assert.equal((await resolveRequestAccount(ACCOUNT_OBSERVATION, 'u0'))?.accountId, ACCOUNT_UUID);
        assert.equal(getAccountContext()?.accountId, OTHER_ACCOUNT_UUID);
        assert.equal((await resolveRequestAccount(null, 'u0'))?.accountId, ACCOUNT_UUID);
        assert.equal(await resolveRequestAccount(undefined, 'u0'), null);
    } finally { runtime.restore(); }
});
test('failed persistence cannot acknowledge a new binding', async () => {
    const runtime = accountRuntime(); const original = chrome.runtime.sendMessage;
    try {
        chrome.runtime.sendMessage = (async () => { throw new Error('disk failed'); }) as typeof original;
        await assert.rejects(resolveCurrentAccount(), /disk failed/);
        assert.equal(getAccountContext(), null);
        invalidateAccountContext();
    } finally { chrome.runtime.sendMessage = original; runtime.restore(); }
});

test('same-account profile updates retain the committed binding and coalesce identical writes', async () => {
    const runtime = accountRuntime(); const original = chrome.runtime.sendMessage;
    try {
        await resolveCurrentAccount(ACCOUNT_OBSERVATION);
        let release!: () => void, calls = 0;
        const gate = new Promise<void>(resolve => { release = resolve; });
        chrome.runtime.sendMessage = (async message => {
            calls++;
            await gate;
            return Reflect.apply(original, chrome.runtime, [message]);
        }) as typeof original;
        const changed = {...ACCOUNT_OBSERVATION, email:'changed@example.com'};
        const first = resolveCurrentAccount(changed);
        const second = resolveCurrentAccount(changed);
        assert.equal(getAccountContext()?.accountId, ACCOUNT_UUID);
        assert.equal(calls, 1);
        release();
        assert.deepEqual((await Promise.all([first,second])).map(value => value?.accountId), [ACCOUNT_UUID,ACCOUNT_UUID]);
    } finally {chrome.runtime.sendMessage = original; runtime.restore();}
});
test('a failed profile update leaves the committed UUID usable and the new profile retryable', async () => {
    const runtime = accountRuntime(); const original = chrome.runtime.sendMessage;
    try {
        await resolveCurrentAccount(ACCOUNT_OBSERVATION);
        const changed = {...ACCOUNT_OBSERVATION, email:'retry@example.com'};
        chrome.runtime.sendMessage = (async () => { throw new Error('quota'); }) as typeof original;
        await assert.rejects(resolveCurrentAccount(changed), /quota/);
        assert.equal(getAccountContext()?.accountId, ACCOUNT_UUID);
        chrome.runtime.sendMessage = original;
        assert.equal((await resolveCurrentAccount(changed))?.accountId, ACCOUNT_UUID);
    } finally {chrome.runtime.sendMessage = original; runtime.restore();}
});
test('a delayed registration cannot restore a superseded current-tab binding', async () => {
    const runtime = accountRuntime(); const original = chrome.runtime.sendMessage;
    let release!: () => void;
    try {
        const gate = new Promise<void>(resolve => {release = resolve;});
        chrome.runtime.sendMessage = (async (message: {providerAccountId?: string}) => {
            if(message.providerAccountId === ACCOUNT_OBSERVATION.providerAccountId) await gate;
            return Reflect.apply(original, chrome.runtime, [message]);
        }) as typeof original;
        const old = resolveCurrentAccount(ACCOUNT_OBSERVATION);
        assert.equal((await resolveCurrentAccount({providerId:'gemini',providerAccountId:'other-gaia'}))?.accountId, OTHER_ACCOUNT_UUID);
        release();
        assert.equal(await old, null);
        assert.equal(getAccountContext()?.accountId, OTHER_ACCOUNT_UUID);
    } finally {release?.(); chrome.runtime.sendMessage = original; runtime.restore();}
});
test('mismatched committed identities never bind a UUID to the current tab', async () => {
    const runtime = accountRuntime(); const original = chrome.runtime.sendMessage;
    try {
        chrome.runtime.sendMessage = (async () => ({ok:true,value:{...alice,providerAccountId:'unexpected'}})) as typeof original;
        await assert.rejects(resolveCurrentAccount(ACCOUNT_OBSERVATION), /identity mismatch/);
        assert.equal(getAccountContext(), null);
    } finally {chrome.runtime.sendMessage = original; runtime.restore();}
});
});

__suiteDescribe("l2_account_registry", () => {
test__s1('L2 AccountRegistry stores one UUID per provider identity, including concurrent discovery', async () => {
    const env = indexStorage({}, { seedAccounts: false });
    try {
        const identities = await Promise.all(Array.from({ length: 8 },
            () => getOrCreateAccount('gemini', 'source-account')));
        assert.equal(new Set(identities.map(account => account.id)).size, 1);
        const persisted = await getAccount(identities[0].id);
        assert.deepEqual(persisted, identities[0]);
        assert.deepEqual(await listAccounts(), [persisted]);
    } finally { env.restore(); }
});

test__s1('L2 AccountRegistry isolates providers and remote identities, not emails', async () => {
    const env = indexStorage({}, { seedAccounts: false });
    try {
        const a = await getOrCreateAccount('gemini', 'first', 'shared@example.com');
        const b = await getOrCreateAccount('gemini', 'second', 'shared@example.com');
        const c = await getOrCreateAccount('chatgpt', 'first', 'shared@example.com');
        assert.equal(new Set([a.id, b.id, c.id]).size, 3);
        assert.equal((await getOrCreateAccount('gemini', 'first')).id, a.id);
        assert.deepEqual((await listAccounts()).map(account => account.id).sort(), [a.id, b.id, c.id].sort());
    } finally { env.restore(); }
});

test__s1('L2 AccountRegistry updates display fields without changing identity or erasing missing fields', async () => {
    const env = indexStorage({}, { seedAccounts: false });
    try {
        const initial = await getOrCreateAccount('gemini', 'first', 'old@example.com', 'Original');
        const updated = await getOrCreateAccount('gemini', 'first', 'new@example.com');
        assert.equal(updated.id, initial.id);
        assert.equal(updated.email, 'new@example.com');
        assert.equal(updated.displayName, 'Original');
        assert.deepEqual(await getAccount(initial.id), updated);
        const unchanged = await getOrCreateAccount('gemini', 'first');
        assert.deepEqual(unchanged, updated);
        assert.deepEqual(await getAccount(initial.id), updated);
    } finally { env.restore(); }
});

test__s1('L2 promotes the sole default to verified identity in place without losing its UUID', async () => {
    const env = indexStorage({}, { seedAccounts: false });
    try {
        const fallback = await getOrCreateAccount('gemini', 'default', 'borrowed@example.com', 'Unknown');
        assert.equal(fallback.providerAccountId, 'default');
        assert.equal(Object.hasOwn(fallback, 'email'), false);
        assert.equal(Object.hasOwn(fallback, 'displayName'), false);
        const verified = await getOrCreateAccount('gemini', 'verified', 'verified@example.com');
        assert.equal(verified.id, fallback.id);
        assert.equal(verified.providerAccountId, 'verified');
        assert.equal(verified.email, 'verified@example.com');
        assert.deepEqual(await getAccount(fallback.id), verified);
        assert.deepEqual(await getOrCreateAccount('gemini', 'default', 'other@example.com'), verified);
        const otherProvider = await getOrCreateAccount('chatgpt', 'default');
        assert.notEqual(otherProvider.id, verified.id);
        assert.equal((await listAccounts()).length, 2);
    } finally { env.restore(); }
});

test__s1('L2 keeps distinct verified identities and routes unknown data to a stable real account', async () => {
    const env = indexStorage({}, { seedAccounts: false });
    try {
        const b = await getOrCreateAccount('gemini', 'gaia-b');
        const a = await getOrCreateAccount('gemini', 'gaia-a');
        assert.notEqual(a.id, b.id);
        const expected = [a, b].sort((x, y) => x.id.localeCompare(y.id))[0];
        const unknown = await Promise.all(Array.from({ length: 12 }, () => getOrCreateAccount('gemini', 'default')));
        assert.ok(unknown.every(account => account.id === expected.id));
        assert.equal((await listAccounts()).length, 2);
        assert.equal((await getOrCreateAccount('gemini', 'gaia-b')).id, b.id);
    } finally { env.restore(); }
});

test__s1('L2 serializes concurrent default and real admissions without duplicate placeholders', async () => {
    const env = indexStorage({}, { seedAccounts: false });
    try {
        await Promise.all([
            getOrCreateAccount('gemini', 'default'),
            getOrCreateAccount('gemini', 'verified'),
            getOrCreateAccount('gemini', 'default'),
            getOrCreateAccount('gemini', 'verified'),
        ]);
        const saved = (await listAccounts()).filter(account => account.providerId === 'gemini');
        assert.equal(saved.length, 1);
        assert.equal(saved[0].providerAccountId, 'verified');
    } finally { env.restore(); }
});

test__s1('L2 identity cannot be rewritten for a saved UUID; migration upsert can retain a new UUID', async () => {
    const env = indexStorage({}, { seedAccounts: false });
    try {
        const saved = await getOrCreateAccount('gemini', 'original');
        await assert.rejects(putAccount({ ...saved, providerAccountId: 'changed' }), /identity/i);
        await assert.rejects(putAccount({ ...saved, providerId: 'chatgpt' }), /identity/i);
        assert.deepEqual(await getAccount(saved.id), saved);
        const migrated = { id: '10000000-0000-4000-8000-000000000088',
            providerId: 'gemini', providerAccountId: 'migration' };
        await putAccount(migrated);
        assert.deepEqual(await getAccount(migrated.id), migrated);
    } finally { env.restore(); }
});

test__s1('L2 Account validation rejects invalid identities and preserves existing records after failed writes', async () => {
    const env = indexStorage({}, { seedAccounts: false });
    try {
        const saved = await getOrCreateAccount('gemini', 'first');
        for (const invalid of [
            { providerId: '', providerAccountId: 'id' },
            { providerId: 'gemini', providerAccountId: '' },
            { providerId: ' gemini ', providerAccountId: 'id' },
            { providerId: 'gemini', providerAccountId: 'id', email: null },
        ]) assert.throws(() => readAccountParameters(invalid), TypeError);
        assert.throws(() => readAccount({ ...saved, id: 'not-a-uuid' }), TypeError);
        assert.throws(() => readAccountRegistry([saved, saved]), /Duplicate/);
        assert.equal(findAccount([saved], 'gemini', 'other'), null);
        env.fail('accounts');
        await assert.rejects(getOrCreateAccount('gemini', 'first', 'new@example.com'), /write failed/);
        env.fail();
        assert.deepEqual(await getAccount(saved.id), saved);
        assert.equal((await getOrCreateAccount('gemini', 'first', 'new@example.com')).email, 'new@example.com');
    } finally { env.restore(); }
});
});
