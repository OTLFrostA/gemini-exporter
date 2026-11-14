import test from 'node:test';
import assert from 'node:assert/strict';
import { readClaudeSource } from '../src/l1/client/claude/claudeSource.js';
import { readClaudeFile } from '../src/l1/client/claude/fileAssets.js';
import { readGrokSource } from '../src/l1/client/grok/grokSource.js';

for (const [provider, read] of [
    ['Claude', () => readClaudeSource('/api/organizations')],
    ['Grok', () => readGrokSource('/rest/auth/get-user')],
] as const) test(`${provider} skips ID-less tabs, tries active tabs first and falls back to ID zero`, async t => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    t.after(() => {
        if (original) Object.defineProperty(globalThis, 'chrome', original);
        else Reflect.deleteProperty(globalThis, 'chrome');
    });
    const calls: number[] = [];
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
        permissions: { contains: async () => true },
        tabs: { query: async () => [{ id: 0 }, { active: true }, { id: 2, active: true }, { id: 3 }] },
        scripting: { executeScript: async ({ target }: { target: { tabId: number } }) => {
            calls.push(target.tabId);
            if (target.tabId === 2) throw new Error('Tab closed');
            return [{ result: { ok: true, value: { source: provider } } }];
        } },
    } });
    assert.deepEqual(await read(), { source: provider });
    assert.deepEqual(calls, [2, 0]);
});

test('Claude attachments accept ID zero and reject a tab list without IDs before injection', async t => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    t.after(() => {
        if (original) Object.defineProperty(globalThis, 'chrome', original);
        else Reflect.deleteProperty(globalThis, 'chrome');
    });
    let tabs: Array<{ id?: number; active?: boolean }> = [{ active: true }, { id: 0 }];
    let calls = 0;
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
        permissions: { contains: async () => true }, tabs: { query: async () => tabs },
        scripting: { executeScript: async ({ target }: { target: { tabId: number } }) => {
            calls++; assert.equal(target.tabId, 0);
            return [{ result: { status: 200, base64: 'AQI=', mediaType: 'application/octet-stream' } }];
        } },
    } });
    const id = '11111111-1111-4111-8111-111111111111';
    const result = await readClaudeFile(id, id);
    assert.deepEqual(result.bytes, new Uint8Array([1, 2]));
    tabs = [{ active: true }, { id: 9, active: true }, { id: 0 }];
    let attempt = 0;
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
        permissions: { contains: async () => true }, tabs: { query: async () => tabs },
        scripting: { executeScript: async ({ target }: { target: { tabId: number } }) => {
            calls++;
            if (++attempt === 1) {
                assert.equal(target.tabId, 9);
                throw new Error('Active tab navigated');
            }
            assert.equal(target.tabId, 0);
            return [{ result: { status: 200, base64: 'AQI=', mediaType: 'application/octet-stream' } }];
        } },
    } });
    const fallbackResult = await readClaudeFile(id, id);
    assert.deepEqual(fallbackResult.bytes, new Uint8Array([1, 2]));
    tabs = [{ active: true }];
    await assert.rejects(readClaudeFile(id, id), /Open Claude/);
    assert.equal(calls, 3);
});

test('Claude file download verifies /api/organizations membership when lastActiveOrg cookie is absent', async t => {
    const saved = ['chrome', 'document', 'fetch'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);
    t.after(() => {
        for (const [k, desc] of saved) {
            if (desc) Object.defineProperty(globalThis, k, desc);
            else Reflect.deleteProperty(globalThis, k);
        }
    });
    const orgId = '11111111-1111-4111-8111-111111111111';
    const fileId = '22222222-2222-4222-8222-222222222222';
    let memberOrgs: Array<{ uuid: string }> = [{ uuid: orgId }];
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: '' } });
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: string) => {
        if (url === '/api/organizations') return new Response(JSON.stringify(memberOrgs), { status: 200 });
        return new Response(new Uint8Array([7, 8, 9]), { status: 200, headers: { 'content-type': 'application/pdf' } });
    } });
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
        permissions: { contains: async () => true },
        tabs: { query: async () => [{ id: 1, active: true }] },
        scripting: { executeScript: async (inj: { func: (...a: string[]) => Promise<unknown>; args: string[] }) =>
            [{ result: await inj.func(...inj.args) }] },
    } });
    const ok = await readClaudeFile(orgId, fileId);
    assert.deepEqual(ok.bytes, new Uint8Array([7, 8, 9]));
    assert.equal(ok.mediaType, 'application/pdf');

    memberOrgs = [{ uuid: '33333333-3333-4333-8333-333333333333' }];
    await assert.rejects(readClaudeFile(orgId, fileId), /organization\/account changed/);
});
