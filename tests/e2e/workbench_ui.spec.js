const { test, expect } = require('./fixtures');

test.describe('Workbench UI & Selection Controls', () => {
  test('should render workbench list, handle selection controls, search, and language switch', async ({ context, extensionId }) => {
    const page = await context.newPage();

    // 1. Navigate to options page
    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html`);
    await page.waitForLoadState('domcontentloaded');

    // 2. Seed mock conversations into chrome.storage.local via page execution
    await page.evaluate(async () => {
      const mockConvs = [
        { id: 'chat_001', title: '量子计算的基本原理', timestamp: 1700000000000 },
        { id: 'chat_002', title: 'AI 架构与设计模式', timestamp: 1700000100000 },
        { id: 'chat_003', title: 'Python 性能优化指南', timestamp: 1700000200000 }
      ];
      const mockExported = {
        'chat_001': { exportedAt: '2026-08-30T00:00:00Z', title: '量子计算的基本原理' }
      };
      await chrome.storage.local.set({
        gemini_conversations: mockConvs,
        exportedIds: mockExported
      });
      if (typeof window.__workbenchLoadStore === 'function') {
        await window.__workbenchLoadStore(true);
      }
    });

    // Wait for the 3 list items to be rendered
    const listItems = page.locator('#list .item');
    await expect(listItems).toHaveCount(3);

    // 3. Test Select All
    await page.click('#btnSelectAll');
    const checkedAfterSelectAll = await page.locator('#list input[type=checkbox]:checked').count();
    expect(checkedAfterSelectAll).toBe(3);
    await expect(page.locator('#selectedStat')).toContainText('3');

    // 4. Test Select None / Deselect All
    await page.click('#btnSelectNone');
    const checkedAfterSelectNone = await page.locator('#list input[type=checkbox]:checked').count();
    expect(checkedAfterSelectNone).toBe(0);
    await expect(page.locator('#selectedStat')).toContainText('0');

    // 5. Test Only Unexported
    await page.click('#btnSelectUnexported');
    const checkedAfterUnexported = await page.locator('#list input[type=checkbox]:checked').count();
    expect(checkedAfterUnexported).toBe(2);

    // 6. Test Real-time Search Filtering
    await page.fill('#chatSearchInput', '量子');
    const visibleCount = await page.locator('#list .item').count();
    expect(visibleCount).toBe(1);
    await expect(page.locator('#list .item').first()).toContainText('量子计算的基本原理');

    // Clear search
    await page.fill('#chatSearchInput', '');
    await expect(page.locator('#list .item')).toHaveCount(3);

    // 7. Test Language Toggle Preserves Selected Items
    // Uncheck everything then check only chat_002
    await page.click('#btnSelectNone');
    await page.locator('[data-chat-id="chat_002"] input[type=checkbox]').check();
    expect(await page.locator('#list input[type=checkbox]:checked').count()).toBe(1);

    // Switch to English
    await page.click('#labelLangEn');
    await expect(page.locator('#btnSelectAll')).toHaveText('All');
    // Selection must remain exactly 1 item (chat_002)
    expect(await page.locator('#list input[type=checkbox]:checked').count()).toBe(1);
    expect(await page.locator('[data-chat-id="chat_002"] input[type=checkbox]').isChecked()).toBe(true);

    // Switch back to Chinese
    await page.click('#labelLangZh');
    await expect(page.locator('#btnSelectAll')).toHaveText('全选');
    // Selection must still remain exactly 1 item (chat_002)
    expect(await page.locator('#list input[type=checkbox]:checked').count()).toBe(1);
    expect(await page.locator('[data-chat-id="chat_002"] input[type=checkbox]').isChecked()).toBe(true);
  });
});
