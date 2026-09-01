const { test, expect } = require('./fixtures');

test.describe('E2E: Export Title Update & Session Interruption Recovery', () => {
  test('should update chat title in storage & workbench during export, and restore session banner on reload', async ({ context, extensionId }) => {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.waitForLoadState('domcontentloaded');

    // 1. Pre-populate initial Takeout imported chat
    await optionsPage.evaluate(async () => {
      const initialConvs = [
        {
          id: 'chat_session_test_1',
          title: 'Takeout Prompt 临时问题',
          titleSource: 'takeout',
          titles: { takeout: 'Takeout Prompt 临时问题' },
          timestamp: 1680000000000
        },
        {
          id: 'chat_session_test_2',
          title: '未导出第二个问题',
          titleSource: 'legacy',
          titles: { legacy: '未导出第二个问题' },
          timestamp: 1680000050000
        }
      ];
      await chrome.storage.local.set({
        gemini_conversations: initialConvs,
        exportedIds: {}
      });
      if (typeof window.__workbenchLoadStore === 'function') {
        await window.__workbenchLoadStore(true);
      }
    });

    const targetItem = optionsPage.locator('[data-chat-id="chat_session_test_1"]');
    await expect(targetItem).toContainText('Takeout Prompt 临时问题');

    // 2. Simulate export session in storage (interrupted state)
    await optionsPage.evaluate(async () => {
      await chrome.storage.local.set({
        gemini_last_export_session: {
          status: 'interrupted',
          slot: 'u0',
          total: 2,
          current: 1,
          lastChatId: 'chat_session_test_1',
          lastChatTitle: '深度学习架构与微调实战',
          updatedAt: Date.now()
        }
      });
    });

    // 3. Reload options workbench (user refreshed the page)
    await optionsPage.reload();
    await optionsPage.waitForLoadState('domcontentloaded');

    // 4. Verify Export Session Recovery Banner is rendered
    const banner = optionsPage.locator('#exportSessionBanner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('发现未完成的导出任务');
    await expect(banner).toContainText('共 2 条');
    await expect(banner).toContainText('已处理 1 条');
    await expect(banner).toContainText('剩余 1 条未导出');
    await expect(banner).toContainText('深度学习架构与微调实战');

    const btnResume = optionsPage.locator('#btnResumeExport');
    await expect(btnResume).toBeVisible();

    // 5. Verify dismissing banner
    const btnDismiss = optionsPage.locator('#btnDismissExportBanner');
    await btnDismiss.click();
    await expect(banner).not.toBeVisible();

    const sessionData = await optionsPage.evaluate(async () => {
      return await chrome.storage.local.get(['gemini_last_export_session']);
    });
    expect(sessionData.gemini_last_export_session).toBeUndefined();
  });
});
