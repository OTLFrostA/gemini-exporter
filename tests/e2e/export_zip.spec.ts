// Full browser integration against the v2 storage/Domain/Document/Packaging pipeline.
// L1 network parsing has separate source integration coverage; this isolates actual delivery.
import { test, expect, seedRegistryAccounts } from './fixtures';
import { openOptions, seedConversations, exposeUIStorage, accountId } from './uiFixture';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('Skip exported upgrades a text-only Workbench export to a ZIP containing its image', async ({ context, extensionId }, testInfo) => {
    const page = await openOptions(context, extensionId);
    await seedConversations(page, [{ id: 'asset-upgrade', title: 'Attachment coverage regression' }]);
    const source = await context.newPage();
    await source.route('https://gemini.google.com/**', route => route.fulfill({ contentType: 'text/html',
        body: `<!doctype html><script>window.WIZ_global_data={qDCSke:'10000000001',SNlM0e:'token',cfb2h:'build'}</script><main>Offline source fixture</main>` }));
    await source.goto('https://gemini.google.com/app/asset-upgrade');
    await expect(source.locator('#geminiExportBadge')).toBeVisible();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    await context.route('https://lh3.googleusercontent.com/fixture-image.png', route => route.fulfill({ contentType: 'image/png', body: png }));
    await page.evaluate(async accountId => {
        await Reflect.get(globalThis, 'uiFixture').ingestDetail(accountId, 'asset-upgrade', {
            savedAt: 100, quality: { status: 'complete' },
            assets: [{ id: 'image', kind: 'image', name: 'photo.png', mediaType: 'image/png', sourceUri: 'https://lh3.googleusercontent.com/fixture-image.png' }],
            messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Export my image' }] }] },
                { role: 'assistant', content: [{ type: 'image', assetId: 'image' }] }],
        }, { title: 'Attachment coverage regression', titleSource: 'provider', updatedAt: 100 });
    }, accountId);
    await page.locator('#includeAssets').uncheck();
    await page.locator('#skipExported').check();
    await page.locator('#btnSelectAll').click();
    const firstPending = page.waitForEvent('download');
    await page.locator('#btnExport').click();
    const first = await firstPending;
    expect(first.suggestedFilename()).toMatch(/\.md$/);
    await expect(page.locator('body')).toHaveAttribute('data-busy', 'false');
    await page.locator('#includeAssets').check();
    const secondPending = page.waitForEvent('download');
    await page.locator('#btnExport').click();
    const second = await secondPending;
    expect(second.suggestedFilename()).toMatch(/\.zip$/);
    const destination = testInfo.outputPath('with-assets.zip');
    await second.saveAs(destination);
    const zip = await JSZip.loadAsync(await readFile(destination));
    const images = Object.keys(zip.files).filter(name => name.endsWith('.png'));
    expect(images).toHaveLength(1);
    expect(Buffer.from(await zip.file(images[0]).async('uint8array'))).toEqual(png);
    await expect(page.locator('#status')).toContainText('Successfully downloaded: 1');
    expect(await page.evaluate(id => Reflect.get(globalThis, 'uiFixture').getExportRecord({ accountId: id, conversationId: 'asset-upgrade' }), accountId))
        .toMatchObject({ status: 'ok', includeAssets: true });
    await page.screenshot({ path: testInfo.outputPath('asset-upgrade.png'), fullPage: true });
});

const JSZip = require(path.resolve(__dirname, '../../lib/jszip.min.js'));
test.beforeEach(async ({ context }) => { await seedRegistryAccounts(context); });

