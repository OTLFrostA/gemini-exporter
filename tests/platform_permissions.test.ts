import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLATFORM_HOSTS, platformOrigins, type SourcePlatform } from '../src/shared/platformHosts.js';
import { hasPlatformAccess, requestPlatformAccess } from '../src/l1/client/platformAccess.js';
import { syncPlatformContentScripts, syncAllPlatformContentScripts } from '../src/runtime/capabilities/platformInjection.js';

const platforms = Object.keys(PLATFORM_HOSTS) as SourcePlatform[];
test('manifest declares exactly the independent optional platform groups and no static source scripts', () => {
    const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
    assert.deepEqual(manifest.host_permissions ?? [], []);
    assert.deepEqual(manifest.content_scripts ?? [], []);
    const origins = platforms.flatMap(platformOrigins);
    assert.equal(new Set(origins).size, origins.length);
    assert.deepEqual([...manifest.optional_host_permissions].sort(), origins.sort());
    assert.ok(platformOrigins('chatgpt').includes('https://images.openai.com/*'));
    assert.ok(!platformOrigins('gemini').includes('https://images.openai.com/*'));
});

test('only an explicit platform grant registers its scripts; revocation preserves other groups', async () => {
    const holder = globalThis as unknown as { chrome?: unknown };
    const original = holder.chrome;
    const granted = new Set<string>();
    const scripts = new Map<string, chrome.scripting.RegisteredContentScript>();
    const requests: string[][] = [];
    let pendingGesture = false;
    holder.chrome = {
        permissions: {
            contains: async ({ origins }: { origins: string[] }) => origins.every(origin => granted.has(origin)),
            request: ({ origins }: { origins: string[] }) => {
                assert.ok(pendingGesture, 'request starts before returning from the user gesture');
                requests.push(origins);
                origins.forEach(origin => granted.add(origin));
                return Promise.resolve(true);
            },
        },
        scripting: {
            getRegisteredContentScripts: async ({ ids }: { ids: string[] }) => ids.flatMap(id => scripts.has(id) ? [scripts.get(id)!] : []),
            registerContentScripts: async (entries: chrome.scripting.RegisteredContentScript[]) => {
                for (const entry of entries) { assert.ok(!scripts.has(entry.id), 'no duplicate registration'); scripts.set(entry.id, entry); }
            },
            unregisterContentScripts: async ({ ids }: { ids: string[] }) => { ids.forEach(id => scripts.delete(id)); },
        },
    };
    try {
        await syncAllPlatformContentScripts();
        assert.equal(scripts.size, 0);
        assert.deepEqual(requests, []);
        for (const platform of platforms) {
            pendingGesture = true;
            const request = requestPlatformAccess(platform);
            pendingGesture = false;
            assert.equal(await request, true);
            assert.equal(await hasPlatformAccess(platform), true);
            assert.deepEqual(requests.at(-1), platformOrigins(platform));
            await Promise.all([syncPlatformContentScripts(platform), syncPlatformContentScripts(platform)]);
            const main = scripts.get(`${platform}-source-main`)!;
            assert.equal(main.world, 'MAIN');
            assert.deepEqual(main.matches, [...PLATFORM_HOSTS[platform].pages]);
            assert.equal(main.runAt, 'document_start');
        }
        assert.equal(scripts.size, 6);
        platformOrigins('gemini').forEach(origin => granted.delete(origin));
        await syncAllPlatformContentScripts();
        assert.deepEqual([...scripts.keys()].sort(), ['chatgpt-source-content', 'chatgpt-source-main', 'claude-source-content', 'claude-source-main']);
        assert.equal(await hasPlatformAccess('gemini'), false);
    } finally { holder.chrome = original; }
});

test('cross-context duplicate registration succeeds only when the installed descriptors match', async () => {
    const holder = globalThis as unknown as { chrome?: unknown };
    const original = holder.chrome;
    let installed: chrome.scripting.RegisteredContentScript[] = [];
    let corrupt = false;
    holder.chrome = {
        permissions: { contains: async () => true },
        scripting: {
            getRegisteredContentScripts: async () => installed,
            registerContentScripts: async (entries: chrome.scripting.RegisteredContentScript[]) => {
                installed = structuredClone(entries);
                if (corrupt) installed[0].js = ['unexpected.js'];
                throw new Error('Duplicate script ID from another context');
            },
        },
    };
    try {
        await syncPlatformContentScripts('gemini');
        assert.equal(installed.length, 2);
        installed = [];
        corrupt = true;
        await assert.rejects(syncPlatformContentScripts('gemini'), /Duplicate script ID/);
    } finally { holder.chrome = original; }
});
