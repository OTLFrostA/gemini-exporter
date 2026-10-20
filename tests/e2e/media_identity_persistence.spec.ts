import { test, expect, seedRegistryAccounts } from './fixtures';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

test.beforeEach(async ({ context, extensionId }) => {
    void extensionId;
    await seedRegistryAccounts(context);
});

let bundle: string;
test.beforeAll(async () => {
    const result = await build({ stdin: { contents: `
        import * as store from './src/l3a/domain/domainStore.ts';
        import { admitFixture, readFixture, removeFixture } from './tests/helpers/admitFixture.ts';
        import * as resources from './src/l3a/domain/resourceContext.ts';
        import * as fixtures from './tests/helpers/mediaSourceFixture.ts';
        import { bindFixture } from './tests/helpers/domainFixture.ts';
        import { ingestIndexes } from './src/l2/ingestion.ts';
        import { getDomainConversationResult } from './src/l3a/domain/nativePersistence.ts';
        import { AssetPipeline } from './src/core/engine/assetPipeline.ts';
        import { planExportResources } from './src/l4/format/resources/planExportResources.ts';
        import { formatMarkdownDocument, formatHtmlDocument } from './src/core/engine/chatFormatter.ts';
        import { preparePdfItem, PdfExporter } from './src/l4/format/pdf/pdfExporter.ts';
        import { resourceStage } from './src/l4/format/pdf/pipeline/resourceStage.ts';
        import { encodeBytes } from './src/l3a/domain/transport.ts';
        globalThis.mediaProbe = { ...store, ...resources, admitFixture, readFixture, removeFixture, ...fixtures, bindFixture, ingestIndexes, getDomainConversationResult, AssetPipeline,
            planExportResources, formatMarkdownDocument, formatHtmlDocument, preparePdfItem, PdfExporter, resourceStage, encodeBytes };
    `, resolveDir: path.resolve(__dirname, '../..'), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife' });
    bundle = result.outputFiles[0].text;
});
async function install(page: import('@playwright/test').Page, extensionId: string) {
    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await page.evaluate(bundle);
    await page.evaluate(async () => { await chrome.storage.local.set({ gemini_schema_version: 3, gemini_tour_completed: true }); });
}

for (const order of ['online-first', 'takeout-first'] as const) {
    test(`real extension IDB ${order}: source admission, offline Markdown/HTML/PDF deliver identical image bytes`, async ({ context, extensionId }) => {
        test.setTimeout(90000);
        const page = await context.newPage();
        await install(page, extensionId);
        const before = await page.evaluate(async order => {
            const api = Reflect.get(globalThis, 'mediaProbe');
            const { online, offline, resources } = api.mediaSources();
            const importArchive = () => api.admitFixture(offline.account.id, offline, resources);
            if (order === 'online-first') await api.admitFixture('10000000-0000-4000-8000-000000000001', online);
            await importArchive();
            if (order === 'takeout-first') await api.admitFixture('10000000-0000-4000-8000-000000000001', online);
            await importArchive();
            // Raw body transactions are audited above; commit source Index before an Application consumer reads it.
            const { key, ...fields } = online.conversation.index;
            await api.ingestIndexes(online.account.id, [{ conversationId: key.conversationId, fields }]);
            return { conversation: online.conversation, image: [...api.mediaBytes] };
        }, order);
        await context.setOffline(true);
        const exported = await page.evaluate(async () => {
            const api = Reflect.get(globalThis, 'mediaProbe');
            const parsed = await api.getDomainConversationResult('10000000-0000-4000-8000-000000000001', api.mediaChatId);
            const files: Record<string, number[] | string> = {};
            let downloads = 0;
            const pipeline = new api.AssetPipeline({ accountId: '10000000-0000-4000-8000-000000000001', fetchAsset: async () => {
                downloads++; throw new Error('Network is offline');
            }, writeFileDirect: async (name: string, bytes: Uint8Array) => { files[name] = [...bytes]; } });
            const plan = await api.planExportResources(parsed);
            const receipts = [];
            for (const asset of plan.assets) {
                const saved = await pipeline.processAsset(asset.item, { id: api.mediaChatId }, { isImage: true, maxRetries: 0 });
                if (!saved.ok) throw new Error(saved.reason);
                receipts.push(saved);
            }
            files['conversation.md'] = (await api.formatMarkdownDocument(plan.result, { resourceResults: receipts })).content;
            files['conversation.html'] = (await api.formatHtmlDocument(plan.result, { resourceResults: receipts })).content;
            const pdf = await api.preparePdfItem(parsed, { accountId: '10000000-0000-4000-8000-000000000001', assetPipeline: pipeline });
            if (!pdf.ok) throw new Error(pdf.error);
            const mounted = await api.resourceStage({ document: pdf.document, resources: pdf.resources }, {
                signal: new AbortController().signal, log() {}, reportProgress() {} });
            const compiler = new api.PdfExporter();
            let delivered;
            try {
                delivered = await compiler.run({ accountId: '10000000-0000-4000-8000-000000000001', selected: [parsed], assetPipeline: pipeline, locale: 'en', useZip: false,
                    writer: { type: 'directory', async writeFile(_name: string, bytes: Uint8Array) { files['conversation.pdf'] = [...bytes]; return 'conversation.pdf'; } } });
            } finally { compiler.dispose(); }
            const db = await api.openDomainDB();
            const disk = await new Promise<Record<string, unknown[]>>((resolve, reject) => {
                const tx = db.transaction(['details'], 'readonly');
                const rows: Record<string, unknown[]> = {};
                for (const name of ['details']) {
                    const get = tx.objectStore(name).getAll(); get.onsuccess = () => { rows[name] = get.result; };
                }
                tx.oncomplete = () => resolve(rows); tx.onabort = tx.onerror = () => reject(tx.error);
            }); db.close();
            return { conversation: parsed.conversation, downloads, files, receipts, delivered,
                mounts: mounted.output.mounts.map((mount: { bytes: Uint8Array }) => [...mount.bytes]), disk };
        });
        expect(exported.conversation.detail).toEqual(before.conversation.detail);
        expect(exported.conversation.index).toMatchObject({ ...before.conversation.index, updatedAt: 1788350400000 });
        expect(exported.conversation.detail.messages).toHaveLength(20);
        expect(exported.downloads).toBe(0);
        expect(exported.disk.details).toHaveLength(1);
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
            imagePath: assetPath, downloads: exported.downloads, messages: exported.conversation.detail.messages.length }, null, 2));
    });
}