test('v2 Workbench exports two Domain conversations as a real ZIP and commits separate records', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    const question = '请解释一下深度学习中的反向传播算法。';
    const answer = '反向传播（Backpropagation）是训练神经网络的核心算法，通过链式法则计算梯度。';
    await seedConversations(page, [
        { id: 'real_exp_001', title: '深度学习反向传播算法详解', question, body: answer },
        { id: 'real_exp_002', title: 'A separate conversation', body: 'A distinct answer for the archive' },
    ]);
    await page.locator('#btnSelectAll').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#btnExport').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    const zip = await JSZip.loadAsync(await readFile((await download.path())!));
    const entries: string[] = Object.keys(zip.files).filter(name => name.endsWith('.md'));
    expect(entries).toHaveLength(2);
    const contents: string[] = await Promise.all(entries.map(name => zip.file(name).async('string')));
    const joined = contents.join('\n');
    expect(joined).toContain('深度学习反向传播算法详解');
    expect(joined).toContain(question);
    expect(joined).toContain(answer);
    expect(joined).toContain('A distinct answer for the archive');
    await expect.poll(() => page.evaluate(async id => {
        const api = Reflect.get(globalThis, 'uiFixture');
        return Promise.all(['real_exp_001', 'real_exp_002'].map(conversationId =>
            api.getExportRecord({ accountId: id, conversationId }).then((value: { status?: string } | null) => value?.status)));
    }, accountId)).toEqual(['ok', 'ok']);
    await page.close();
});

for (const count of [1, 2]) test(`DOCX Workbench physically downloads ${count} conversations with matching export records`, async ({ context, extensionId }, testInfo) => {
    const page = await openOptions(context, extensionId);
    const ids = Array.from({ length: count }, (_, i) => `docx-${i + 1}`);
    await seedConversations(page, ids.map(id => ({
        id, title: `Word ${id}`, question: `中文提问 ${id}`, body: `中文回答 ${id}`,
    })));
    await page.evaluate(async ({ ids, accountId }) => {
        const api = Reflect.get(globalThis, 'uiFixture');
        for (const id of ids) await api.ingestDetail(accountId, id, {
            savedAt: 200, quality: { status: 'complete' }, assets: [], messages: [
                { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: `中文提问 ${id}` }] }] },
                { role: 'assistant', content: [
                    { type: 'paragraph', children: [{ type: 'text', text: `中文回答 ${id}` }, { type: 'inlineMath', source: 'E=mc^2' }] },
                    { type: 'math', source: String.raw`\frac{a}{b}+\sqrt{x}` },
                    { type: 'list', ordered: true, start: 3, items: [
                        { blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'Native numbered item' }] }] },
                    ] },
                ] },
            ],
        });
    }, { ids, accountId });
    await page.reload();
    await exposeUIStorage(page);
    await page.locator('#format').selectOption('docx');
    await page.locator('#btnSelectAll').click();
    const pending = page.waitForEvent('download');
    await page.locator('#btnExport').click();
    const download = await pending;
    expect(download.suggestedFilename()).toMatch(count === 1 ? /\.docx$/ : /\.zip$/);
    const destination = testInfo.outputPath(count === 1 ? 'single.docx' : 'batch.zip');
    await download.saveAs(destination);
    const outer = await JSZip.loadAsync(await readFile(destination));
    const documents = count === 1 ? [outer] : await Promise.all(Object.keys(outer.files)
        .filter(name => name.endsWith('.docx'))
        .map(async name => JSZip.loadAsync(await outer.file(name).async('uint8array'))));
    expect(documents).toHaveLength(count);
    const contents: string[] = await Promise.all(documents.map(doc => doc.file('word/document.xml').async('string')));
    for (const xml of contents) {
        expect(xml).toContain('<m:oMath>');
        expect(xml).toContain('<m:oMathPara>');
        expect(xml).toContain('<m:f>');
        expect(xml).toContain('<w:numPr>');
    }
    for (const id of ids) {
        expect(contents.some(xml => xml.includes(`中文提问 ${id}`) && xml.includes(`中文回答 ${id}`))).toBe(true);
    }
    await expect.poll(() => page.evaluate(async ({ ids, accountId }) => {
        const api = Reflect.get(globalThis, 'uiFixture');
        return Promise.all(ids.map(conversationId => api.getExportRecord({ accountId, conversationId })
            .then((record: { format: string; status: string } | null) => record && { format: record.format, status: record.status })));
    }, { ids, accountId })).toEqual(ids.map(() => ({ format: 'docx', status: 'ok' })));
    await page.close();
});
