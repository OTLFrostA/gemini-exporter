import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import * as path from 'node:path';
let bundle: string;
test.beforeAll(async () => {
    const output = await build({ stdin: { contents: `
        import * as registry from './src/core/storage/accountRegistryStore.ts';
        import { openDomainDB } from './src/core/storage/domain/domainStore.ts';
        globalThis.registryProbe = { ...registry, openDomainDB };
    `, resolveDir: path.resolve(__dirname, '../..'), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife' });
    bundle = output.outputFiles[0].text;
});
test.beforeEach(async ({ page }) => {
    await page.route('https://registry.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html>Registry persistence</html>' }));
    await page.goto('https://registry.test/');
    await page.addScriptTag({ content: bundle });
});
test('aborted transaction never acknowledges creation and retry persists one account', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'registryProbe');
        const original = IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add = function (...args) {
            const request = original.apply(this, args);
            request.addEventListener('success', () => this.transaction.abort(), { once: true });
            return request;
        };
        let rejected = false;
        try { await api.acceptAccountObservation({ providerId: 'gemini', providerAccountId: 'abort-subject' }); }
        catch { rejected = true; }
        finally { IDBObjectStore.prototype.add = original; }
        const empty = await api.listAccounts();
        const saved = await api.acceptAccountObservation({ providerId: 'gemini', providerAccountId: 'abort-subject' });
        return { rejected, empty, saved };
    });
    expect(result.rejected).toBe(true);
    expect(result.empty).toEqual([]);
    expect(result.saved.resolution).toBe('created');
    await page.reload(); await page.addScriptTag({ content: bundle });
    const restored = await page.evaluate(async () => Reflect.get(globalThis, 'registryProbe').listAccounts());
    expect(restored).toEqual([result.saved.account]);
});
test('malformed disk accounts fail closed without read repair or replacement', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'registryProbe');
        const bad = { id: 'u0', providerId: 'gemini', providerAccountId: 'bad-record', slot: 'u0' };
        const db = await api.openDomainDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('accounts', 'readwrite');
            tx.objectStore('accounts').put(bad);
            tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
        });
        db.close();
        let readRejected = false, writeRejected = false;
        try { await api.listAccounts(); } catch { readRejected = true; }
        try { await api.acceptAccountObservation({ providerId: 'gemini', providerAccountId: 'new-subject' }); } catch { writeRejected = true; }
        const readDB = await api.openDomainDB();
        const raw = await new Promise(resolve => {
            const tx = readDB.transaction('accounts', 'readonly');
            const request = tx.objectStore('accounts').getAll();
            request.onsuccess = () => resolve(request.result);
        });
        readDB.close();
        return { readRejected, writeRejected, raw, bad };
    });
    expect(result.readRejected).toBe(true);
    expect(result.writeRejected).toBe(true);
    expect(result.raw).toEqual([result.bad]);
});
