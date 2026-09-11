import { test, expect } from './fixtures';

test.describe('Export Workflow & State Update', () => {
  test('should trigger batch export, update progress, and mark conversations as exported', async ({ context, extensionId }) => {
    // 1. Open mock Gemini page in background with valid credentials and network routing
    const geminiPage = await context.newPage();

    await geminiPage.route('https://gemini.google.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!DOCTYPE html>
        <html>
        <head>
          <script>
            window._WIZ_global_data = {
              SNlM0e: 'mock_at_token_123',
              cfb2h: 'boq_assistant-bard-web-server_20260802.09_p1'
            };
          </script>
        </head>
        <body>Gemini Mock Session Active</body>
        </html>`
      });
    });

    const turns = [
      [
        ["c_exp_chat_001"],
        "turn_id_1",
        [["请概述深度学习神经网络的实践要点。"]],
        [
          [
            ["rc_cand_1", ["深度学习神经网络实践包含数据预处理、模型架构设计、超参数调优与正则化等关键环节。"]]
          ]
        ]
      ]
    ];
    const mockDetailInner = JSON.stringify([
      turns,
      "tC_sample_token",
      "深度学习神经网络实践"
    ]);
    const mockRpcResponse = `)]}'\n\n[["wrb.fr","hNvQHb",${JSON.stringify(mockDetailInner)}]]`;

    await geminiPage.route('**/batchexecute*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: mockRpcResponse
      });
    });

    await geminiPage.goto('https://gemini.google.com/app');
    await geminiPage.waitForLoadState('domcontentloaded');

    // 2. Open Workbench Options page
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html`);
    await page.waitForLoadState('domcontentloaded');

    // Seed test conversation
    await page.evaluate(async () => {
      const mockConvs = [
        { id: 'exp_chat_001', title: '深度学习神经网络实践', timestamp: 1700000000000 }
      ];
      await chrome.storage.local.set({
        gemini_conversations: mockConvs,
        exportedIds: {}
      });
      if (typeof window.__workbenchLoadStore === 'function') {
        await window.__workbenchLoadStore(true);
      }
    });

    // Wait for item to be rendered in DOM
    const item = page.locator('[data-chat-id="exp_chat_001"]');
    await expect(item).toBeVisible();

    // 3. Select all items
    await page.click('#btnSelectAll');
    await expect(page.locator('#list input[type=checkbox]:checked')).toHaveCount(1);

    // 4. Trigger real Export through clicking #btnExport and wait for download
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.click('#btnExport');

    const download = await downloadPromise;
    expect(download).toBeTruthy();

    // 5. Verify Exported Badge is rendered on the conversation item
    await expect(item.locator('.badge')).toBeVisible();
    await expect(item.locator('.badge')).toContainText(/已导出|Exported/);

    // 6. Verify Storage contains valid export record persisted by ExportEngine
    const storageData = await page.evaluate(async () => {
      return await chrome.storage.local.get(['exportedIds']);
    }) as Record<string, any>;
    expect(storageData.exportedIds['exp_chat_001']).toBeTruthy();
    expect(storageData.exportedIds['exp_chat_001'].title).toBe('深度学习神经网络实践');
  });
});

