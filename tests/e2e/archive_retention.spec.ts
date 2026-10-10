import { test, expect } from './fixtures';
import * as fs from 'fs';
import * as path from 'path';
const JSZip = require(path.resolve(__dirname, '../../lib/jszip.min.js'));

test('cloud-deleted local archive produces a physical ZIP with body and cached attachment; cleanup requires confirmation', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await page.evaluate(async () => {
        await chrome.storage.local.set({ gemini_schema_version: 2, gemini_tour_completed: true,
            gemini_conversations: [
                { id: 'archive_local', title: 'Retained local archive', timestamp: 1700000000000, cloudAvailability: 'deleted' },
                { id: 'metadata_only', title: 'Title without body', timestamp: 1, cloudAvailability: 'deleted' }
            ], exportedIds: { archive_local: { status: 'ok', exportedAt: 1700000000000, format: 'markdown', title: 'Retained local archive', messageCount: 2 } } });
        const native = { conversation: { providerId: 'gemini', id: 'archive_local', title: 'Retained local archive', timestamp: 1700000000000,
            assets: [{ id: 'img', kind: 'image', source: { uri: 'https://unavailable.invalid/image.png' } }],
            messages: [
                { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Preserved local question' }] }] },
                { role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Preserved local answer' }, { type: 'image', assetId: 'img' }] }], attachmentIds: ['img'] }
            ] }, resourceHints: {}, acquisitionHints: {}, diagnostics: [] };
        const saved = await chrome.runtime.sendMessage({ action: 'domainStorage', command: 'save', payload: { accountSlot: 'u0', parsed: native,
            resources: [{ assetId: 'img', bytes: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS9sAAAAASUVORK5CYII=' }] } });
        if (!saved.ok) throw new Error(saved.error);
        if (!window.__workbenchLoadStore) throw new Error('Workbench unavailable');
        await window.__workbenchLoadStore(true);
    });
    await expect(page.locator('#archiveNotice')).toContainText(/Local bodies: 1.*Metadata only: 1|本地有正文：1.*仅元数据：1/);
    await page.selectOption('#format', 'markdown');
    await page.check('#includeZip');
    await page.check('#skipExported'); // The explicit local-copy export must override skip-existing.
    const downloaded = page.waitForEvent('download');
    await page.locator('#archiveNotice button').filter({ hasText: /Keep and export|保留并导出/ }).click();
    const download = await downloaded, file = await download.path();
    expect(file).toBeTruthy();
    const zip = await JSZip.loadAsync(fs.readFileSync(file!));
    const md = Object.keys(zip.files).find(name => name.endsWith('.md') && !name.includes('index'));
    expect(md).toBeTruthy();
    const text = await zip.files[md!].async('text');
    expect(text).toContain('Preserved local question'); expect(text).toContain('Preserved local answer');
    const attachment = Object.keys(zip.files).find(name => /\.(png|jpg)$/.test(name));
    expect(attachment).toBeTruthy(); expect((await zip.files[attachment!].async('uint8array')).length).toBeGreaterThan(0);
    await expect(page.locator('#log')).toContainText(/local snapshot|本地快照/);
    await expect(page.locator('#list .item')).toHaveCount(2);
    const cleanup = page.locator('#archiveNotice button').filter({ hasText: /Clean local|清理本地/ });
    page.once('dialog', dialog => dialog.dismiss()); await cleanup.click();
    const before = await page.evaluate(async () => chrome.runtime.sendMessage({ action: 'domainStorage', command: 'get', payload: { identity: { providerId: 'gemini', accountSlot: 'u0', conversationId: 'archive_local' } } }));
    expect(before.value.conversation.messages).toHaveLength(2);
    page.once('dialog', dialog => dialog.accept()); await cleanup.click();
    await expect(page.locator('#list .item')).toHaveCount(0);
    const after = await page.evaluate(async () => ({
        record: await chrome.runtime.sendMessage({ action: 'domainStorage', command: 'get', payload: { identity: { providerId: 'gemini', accountSlot: 'u0', conversationId: 'archive_local' } } }),
        exported: (await chrome.storage.local.get('exportedIds')).exportedIds as { archive_local?: unknown }
    }));
    expect(after.record.value).toBeNull(); expect(after.exported.archive_local).toBeUndefined();
    expect(fs.readFileSync(file!).byteLength).toBeGreaterThan(0);
});
