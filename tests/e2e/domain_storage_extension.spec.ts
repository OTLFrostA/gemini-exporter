import { test, expect, seedRegistryAccounts } from './fixtures';

test.beforeEach(async ({context, extensionId}) => {
    void extensionId;
    await seedRegistryAccounts(context);
});

test('content-script native detail is committed in extension IndexedDB and remains readable after the source tab closes', async ({ context, extensionId }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await options.evaluate(async () => {
        await chrome.storage.local.set({ ['conversations_10000000-0000-4000-8000-000000000001']: ([{ id: 'cross_origin_native', title: 'Cross origin', timestamp: 1 }]).map(canonicalIndexFixture), gemini_tour_completed: true });
    });
    const source = await context.newPage();
    await source.route('https://gemini.google.com/**', route => route.fulfill({ contentType: 'text/html', body: `
        <title>Cross origin - Gemini</title><script>window._WIZ_global_data = { qDCSke: '10000000001', SNlM0e: 'mock-at', cfb2h: 'mock-bl' };</script>
        <user-query><div class="query-text"><p>Persist this question</p></div></user-query>
        <model-response data-model-name="Cross origin model"><div class="markdown"><p><strong>Persist this answer</strong></p></div></model-response>
    ` }));
    await source.route('**/batchexecute*', route => route.fulfill({ contentType: 'application/json', body: `)]}'\n\n[]` }));
    await source.goto('https://gemini.google.com/app/cross_origin_native');
    const response = await options.evaluate(async () => {
        const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
        return chrome.tabs.sendMessage(tabs[0].id!, { action: 'getConversationDetail', conversationId: 'cross_origin_native', accountId: '10000000-0000-4000-8000-000000000001' });
    });
    expect(response.success).toBe(true);
    expect(response.data.conversation.detail.messages).toHaveLength(2);
    expect(response.data.conversation.detail.quality.status).toBe('partial');
    await source.close();
    const stored = await options.evaluate(async () => {
        const request = indexedDB.open('gemini_exporter_domain');
        const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        try {
            return await new Promise<unknown>((resolve, reject) => {
                const tx = db.transaction('conversations', 'readonly');
                const get = tx.objectStore('conversations').get(JSON.stringify(['gemini', '10000000-0000-4000-8000-000000000001', 'cross_origin_native']));
                let value: unknown;
                get.onsuccess = () => { value = get.result; };
                tx.oncomplete = () => resolve(value);
                tx.onerror = () => reject(tx.error);
            });
        } finally { db.close(); }
    }) as { conversation: { detail: { messages: Array<{ model?: string; content: unknown[] }> } }; storageVersion: number; identity: { accountId: string } };
    expect(stored.storageVersion).toBe(3);
    expect(stored.identity.accountId).toBe('10000000-0000-4000-8000-000000000001');
    expect(stored.conversation.detail.messages).toHaveLength(2);
    expect(stored.conversation.detail.messages[1].model).toBe('Cross origin model');
    expect(JSON.stringify(stored.conversation)).toContain('Persist this answer');
});
