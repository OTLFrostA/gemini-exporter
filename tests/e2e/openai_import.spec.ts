import { test, expect } from '@playwright/test';
import { mount, read, A } from '../helpers/uiPortHarness';
const chatgpt = { id: A, providerId: 'chatgpt', providerAccountId: '["user-1","workspace-1"]' };
const archive = { name: 'openai-export.zip', mimeType: 'application/zip', buffer: Buffer.from('fixture') };

test('OpenAI import requires the selected ChatGPT account and reaches its own ZIP input', async ({ page }) => {
    await mount(page, 'options');
    await expect(page.locator('#btnImportOpenAI')).toBeDisabled();
    await expect(page.locator('#openaiImportHint')).toHaveText('Select a ChatGPT account to import.');
    await mount(page, 'options', { accounts: [chatgpt] });
    await page.locator('#btnMoreActions').click();
    await expect(page.locator('#btnImportOpenAI')).toBeEnabled();
    await expect(page.locator('#btnImportTakeout')).toBeDisabled();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#btnImportOpenAI').click();
    expect((await chooser).isMultiple()).toBe(false);
    await page.locator('#openaiFileInput').setInputFiles(archive);
    await expect(page.locator('#status')).toHaveText('Imported 2 conversations; skipped 0; unavailable attachments 0.');
    expect(await read(page, 'imports')).toEqual([A]);
    expect(await read(page, 'patches')).not.toContainEqual({ takeoutPromptCompleted: true });
    await expect(page.locator('#openaiFileInput')).toHaveValue('');
});

test('empty OpenAI archive has explicit bilingual feedback and can be selected again', async ({ page }) => {
    await mount(page, 'options', { accounts: [chatgpt], openaiResult: { imported: 0, skipped: 0, missingAssets: 0, status: 'empty' } });
    await page.locator('#openaiFileInput').setInputFiles(archive);
    await expect(page.locator('#status')).toHaveText('This OpenAI ZIP contains no conversation bodies. No conversations were imported.');
    await page.locator('#langToggle').uncheck();
    await expect(page.locator('#status')).toHaveText('此 OpenAI ZIP 没有聊天正文，未导入任何会话。');
    await page.locator('#openaiFileInput').setInputFiles(archive);
    expect(await read(page, 'imports')).toEqual([A, A]);
});