test('real extension IDB rejects ambiguity and stale cache writes, isolates accounts and cleans rebound bytes', async ({ context, extensionId }) => {
    const page = await context.newPage(); await install(page, extensionId);
    const result = await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'mediaProbe'); const { online, offline, resources } = api.mediaSources();
        await api.admitFixture('10000000-0000-4000-8000-000000000001', online);
        const ambiguous = api.mediaSources({ duplicate: true });
        await api.admitFixture('10000000-0000-4000-8000-000000000001', ambiguous.offline, ambiguous.resources);
        const identity = api.storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', api.mediaChatId);
        const unknown = await api.getDomainResource(identity, online.conversation.detail.assets[0].id);
        await api.admitFixture('10000000-0000-4000-8000-000000000002', api.bindFixture(online, '10000000-0000-4000-8000-000000000002'));
        await api.admitFixture('10000000-0000-4000-8000-000000000001', offline, resources);
        const other = await api.getDomainResource(api.storageIdentity('gemini', '10000000-0000-4000-8000-000000000002', api.mediaChatId), online.conversation.detail.assets[0].id);
        await api.cacheDomainResource(identity, online.conversation.detail.assets[0].id, 'https://invalid.test/stale', new Uint8Array([9]));
        const correct = await api.getDomainResource(identity, online.conversation.detail.assets[0].id);
        await api.removeFixture(identity);
        await api.admitFixture('10000000-0000-4000-8000-000000000001', online);
        return { unknown, other, correct: [...correct], after: await api.getDomainResource(identity, online.conversation.detail.assets[0].id) };
    });
    expect(result.unknown).toBeNull(); expect(result.other).toBeNull(); expect(result.after).toBeNull();
    expect(result.correct).toHaveLength(68);
});
