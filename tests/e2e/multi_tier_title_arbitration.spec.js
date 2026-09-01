const { test, expect } = require('./fixtures');

test.describe('E2E: Multi-Tier Non-Destructive Title Storage & Priority Arbitration', () => {
  test('should arbitrate titles strictly by source tier and never allow low tier to corrupt high tier', async ({ context, extensionId }) => {
    // 1. Open options workbench and seed with Takeout imported chat
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.waitForLoadState('domcontentloaded');

    await optionsPage.evaluate(async () => {
      const initialConvs = [
        {
          id: 'arbitration_chat_999',
          title: 'Takeout Prompt 原始提问',
          titleSource: 'takeout',
          titles: { takeout: 'Takeout Prompt 原始提问' },
          timestamp: 1670000000000
        }
      ];
      await chrome.storage.local.set({ gemini_conversations: initialConvs, exportedIds: {} });
      if (typeof window.__workbenchLoadStore === 'function') {
        await window.__workbenchLoadStore(true);
      }
    });

    const targetItem = optionsPage.locator('[data-chat-id="arbitration_chat_999"]');
    await expect(targetItem).toContainText('Takeout Prompt 原始提问');

    // 2. Open page in intermediate loading state with <title>Google Gemini</title>
    const geminiPage = await context.newPage();
    await geminiPage.route('https://gemini.google.com/app/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<!DOCTYPE html>
        <html>
        <head>
          <title>Google Gemini</title>
        </head>
        <body>
          <div class="loading-state">Loading conversation...</div>
        </body>
        </html>`
      });
    });

    await geminiPage.goto('https://gemini.google.com/app/arbitration_chat_999');
    await geminiPage.waitForLoadState('domcontentloaded');
    await geminiPage.waitForTimeout(600); // Allow content.js syncOnce to run

    // Verify workbench title did NOT become "Google Gemini" and remained Takeout prompt
    await optionsPage.bringToFront();
    await optionsPage.evaluate(async () => {
      if (typeof window.__workbenchLoadStore === 'function') {
        await window.__workbenchLoadStore(true);
      }
    });
    await expect(targetItem).toContainText('Takeout Prompt 原始提问');
    await expect(targetItem).not.toContainText('Google Gemini');

    // 3. Simulate DOM header rendered (Tier: dom)
    await geminiPage.bringToFront();
    await geminiPage.evaluate(() => {
      const h1 = document.createElement('h1');
      h1.setAttribute('data-test-id', 'conversation-title');
      h1.textContent = '页面显式渲染的DOM标题';
      document.body.appendChild(h1);
    });

    // Trigger sync
    await geminiPage.evaluate(async () => {
      if (typeof window.__geminiExporterSyncOnce === 'function') {
        await window.__geminiExporterSyncOnce();
      }
    });

    // 4. Simulate authoritative RPC arriving (Tier: rpc)
    await geminiPage.evaluate(async () => {
      window.postMessage({
        type: 'GEMINI_NETWORK_BATCHEXECUTE',
        payload: {
          text: `)]}'\n\n[["wrb.fr","hNvQHb",${JSON.stringify(JSON.stringify([
            [["c_arbitration_chat_999", "turn_1", [null, null, ["提问内容"]]]],
            "tC_token_abc",
            "官方服务端RPC最终权威标题"
          ]))}]]`,
          slot: 'u0'
        }
      }, location.origin);
    });

    await geminiPage.waitForTimeout(600);

    // 5. Verify final resolved state in storage and options page
    const storageData = await optionsPage.evaluate(async () => {
      return await chrome.storage.local.get(['gemini_conversations']);
    });
    const chat = storageData.gemini_conversations.find(c => c.id === 'arbitration_chat_999');
    expect(chat).toBeTruthy();
    expect(chat.titles.takeout).toBe('Takeout Prompt 原始提问');
    expect(chat.titles.rpc).toBe('官方服务端RPC最终权威标题');
    expect(chat.title).toBe('官方服务端RPC最终权威标题');
    expect(chat.titleSource).toBe('rpc');

    await optionsPage.bringToFront();
    await optionsPage.evaluate(async () => {
      if (typeof window.__workbenchLoadStore === 'function') {
        await window.__workbenchLoadStore(true);
      }
    });
    await expect(targetItem).toContainText('官方服务端RPC最终权威标题');
  });
});
