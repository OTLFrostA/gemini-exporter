import { test, expect } from './fixtures';

test.describe('Deep E2E: Real Gemini Scanning & Network Pagination', () => {
  test('should execute full GeminiClient scan, parse batchexecute list RPC, update progress, and populate workbench', async ({ context, extensionId }) => {
    // 1. Open mock Gemini page in the background with credentials and MaZiqc RPC routing
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
              SNlM0e: 'mock_at_token_scan',
              cfb2h: 'boq_assistant-bard-web-server_20260802.09_p1'
            };
          </script>
        </head>
        <body><button aria-label="Google Account: Scan (scan@example.com)">Scan</button>Gemini Mock Active Tab</body>
        </html>`
      });
    });

    // Mock Gemini list response (MaZiqc)
    const mockListItems = [
      ["c_scan_003", "微服务架构与分布式事务", [1700000200, 0], [1700000200, 0], 8, [1700000200, 0]],
      ["c_scan_002", "Rust 高性能异步网络编程", [1700000100, 0], [1700000100, 0], 6, [1700000100, 0]],
      ["c_scan_001", "量子计算与超导量子比特", [1700000000, 0], [1700000000, 0], 4, [1700000000, 0]]
    ];
    const requestedKinds: string[] = [];
    const pinnedItem = ['c_scan_pinned', '置顶的较早会话', null, null, null, [1600000000, 0]];
    await geminiPage.route('**/batchexecute*', async (route) => {
      const wire = new URLSearchParams(route.request().postData() || '').get('f.req');
      const args = JSON.parse(JSON.parse(wire!)[0][0][1]);
      const pinned = args[2][0] === 1;
      requestedKinds.push(pinned ? 'pinned' : 'recent');
      const inner = pinned ? JSON.stringify([null, [pinnedItem], null]) : JSON.stringify([null, mockListItems, null]);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: `)]}'\n\n[["wrb.fr","MaZiqc",${JSON.stringify(inner)}]]`
      });
    });

    await geminiPage.goto('https://gemini.google.com/app');
    await geminiPage.waitForLoadState('domcontentloaded');

    // 2. Open Workbench Options page
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await optionsPage.waitForLoadState('domcontentloaded');

    // Ensure list is initially empty
    await optionsPage.evaluate(async () => {
      await chrome.storage.local.set({
        gemini_conversations: [],
        gemini_scan_checkpoint: 9999999999999,
        exportedIds: {}
      });
      if (typeof window.__workbenchLoadStore === 'function') {
        await window.__workbenchLoadStore(true);
      }
    });

    // 3. The single sync button must scan despite an untrusted legacy checkpoint
    await optionsPage.click('#btnSyncAll');

    // 4. The pinned chat exists only in its own RPC chain.
    const listItems = optionsPage.locator('#list .item');
    await expect(listItems).toHaveCount(4, { timeout: 10000 });
    await expect(optionsPage.locator('[data-chat-id="scan_pinned"]')).toContainText('置顶的较早会话');
    await expect(optionsPage.locator('#btnSyncAll')).toBeEnabled();

    await expect(optionsPage.locator('[data-chat-id="scan_001"]')).toContainText('量子计算与超导量子比特');
    await expect(optionsPage.locator('[data-chat-id="scan_002"]')).toContainText('Rust 高性能异步网络编程');
    await expect(optionsPage.locator('[data-chat-id="scan_003"]')).toContainText('微服务架构与分布式事务');

    // 5. Verify conversations are stored in storage
    const storageData = await optionsPage.evaluate(async () => {
      return await chrome.storage.local.get(['gemini_conversations', 'gemini_scan_coverage']);
    }) as Record<string, any>;
    const convs = (storageData.gemini_conversations || []) as any[];
    expect(convs.length).toBe(4);
    expect(storageData.gemini_scan_coverage).toMatchObject({ version: 3, initialized: true, historyComplete: true, complete: true, lastStatus: 'complete',
      activeRunId: null, baseline: { conversationCount: 4, headTimestamp: 1700000200000 } });
    expect(convs.find((c: any) => c.id === 'scan_001').title).toBe('量子计算与超导量子比特');
    await expect(geminiPage.locator('#geminiExportBadgeText')).toHaveText(/Tracking 4 conversations|正在追踪 4 条对话/);
    await expect(optionsPage.locator('#btnSyncAll')).toBeEnabled();
    // Renaming an old item does not change its timestamp or move it ahead of the head.
    mockListItems[2][1] = '改名后的老会话';
    await optionsPage.click('#btnSyncAll');
    await expect(optionsPage.locator('#btnSyncAll')).toBeEnabled();
    await expect(listItems).toHaveCount(4);
    await expect(optionsPage.locator('[data-chat-id="scan_001"]')).toContainText('改名后的老会话');
    const repeated = await optionsPage.evaluate(async () => chrome.storage.local.get(['gemini_scan_coverage']));
    expect(repeated.gemini_scan_coverage).toMatchObject({ complete: true, revision: 2, activeRunId: null });
    expect(requestedKinds).toEqual(['pinned', 'recent', 'pinned', 'recent']);
  });
});

