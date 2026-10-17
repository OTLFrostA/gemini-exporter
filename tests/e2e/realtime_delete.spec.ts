import { test, expect, seedRegistryAccounts } from './fixtures';

test.beforeEach(async ({context, extensionId}) => {
    void extensionId;
    await seedRegistryAccounts(context);
});

test.describe('Real-Time Cloud Deletion & Local Archive Retention', () => {
  test('should mark confirmed cloud deletion and retain local body and export records in real time', async ({ context, extensionId }) => {
    // 1. 打开扩展 Options 工作台页面并预置 3 条会话
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await optionsPage.waitForLoadState('domcontentloaded');

    const targetId = '8888abcd1234ef01';
    const initialConversations = [
      { id: targetId, title: '待实时删除的目标会话', timestamp: 1700000000000, source: 'batchexecute' },
      { id: 'keep_chat_1111', title: '保持留存的有效会话 1', timestamp: 1699990000000, source: 'batchexecute' },
      { id: 'keep_chat_2222', title: '保持留存的有效会话 2', timestamp: 1699980000000, source: 'batchexecute' }
    ];

    await optionsPage.evaluate(async (convs) => {
      await chrome.storage.local.set({
        ['conversations_10000000-0000-4000-8000-000000000001']: (convs).map(canonicalIndexFixture),
        ['last_count_10000000-0000-4000-8000-000000000001']: convs.length,
        ['exported_10000000-0000-4000-8000-000000000001']: { [convs[0].id]: { status: 'ok', exportedAt: 1700000000000 } }
      });
      const saved = await chrome.runtime.sendMessage({ action: 'domainStorage', command: 'save', payload: { accountId: '10000000-0000-4000-8000-000000000001', parsed: { account: fixtureAccount(),
        sourceVersion: 1700000000000, conversation: { index: { key: fixtureKey(String(convs[0].id), 'gemini'),   titleSource: "derived",   title: convs[0].title }, detail: { key: fixtureKey(String(convs[0].id), 'gemini'), quality: { status: 'unknown' }, assets: [], messages: [{ role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Durable archived body' }] }] }] } },
        acquisitionHints: {}, resourceHints: {}, diagnostics: []
      } } });
      if (!saved.ok) throw new Error(saved.error);
      if (typeof (window as any).__workbenchLoadStore === 'function') {
        await (window as any).__workbenchLoadStore(true);
      }
    }, initialConversations);

    // 验证初始状态：DOM 列表中有 3 条，且目标待删会话清晰可见
    await expect(optionsPage.locator('#list .item')).toHaveCount(3);
    await expect(optionsPage.locator(`#list .item[data-chat-id="${targetId}"]`)).toBeVisible();
    await expect(optionsPage.locator('#list .item[data-chat-id="keep_chat_1111"]')).toBeVisible();

    // 2. 打开模拟的 Gemini 标签页，并提供触发真实删除网络 RPC 的交互按钮
    const geminiPage = await context.newPage();

    await geminiPage.route('https://gemini.google.com/app/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<!DOCTYPE html>
        <html>
        <head><title>Gemini Live Chat</title><script>window._WIZ_global_data={qDCSke:'10000000001'};</script></head>
        <body>
          <div id="app">Gemini Mock Chat Window</div>
          
        </body>
        </html>`
      });
    });

    await geminiPage.route('**/batchexecute*', async (route) => {
      const detailCheck = route.request().url().includes('rpcids=hNvQHb');
      await route.fulfill({
        status: detailCheck ? 404 : 200,
        contentType: 'application/json',
        body: detailCheck
          ? '["BardErrorInfo", 1167]'
          : `)]}'\n\n[["wrb.fr","GzXR5e","[null, \\"c_8888abcd1234ef01\\"]"]]`
      });
    });

    await geminiPage.goto('https://gemini.google.com/app/c_8888abcd1234ef01');
    await geminiPage.waitForLoadState('domcontentloaded');

    // 3. 在 Gemini 页面中调用 fetch 请求删除 RPC，由 hookCredentials MAIN world 真实拦截
    await geminiPage.evaluate(async () => {
      await fetch('/_/BardChatUi/data/batchexecute?rpcids=GzXR5e', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: 'f.req=' + encodeURIComponent('[[["GzXR5e","[null, \\"c_8888abcd1234ef01\\"]",null,"generic"]]]')
      });
    });

    // 4. No refresh: mark cloud deletion and retain all local archive rows.
    await expect(optionsPage.locator('#list .item')).toHaveCount(3);
    await expect(optionsPage.locator(`#list .item[data-chat-id="${targetId}"] .cloud-status`)).toBeVisible();
    await expect(optionsPage.locator(`#list .item[data-chat-id="${targetId}"] .cloud-status`)).toContainText(/Cloud deleted|云端已删除/);
    await expect(optionsPage.locator('#list .item[data-chat-id="keep_chat_1111"]')).toBeVisible();
    await expect(optionsPage.locator('#list .item[data-chat-id="keep_chat_2222"]')).toBeVisible();

    // 5. Durable metadata, body and export tracking must remain.
    const storageState = await optionsPage.evaluate(async () => {
      return new Promise<{ list: any[]; count: number }>((resolve) => {
        chrome.storage.local.get(['conversations_10000000-0000-4000-8000-000000000001', 'last_count_10000000-0000-4000-8000-000000000001'], (data: any) => {
          resolve({
            list: (data && data['conversations_10000000-0000-4000-8000-000000000001']) || [],
            count: (data && data['last_count_10000000-0000-4000-8000-000000000001']) || 0
          });
        });
      });
    });

    const availability = await optionsPage.evaluate(async () => (await chrome.storage.local.get('conversation_availability_10000000-0000-4000-8000-000000000001'))['conversation_availability_10000000-0000-4000-8000-000000000001'] as Record<string, string>);
    expect(availability[targetId]).toBe('deleted');
    expect(storageState.list.length).toBe(3);
    expect(storageState.count).toBe(3);
    const deletedDomain = await optionsPage.evaluate(async (conversationId) => {
      return chrome.runtime.sendMessage({ action: 'domainStorage', command: 'get', payload: { identity: { providerId: 'gemini', accountId: '10000000-0000-4000-8000-000000000001', conversationId } } });
    }, targetId);
    expect(deletedDomain.ok).toBe(true);
    expect(JSON.stringify(deletedDomain.value.conversation)).toContain('Durable archived body');
    const exported = await optionsPage.evaluate(async () => (await chrome.storage.local.get('exported_10000000-0000-4000-8000-000000000001'))['exported_10000000-0000-4000-8000-000000000001'] as Record<string, unknown>);
    expect(exported[targetId]).toMatchObject({ status: 'ok', exportedAt: 1700000000000 });

    expect(storageState.list.map((c: any) => c.key.conversationId)).toEqual(
      expect.arrayContaining(['keep_chat_1111', 'keep_chat_2222'])
    );
  });
});
