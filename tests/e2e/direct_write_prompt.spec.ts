import { test, expect, seedRegistryAccounts } from './fixtures';

test.beforeEach(async ({context, extensionId}) => {
    void extensionId;
    await seedRegistryAccounts(context);
});

test.describe('E2E: Direct Write Suggestion Prompt for Large Bulk Exports', () => {
  test('should show suggestion modal only once when exporting > 20 conversations and never prompt again', async ({ context, extensionId }) => {
    const page = await context.newPage();

    // 1. Navigate to options page
    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await page.waitForLoadState('domcontentloaded');

    // 2. Seed 55 mock conversations into chrome.storage.local
    await page.evaluate(async () => {
      const mockConvs = [];
      for (let i = 1; i <= 55; i++) {
        mockConvs.push({
          id: `chat_bulk_${String(i).padStart(3, '0')}`,
          title: `大批量测试会话 ${i}`,
          timestamp: 1700000000000 + i * 1000
        });
      }
      await chrome.storage.local.set({
        ['conversations_10000000-0000-4000-8000-000000000001']: (mockConvs).map(canonicalIndexFixture),
        ['exported_10000000-0000-4000-8000-000000000001']: {},
        gemini_suppress_direct_write_prompt: false,
        has_completed_tour: true,
        last_seen_feature_version: '999.0.0'
      });
      if (typeof window.__workbenchLoadStore === 'function') {
        await window.__workbenchLoadStore(true);
      }
    });

    // Verify 55 items rendered
    const listItems = page.locator('#list .item');
    await expect(listItems).toHaveCount(55);

    // 3. Select all items (55 items > 20 threshold)
    await page.click('#btnSelectAll');
    await expect(page.locator('#selectedStat')).toHaveText(/\b55\b/);

    // Ensure modal is initially hidden
    const modal = page.locator('#directWriteModal');
    await expect(modal).toBeHidden();

    // 4. Click Export button (in ZIP mode)
    await page.click('#btnExport');

    // 5. Verify modal appears with correct conversation count and buttons
    await expect(modal).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#directWritePromptText')).toHaveText(/\b55\b/);
    await expect(page.locator('#btnModalSwitchFolder')).toBeVisible();
    await expect(page.locator('#btnModalContinueZip')).toBeVisible();

    // 6. Click "Continue with ZIP"
    await page.click('#btnModalContinueZip');

    // Modal should close immediately
    await expect(modal).toBeHidden();

    // 7. Verify suppression flag is automatically persisted in storage
    const isSuppressed = await page.evaluate(async () => {
      const d = await chrome.storage.local.get('gemini_suppress_direct_write_prompt');
      return !!d.gemini_suppress_direct_write_prompt;
    });
    expect(isSuppressed).toBe(true);

    // Wait for first export to settle before triggering second export
    await expect(page.locator('#btnCancel')).toBeHidden({ timeout: 10000 });

    // 8. A new options-page instance must honor the persisted suppression setting.
    // Staying on the same page could hide a broken storage-read path behind in-memory state.
    await page.reload();
    await expect(page.locator('#list .item')).toHaveCount(55);
    await page.click('#btnSelectAll');
    await expect(page.locator('#selectedStat')).toHaveText(/\b55\b/);
    expect(await page.evaluate(async () =>
      (await chrome.storage.local.get('gemini_suppress_direct_write_prompt')).gemini_suppress_direct_write_prompt
    )).toBe(true);

    // The next bulk export proceeds without offering the ZIP/folder choice again.
    await page.click('#btnExport');
    await expect(modal).toBeHidden();
  });
});
