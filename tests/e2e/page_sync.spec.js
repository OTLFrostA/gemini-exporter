const { test, expect } = require('./fixtures');

test.describe('In-Page Active Chat & Real Title Synchronization', () => {
  test('should detect active Gemini conversation and update real title in place', async ({ context, extensionId }) => {
    // 1. Seed initial conversation list with an untitled historical conversation
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.waitForLoadState('domcontentloaded');

    await optionsPage.evaluate(async () => {
      const initialConvs = [
        { id: '39d5b41870e49a67', title: '未命名对话(39d5b4)', timestamp: 1680000000000 },
        { id: 'newer_chat_999', title: '最新对话', timestamp: 1700000000000 }
      ];
      await chrome.storage.local.set({ gemini_conversations: initialConvs });
      if (typeof window.__workbenchLoadStore === 'function') {
        await window.__workbenchLoadStore(true);
      }
    });

    await expect(optionsPage.locator('#list .item')).toHaveCount(2);

    // 2. Open simulated Gemini chat page
    const geminiPage = await context.newPage();

    // Route HTML to avoid Google auth redirect during testing
    await geminiPage.route('https://gemini.google.com/app/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!DOCTYPE html>
        <html>
        <head>
          <title>量子纠缠物理原理深度解析 - Google Gemini</title>
        </head>
        <body>
          <h1 data-test-id="conversation-title">量子纠缠物理原理深度解析</h1>
          <user-query><div class="query-text">什么是量子纠缠？详细解释一下它的物理原理。</div></user-query>
        </body>
        </html>`
      });
    });

    // Mock network batchexecute response for conversation detail
    const mockDetailInner = JSON.stringify([
      [
        ["c_39d5b41870e49a67", "turn_1", [null, null, ["什么是量子纠缠？详细解释一下它的物理原理。"]]]
      ],
      "tC_token_xyz",
      "量子纠缠物理原理深度解析"
    ]);
    const mockRpcResponse = `)]}'\n\n[["wrb.fr","hNvQHb",${JSON.stringify(mockDetailInner)}]]`;

    await geminiPage.route('**/batchexecute*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: mockRpcResponse
      });
    });

    // Navigate to simulated gemini chat URL
    await geminiPage.goto('https://gemini.google.com/app/39d5b41870e49a67');
    await geminiPage.waitForLoadState('domcontentloaded');

    // Trigger in-page sync in content script
    await geminiPage.evaluate(async () => {
      window.postMessage({
        type: 'GEMINI_NETWORK_BATCHEXECUTE',
        payload: {
          text: `)]}'\n\n[["wrb.fr","hNvQHb",${JSON.stringify(JSON.stringify([
            [["c_39d5b41870e49a67", "turn_1", [null, null, ["什么是量子纠缠？详细解释一下它的物理原理。"]]]],
            "tC_token_xyz",
            "量子纠缠物理原理深度解析"
          ]))}]]`,
          slot: 'u0'
        }
      }, location.origin);
    });

    // 3. Switch back to options page and verify title updated in place without breaking order
    await optionsPage.bringToFront();
    await optionsPage.waitForTimeout(600);

    await optionsPage.evaluate(async () => {
      if (typeof window.__workbenchLoadStore === 'function') {
        await window.__workbenchLoadStore(true);
      }
    });

    const targetItem = optionsPage.locator('[data-chat-id="39d5b41870e49a67"]');
    await expect(targetItem).toBeVisible();
    await expect(targetItem).toContainText('量子纠缠物理原理深度解析');

    // Verify ordering is preserved: newer_chat_999 is still at index 0, 39d5b41870e49a67 at index 1
    const allItems = optionsPage.locator('#list .item');
    await expect(allItems.nth(0)).toContainText('最新对话');
    await expect(allItems.nth(1)).toContainText('量子纠缠物理原理深度解析');
  });
});
