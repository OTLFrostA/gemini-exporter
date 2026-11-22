import { test, expect, seedRegistryAccounts } from './fixtures';
import { openOptions, seedConversations } from './uiFixture';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const JSZip = require(path.resolve(__dirname, '../../lib/jszip.min.js'));

test('Show reveals a selected conversation hidden by both search and export status', async ({ context, extensionId }) => {
    await seedRegistryAccounts(context);
    const page = await openOptions(context, extensionId);
    await seedConversations(page, [
        { id: 'orchard', title: 'Orchard planning' },
        { id: 'ocean', title: 'Ocean research' },
    ], { ocean: { format: 'markdown', exportedAt: 100, status: 'ok' } });
    const ocean = page.locator('[data-chat-id="ocean"] input');
    await ocean.check();

    const search = page.locator('#chatSearchInput');
    const status = page.locator('#chatFilterSelect');
    await status.selectOption('no_record');
    await expect(page.locator('#hiddenSelectionNotice')).toContainText('1 selected conversation hidden by filter');
    await expect(page.locator('#btnExport')).toBeEnabled();
    await search.fill('Orchard');
    await expect(ocean).toBeHidden();
    await expect(page.locator('#hiddenSelectionNotice')).toContainText('1 selected conversation hidden by search or filter');

    await page.locator('#btnShowHiddenSelection').click();
    await expect(ocean).toBeChecked();
    await expect(search).toHaveValue('');
    await expect(status).toHaveValue('all');
    await expect(page.locator('#hiddenSelectionNotice')).toBeHidden();

    await page.locator('[data-chat-id="orchard"] input').check();
    await status.selectOption('has_record');
    await expect(page.locator('#hiddenSelectionNotice')).toContainText('1 selected conversation hidden by filter');
    await page.locator('#btnDeselectHidden').click();
    await expect(page.locator('#hiddenSelectionNotice')).toBeHidden();
    await expect(page.locator('#selectedStat')).toHaveText('1 of 2 selected');
    await expect(status).toHaveValue('has_record');
    await expect(ocean).toBeChecked();
});

test('search preserves selection, explains hidden items and exports the full selection', async ({ context, extensionId }, testInfo) => {
    await seedRegistryAccounts(context);
    const page = await openOptions(context, extensionId);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedConversations(page, [
        { id: 'visible', title: 'Orchard planning', body: 'Visible selected conversation' },
        { id: 'hidden-one', title: 'Ocean research', body: 'Hidden selected conversation one' },
        { id: 'hidden-two', title: 'Mountain routes', body: 'Hidden selected conversation two' },
    ]);
    const notice = page.locator('#hiddenSelectionNotice');
    const search = page.locator('#chatSearchInput');
    await expect(notice).toBeHidden();
    await page.locator('#btnSelectAll').check();
    await search.fill('Orchard');
    await expect(page.locator('#list .item')).toHaveCount(1);
    await expect(page.locator('#selectedStat')).toHaveText('3 of 3 selected');
    await expect(notice).toContainText('2 selected conversations hidden by search');

    const pending = page.waitForEvent('download');
    await page.locator('#btnExport').click();
    const download = await pending;
    const destination = testInfo.outputPath('hidden-selection.zip');
    await download.saveAs(destination);
    const zip = await JSZip.loadAsync(await readFile(destination));
    const entries: string[] = Object.keys(zip.files).filter(name => name.endsWith('.md'));
    expect(entries).toHaveLength(3);
    const contents: string[] = await Promise.all(entries.map(name => zip.file(name).async('string')));
    for (const body of ['Visible selected conversation', 'Hidden selected conversation one', 'Hidden selected conversation two']) {
        expect(contents.join('\n')).toContain(body);
    }
    await expect(page.locator('#btnShowHiddenSelection')).toBeEnabled();
    await page.locator('#btnShowHiddenSelection').click();
    await expect(search).toHaveValue('');
    await expect(notice).toBeHidden();
    await expect(page.locator('#list input[type="checkbox"]:checked')).toHaveCount(3);
    await search.fill('no matches');
    await expect(notice).toContainText('3 selected conversations hidden by search');
    await search.fill('Orchard');
    await page.locator('#btnDeselectHidden').click();
    await expect(notice).toBeHidden();
    await expect(page.locator('#selectedStat')).toHaveText('1 of 3 selected');
    await expect(search).toHaveValue('Orchard');
    await search.fill('');
    await expect(page.locator('[data-chat-id="visible"] input')).toBeChecked();
    await expect(page.locator('[data-chat-id="hidden-one"] input')).not.toBeChecked();
    await expect(page.locator('[data-chat-id="hidden-two"] input')).not.toBeChecked();
    await search.fill('Ocean');
    await expect(page.locator('#hiddenSelectionText')).toHaveText('1 selected conversation hidden by search');
});
