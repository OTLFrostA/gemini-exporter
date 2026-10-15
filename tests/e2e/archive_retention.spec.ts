import { test, expect } from './fixtures';
import * as fs from 'fs';
import * as path from 'path';
const JSZip = require(path.resolve(__dirname, '../../lib/jszip.min.js'));
const cachedPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS9sAAAAASUVORK5CYII=';

test('cloud-deleted local archive produces a physical ZIP with body and cached attachment; cleanup requires confirmation', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await page.evaluate(async (cachedPngBase64: string) => {
        await chrome.storage.local.set({ gemini_schema_version: 2, gemini_tour_completed: true,
            gemini_conversations: ([
                { id: 'archive_local', title: 'Retained local archive', timestamp: 1700000000000, cloudAvailability: 'deleted' },
                { id: 'metadata_only', title: 'Title without body', timestamp: 1, cloudAvailability: 'deleted' }
            ]).map(canonicalIndexFixture), exportedIds: { archive_local: { status: 'ok', exportedAt: 1700000000000, format: 'markdown', title: 'Retained local archive', messageCount: 2 } } });
        const native = { sourceVersion: 1700000000000, conversation: { providerId: 'gemini', id: 'archive_local', title: 'Retained local archive', completeness: 'unknown',
            assets: [{ id: 'img', kind: 'image', sourceUri: 'https://unavailable.invalid/image.png' }],
            messages: [
                { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Preserved local question' }] }] },
                { role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Preserved local answer' }, { type: 'image', assetId: 'img' }] }], attachmentIds: ['img'] }
            ] }, resourceHints: {}, acquisitionHints: {}, diagnostics: [] };
        const saved = await chrome.runtime.sendMessage({ action: 'domainStorage', command: 'save', payload: { accountSlot: 'u0', parsed: native,
            resources: [{ assetId: 'img', bytes: cachedPngBase64 }] } });
        if (!saved.ok) throw new Error(saved.error);
        if (!window.__workbenchLoadStore) throw new Error('Workbench unavailable');
        await window.__workbenchLoadStore(true);
    }, cachedPngBase64);
    await expect(page.locator('#archiveNotice')).toContainText(/Detected conversations deleted from the cloud|检测到有对话已从云端删除/);
    await page.selectOption('#format', 'markdown');
    await page.check('#includeZip');
    await page.uncheck('#skipExported'); // Re-export the retained archive through the regular export controls.
    await page.locator('[data-chat-id="metadata_only"] input[type=checkbox]').uncheck();
    await page.locator('[data-chat-id="archive_local"] input[type=checkbox]').check();
    const downloaded = page.waitForEvent('download');
    await page.locator('#btnExport').click();
    const download = await downloaded, file = await download.path();
    expect(file).toBeTruthy();
    const zip = await JSZip.loadAsync(fs.readFileSync(file!));
    const md = Object.keys(zip.files).find(name => name.endsWith('.md') && !name.includes('index'));
    expect(md).toBeTruthy();
    const text = await zip.files[md!].async('text');
    expect(text).toContain('Preserved local question'); expect(text).toContain('Preserved local answer');
    const attachment = Object.keys(zip.files).find(name => /\.(png|jpg)$/.test(name));
    expect(attachment).toBeTruthy();
    const exportedPng = await zip.files[attachment!].async('uint8array');
    expect(Buffer.from(exportedPng).equals(Buffer.from(cachedPngBase64, 'base64'))).toBe(true);

    await expect(page.locator('#log')).toContainText(/local snapshot|本地快照/);
    await expect(page.locator('#list .item')).toHaveCount(2);
    const cleanup = page.locator('#archiveNotice button').filter({ hasText: /Delete local records|删除本地记录/ });
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
