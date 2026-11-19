import { test, expect, seedRegistryAccounts } from './fixtures';
import { readFile, copyFile } from 'node:fs/promises';
import { openOptions, seedConversations } from './uiFixture';

test('Options Markdown download preserves literal prompt separator lines', async ({ context, extensionId }, testInfo) => {
    await seedRegistryAccounts(context);
    const page = await openOptions(context, extensionId);
    await seedConversations(page, [{ id: 'literal-separators', question: 'Standalone\n\n---\n\nText above\n---\n***\n___\n- - -\nHeading\n===', body: 'Unchanged answer' }]);
    await page.locator('#btnSelectAll').click();
    const pending = page.waitForEvent('download');
    await page.locator('#btnExport').click();
    const download = await pending;
    expect(download.suggestedFilename()).toMatch(/\.md$/);
    const file = (await download.path())!;
    await copyFile(file, testInfo.outputPath('export.md'));
    const markdown = await readFile(file, 'utf8');
    expect(markdown).toContain('Standalone\n\n\\---');
    expect(markdown).toContain('Text above\n\\---');
    expect(markdown).toContain('\\*\\*\\*\n\\_\\_\\_\n\\- - -\nHeading\n\\===');
    expect(markdown).toContain('Unchanged answer');
});
