import { test, expect, seedRegistryAccounts } from './fixtures';
import { openOptions, accountId } from './uiFixture';

test.beforeEach(async ({context, extensionId}) => {
    void extensionId;
    await seedRegistryAccounts(context);
});

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
            window.WIZ_global_data = {
              qDCSke: '10000000001', SNlM0e: 'mock_at_token_scan',
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
    await context.route('**/batchexecute*', async (route) => {
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

    const optionsPage = await openOptions(context,extensionId);
    await expect(optionsPage.locator('#list .item')).toHaveCount(0);
    // 3. The single sync button scans the Recent stream.
    await optionsPage.click('#btnSyncAll');

    // 4. Ordinary Scan All admits Recent; the separate pinned item stays absent.
    const listItems = optionsPage.locator('#list .item');
    await expect(listItems).toHaveCount(3, { timeout: 10000 });
    await expect(optionsPage.locator('[data-chat-id="scan_pinned"]')).toHaveCount(0);
    await expect(optionsPage.locator('#btnSyncAll')).toBeEnabled();

    await expect(optionsPage.locator('[data-chat-id="scan_001"]')).toContainText('量子计算与超导量子比特');
    await expect(optionsPage.locator('[data-chat-id="scan_002"]')).toContainText('Rust 高性能异步网络编程');
    await expect(optionsPage.locator('[data-chat-id="scan_003"]')).toContainText('微服务架构与分布式事务');

    const storageData = await optionsPage.evaluate(async accountId => {
      const api = Reflect.get(globalThis,'uiFixture');
      return { indexes: await api.listIndexes(accountId), coverage: await api.getCoverage(accountId,'recent') };
    },accountId);
    expect(storageData.indexes).toHaveLength(3);
    expect(storageData.coverage.range.head.time).toBe(1700000200000);
    const oldChat = storageData.indexes.find((c: {key:{conversationId:string}})=>c.key.conversationId==='scan_001');
    expect(oldChat.title).toBe('量子计算与超导量子比特');expect(oldChat.updatedAt).toBe(1700000000000);
    // Badge reads local count on source attachment/passive commits; Options owns no new broadcast channel.
    await geminiPage.reload();
    await expect(geminiPage.locator('#geminiExportBadge')).toContainText('3');
    // Renaming an old item does not change its timestamp or move it ahead of the head.
    mockListItems[2][1] = '改名后的老会话';
    await optionsPage.click('#btnSyncAll');
    await expect(optionsPage.locator('#btnSyncAll')).toBeEnabled();
    await expect(listItems).toHaveCount(3);
    await expect(optionsPage.locator('[data-chat-id="scan_001"]')).toContainText('改名后的老会话');
    const repeated = await optionsPage.evaluate(async accountId => {
      const api = Reflect.get(globalThis,'uiFixture');
      return { indexes: await api.listIndexes(accountId), coverage: await api.getCoverage(accountId,'recent') };
    },accountId);
    expect(repeated.coverage.range.head.time).toBe(1700000200000);
    expect(repeated.indexes.find((c: {key:{conversationId:string}})=>c.key.conversationId==='scan_001').updatedAt).toBe(oldChat.updatedAt);
    expect(requestedKinds).toEqual(['recent', 'recent']);
  });
});

