import { test, expect } from './fixtures';

test('deleted notice stays visible during repeated list updates', async ({ context, extensionId }, testInfo) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await page.evaluate(async () => {
        await chrome.storage.local.set({ gemini_tour_completed: true, gemini_conversations: ([
            { id: 'deleted_notice', title: 'Deleted conversation', cloudAvailability: 'deleted', timestamp: 1 }
        ]).map(canonicalIndexFixture) });
        await window.__workbenchLoadStore!(true);
    });
    await expect(page.locator('#archiveNotice')).toBeVisible();
    const visibilityChanges = await page.evaluate(async () => {
        const card = document.getElementById('archiveNotice')!;
        let changes = 0;
        const observer = new MutationObserver(records => { changes += records.length; });
        observer.observe(card, { attributes: true, attributeFilter: ['hidden'] });
        for (let i = 0; i < 5; i++) await window.__workbenchLoadStore!(true);
        await Promise.resolve();
        observer.disconnect();
        return changes;
    });
    expect(visibilityChanges).toBe(0);
    await expect(page.locator('#archiveNotice button')).toHaveCount(2);
    await expect(page.locator('#archiveNotice')).toContainText(/Detected conversations deleted from the cloud|检测到有对话已从云端删除/);
    await expect(page.locator('#archiveNotice details, #archiveNotice ul')).toHaveCount(0);
    await page.locator('#archiveNotice').screenshot({ path: testInfo.outputPath('deleted-notice.png') });
});

test('keep dismisses the notice without deleting records; new deletion prompts again and cleanup excludes unlisted', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await page.evaluate(async () => {
        await chrome.storage.local.set({ gemini_tour_completed: true, gemini_conversations: ([
            { id: 'deleted_notice', title: 'Deleted conversation', cloudAvailability: 'deleted', timestamp: 1 },
            { id: 'unlisted_notice', title: 'Unconfirmed conversation', cloudAvailability: 'unlisted', timestamp: 2 },
            { id: 'another_notice', title: 'Another conversation', timestamp: 3 }
        ]).map(canonicalIndexFixture) });
        await window.__workbenchLoadStore!(true);
    });
    await page.locator('#archiveNotice button').filter({ hasText: /Keep local records|保留本地记录/ }).click();
    await expect(page.locator('#archiveNotice')).toBeHidden();
    await page.evaluate(async () => { await window.__workbenchLoadStore!(true); });
    await expect(page.locator('#archiveNotice')).toBeHidden();
    await expect(page.locator('#list .item')).toHaveCount(3);
    await page.evaluate(async () => {
        const { gemini_conversations } = await chrome.storage.local.get('gemini_conversations');
        await chrome.storage.local.set({ gemini_conversations: ((gemini_conversations as { id: string }[]).map(c =>
            c.id === 'another_notice' ? { ...c, cloudAvailability: 'deleted' } : c)).map(canonicalIndexFixture) });
        await window.__workbenchLoadStore!(true);
    });
    await expect(page.locator('#archiveNotice')).toBeVisible();
    const cleanup = page.locator('#archiveNotice button').filter({ hasText: /Delete local records|删除本地记录/ });
    page.once('dialog', dialog => dialog.dismiss());
    await cleanup.click();
    await expect(page.locator('#list .item')).toHaveCount(3);
    page.once('dialog', dialog => dialog.accept());
    await cleanup.click();
    await expect(page.locator('#list .item')).toHaveCount(1);
    await expect(page.locator('[data-chat-id="unlisted_notice"]')).toBeVisible();
    await expect(page.locator('#archiveNotice')).toBeHidden();
});

test('unlisted conversations alone do not show a deletion notice', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await page.evaluate(async () => {
        await chrome.storage.local.set({ gemini_tour_completed: true, gemini_conversations: ([
            { id: 'unlisted_notice', title: 'Unconfirmed conversation', cloudAvailability: 'unlisted', timestamp: 1 }
        ]).map(canonicalIndexFixture) });
        await window.__workbenchLoadStore!(true);
    });
    await expect(page.locator('#archiveNotice')).toBeHidden();
    await expect(page.locator('#list .item')).toHaveCount(1);
});
