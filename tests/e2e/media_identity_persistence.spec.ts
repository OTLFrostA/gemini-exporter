import { test, expect } from './fixtures';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

let bundle: string;
test.beforeAll(async () => {
    const result = await build({ stdin: { contents: `
        import * as store from './src/core/storage/domain/domainStore.ts';
        import * as fixtures from './tests/helpers/mediaSourceFixture.ts';
        import { getDomainConversationResult } from './src/core/storage/domain/nativePersistence.ts';
        import { AssetPipeline } from './src/core/engine/assetPipeline.ts';
        import { planExportResources } from './src/core/export/assets/planExportResources.ts';
        import { formatMarkdownDocument, formatHtmlDocument } from './src/core/engine/chatFormatter.ts';
        import { preparePdfItem, PdfExporter } from './src/core/export/pdf/pdfExporter.ts';
        import { resourceStage } from './src/core/export/pdf/pipeline/resourceStage.ts';
        import { encodeBytes } from './src/core/storage/domain/transport.ts';
        globalThis.mediaProbe = { ...store, ...fixtures, getDomainConversationResult, AssetPipeline,
            planExportResources, formatMarkdownDocument, formatHtmlDocument, preparePdfItem, PdfExporter, resourceStage, encodeBytes };
    `, resolveDir: path.resolve(__dirname, '../..'), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife' });
    bundle = result.outputFiles[0].text;
});
async function install(page: import('@playwright/test').Page, extensionId: string) {
    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await page.evaluate(bundle);
    await page.evaluate(async () => { await chrome.storage.local.set({ gemini_schema_version: 2, gemini_tour_completed: true }); });
}

for (const order of ['online-first', 'takeout-first'] as const) {
    test(`real extension IDB ${order}: broker import, restart, offline Markdown/HTML/PDF deliver identical image bytes`, async ({ context, extensionId }) => {
        test.setTimeout(90000);
        const page = await context.newPage();
        await install(page, extensionId);
        const before = await page.evaluate(async order => {
            const api = Reflect.get(globalThis, 'mediaProbe');
            const { online, offline, resources } = api.mediaSources();
            const importArchive = async () => {
                const response = await chrome.runtime.sendMessage({ action: 'domainStorage', command: 'save', payload: {
                    accountSlot: 'u0', parsed: offline, resources: resources.map((r: { assetId: string; bytes: Uint8Array; sourcePath: string }) => ({ ...r, bytes: api.encodeBytes(r.bytes) })) } });
                if (!response.ok) throw new Error(response.error);
            };
            if (order === 'online-first') await api.saveDomainConversation('u0', online);
            await importArchive();
            if (order === 'takeout-first') await api.saveDomainConversation('u0', online);
            await importArchive();
            return { conversation: online.conversation, image: [...api.mediaBytes] };
        }, order);
        await page.reload();
        await page.evaluate(bundle);
        await context.setOffline(true);
        const exported = await page.evaluate(async () => {
            const api = Reflect.get(globalThis, 'mediaProbe');
            const parsed = await api.getDomainConversationResult('u0', api.mediaChatId);
            const files: Record<string, number[] | string> = {};
            let downloads = 0;
            const pipeline = new api.AssetPipeline({ currentSlot: 'u0', fetchAsset: async () => {
                downloads++; throw new Error('Network is offline');
            }, writeFileDirect: async (name: string, bytes: Uint8Array) => { files[name] = [...bytes]; } });
            const plan = await api.planExportResources(parsed);
            const receipts = [];
            for (const asset of plan.assets) {
                const saved = await pipeline.processAsset(asset.item, { id: api.mediaChatId }, { isImage: true, maxRetries: 0 });
                if (!saved.saved) throw new Error(saved.failReason);
                receipts.push({ ok: true, resourceId: asset.assetId, value: { path: saved.localName } });
            }
            files['conversation.md'] = (await api.formatMarkdownDocument(plan.result, { resourceResults: receipts })).content;
            files['conversation.html'] = (await api.formatHtmlDocument(plan.result, { resourceResults: receipts })).content;
            const pdf = await api.preparePdfItem(parsed, { assetPipeline: pipeline });
            if (!pdf.ok) throw new Error(pdf.error);
            const mounted = await api.resourceStage({ document: pdf.document, resources: pdf.resources }, {
                signal: new AbortController().signal, log() {}, reportProgress() {} });
            const compiler = new api.PdfExporter();
            let delivered;
            try {
                delivered = await compiler.run({ selected: [parsed], assetPipeline: pipeline, locale: 'en', useZip: false,
                    writer: { type: 'directory', async writeFile(_name: string, bytes: Uint8Array) { files['conversation.pdf'] = [...bytes]; return 'conversation.pdf'; } } });
            } finally { compiler.dispose(); }
            const db = await api.openDomainDB();
            const disk = await new Promise<Record<string, unknown[]>>((resolve, reject) => {
                const tx = db.transaction(['conversations', 'revisions', 'resource_bytes'], 'readonly');
                const rows: Record<string, unknown[]> = {};
                for (const name of ['conversations', 'revisions', 'resource_bytes']) {
                    const get = tx.objectStore(name).getAll(); get.onsuccess = () => { rows[name] = get.result; };
                }
                tx.oncomplete = () => resolve(rows); tx.onabort = tx.onerror = () => reject(tx.error);
            }); db.close();
            return { conversation: parsed.conversation, downloads, files, receipts, delivered,
                mounts: mounted.output.mounts.map((mount: { bytes: Uint8Array }) => [...mount.bytes]), disk };
        });
        expect(exported.conversation).toEqual(before.conversation);
        expect(exported.conversation.messages).toHaveLength(20);
        expect(exported.downloads).toBe(0);
        expect(exported.disk.conversations).toHaveLength(1);
        expect(exported.disk.revisions).toHaveLength(2);
        expect(exported.delivered.succeeded).toBe(1);
        expect(exported.delivered.failed).toEqual([]);
        const assetPath = exported.receipts[0].value.path;
        expect(exported.files['conversation.md']).toContain(assetPath);
        expect(exported.files['conversation.html']).toContain(assetPath);
        expect(exported.mounts).toEqual([before.image]);
        const output = path.resolve('tests/output/media_identity', order);
        mkdirSync(output, { recursive: true });
        for (const [name, content] of Object.entries(exported.files)) {
            const target = path.join(output, name); mkdirSync(path.dirname(target), { recursive: true });
            writeFileSync(target, typeof content === 'string' ? content : Uint8Array.from(content as number[]));
        }
        const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
        expect(hash(readFileSync(path.join(output, assetPath)))).toBe(hash(Uint8Array.from(before.image)));
        expect(readFileSync(path.join(output, 'conversation.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
        writeFileSync(path.join(output, 'audit.json'), JSON.stringify({ imageSha256: hash(Uint8Array.from(before.image)),
            imagePath: assetPath, downloads: exported.downloads, messages: exported.conversation.messages.length }, null, 2));
    });
}

for (const broker of [false, true]) {
    test(`real extension IDB aborted ${broker ? 'broker' : 'direct'} import rolls back current, revision and byte cache`, async ({ context, extensionId }) => {
        const page = await context.newPage(); await install(page, extensionId);
        const original = await page.evaluate(async () => {
            const api = Reflect.get(globalThis, 'mediaProbe'); const { offline, resources } = api.mediaSources();
            await api.saveDomainConversation('u0', offline, resources);
            return { conversation: offline.conversation, bytes: [...resources.find((r: { assetId: string }) => r.assetId === offline.conversation.assets[0].id).bytes] };
        });
        const worker = context.serviceWorkers()[0];
        const intercept = () => {
            const original = IDBObjectStore.prototype.put;
            Reflect.set(globalThis, '__originalMediaPut', original);
            IDBObjectStore.prototype.put = function (...args) {
                const request = original.apply(this, args);
                if (this.name === 'resource_bytes') { const tx = this.transaction; queueMicrotask(() => tx.abort()); }
                return request;
            };
        };
        if (broker) await worker.evaluate(intercept); else await page.evaluate(intercept);
        const error = await page.evaluate(async broker => {
            const api = Reflect.get(globalThis, 'mediaProbe'); const { online } = api.mediaSources();
            try {
                if (broker) {
                    const response = await chrome.runtime.sendMessage({ action: 'domainStorage', command: 'save', payload: {
                        accountSlot: 'u0', parsed: online, resources: [] } });
                    return response.ok ? '' : response.error;
                }
                await api.saveDomainConversation('u0', online); return '';
            } catch (e) { return String(e); }
        }, broker);
        const restore = () => { IDBObjectStore.prototype.put = Reflect.get(globalThis, '__originalMediaPut'); };
        if (broker) await worker.evaluate(restore); else await page.evaluate(restore);
        expect(error).toMatch(/transaction (aborted|failed)/);
        await page.reload(); await page.evaluate(bundle);
        const restored = await page.evaluate(async () => {
            const api = Reflect.get(globalThis, 'mediaProbe'); const identity = api.storageIdentity('gemini', 'u0', api.mediaChatId);
            const view = await api.getStoredDomain(identity);
            const db = await api.openDomainDB();
            const counts = await new Promise<Record<string, number>>((resolve, reject) => {
                const tx = db.transaction(['conversations', 'revisions', 'resource_bytes'], 'readonly'); const count: Record<string, number> = {};
                for (const name of ['conversations', 'revisions', 'resource_bytes']) {
                    const get = tx.objectStore(name).count(); get.onsuccess = () => { count[name] = get.result; };
                }
                tx.oncomplete = () => resolve(count); tx.onabort = tx.onerror = () => reject(tx.error);
            }); db.close();
            return { counts, body: view.conversation, bytes: await api.getDomainResource(identity, view.conversation.assets[0].id) };
        });
        expect(restored.counts).toEqual({ conversations: 1, revisions: 1, resource_bytes: 2 });
        expect(restored.body).toEqual(original.conversation);
        expect(restored.body.messages).toHaveLength(12);
        expect(restored.bytes).toEqual(Uint8Array.from(original.bytes));
    });
}

test('real extension IDB rejects ambiguity and stale cache writes, isolates accounts and cleans rebound bytes', async ({ context, extensionId }) => {
    const page = await context.newPage(); await install(page, extensionId);
    const result = await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'mediaProbe'); const { online, offline, resources } = api.mediaSources();
        await api.saveDomainConversation('u0', online);
        const ambiguous = api.mediaSources({ duplicate: true });
        await api.saveDomainConversation('u0', ambiguous.offline, ambiguous.resources);
        const identity = api.storageIdentity('gemini', 'u0', api.mediaChatId);
        const unknown = await api.getDomainResource(identity, online.conversation.assets[0].id);
        await api.saveDomainConversation('u1', online);
        await api.saveDomainConversation('u0', offline, resources);
        const other = await api.getDomainResource(api.storageIdentity('gemini', 'u1', api.mediaChatId), online.conversation.assets[0].id);
        await api.cacheDomainResource(identity, online.conversation.assets[0].id, 'https://invalid.test/stale', new Uint8Array([9]));
        const correct = await api.getDomainResource(identity, online.conversation.assets[0].id);
        await api.removeStoredDomain(identity);
        await api.saveDomainConversation('u0', online);
        return { unknown, other, correct: [...correct], after: await api.getDomainResource(identity, online.conversation.assets[0].id) };
    });
    expect(result.unknown).toBeNull(); expect(result.other).toBeNull(); expect(result.after).toBeNull();
    expect(result.correct).toHaveLength(68);
});
