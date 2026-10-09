import { test, expect } from './fixtures';

test('legacy detail under the Gemini web origin transfers to the extension repository even after v2 startup', async ({ context, extensionId }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await options.evaluate(async () => {
        await chrome.storage.local.set({ gemini_schema_version: 2, gemini_conversations: [{ id: 'page_legacy', title: 'Page legacy', timestamp: 1, messageCount: 1 }] });
    });
    const source = await context.newPage();
    await source.route('https://gemini.google.com/**', route => route.fulfill({ contentType: 'text/html', body: `
        <title>Legacy migration</title><script type="module">
        const request = indexedDB.open('gemini_exporter_details_idb', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('conversation_details', { keyPath: 'id' });
        const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        await new Promise((resolve, reject) => { const tx = db.transaction('conversation_details', 'readwrite'); tx.objectStore('conversation_details').put({ id: 'page_legacy', messages: [{ role: 'model', content: '**Page origin body**', model: 'Page origin model' }] }); tx.oncomplete = resolve; tx.onabort = reject; });
        db.close();
        </script><p>Legacy source prepared</p>
    ` }));
    await source.route('**/batchexecute*', route => route.fulfill({ contentType: 'application/json', body: `)]}'\n\n[]` }));
    await source.goto('https://gemini.google.com/app');
    await expect.poll(async () => options.evaluate(async () => {
        const response = await chrome.runtime.sendMessage({ action: 'domainStorage', command: 'get', payload: { identity: { providerId: 'gemini', accountSlot: 'u0', conversationId: 'page_legacy' } } });
        return response.value?.conversation?.messages?.[0]?.model;
    })).toBe('Page origin model');
    const report = await options.evaluate(async () => chrome.storage.local.get(['gemini_domain_host_migration_v2:https://gemini.google.com']));
    expect(report['gemini_domain_host_migration_v2:https://gemini.google.com']).toBe(2);
});

test('content-script native detail is committed in extension IndexedDB and remains readable after the source tab closes', async ({ context, extensionId }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
    await options.evaluate(async () => {
        await chrome.storage.local.set({ gemini_conversations: [{ id: 'cross_origin_native', title: 'Cross origin', timestamp: 1 }], gemini_tour_completed: true });
    });
    const source = await context.newPage();
    await source.route('https://gemini.google.com/**', route => route.fulfill({ contentType: 'text/html', body: `
        <title>Cross origin - Gemini</title><script>window._WIZ_global_data = { SNlM0e: 'mock-at', cfb2h: 'mock-bl' };</script>
        <user-query><div class="query-text"><p>Persist this question</p></div></user-query>
        <model-response data-model-name="Cross origin model"><div class="markdown"><p><strong>Persist this answer</strong></p></div></model-response>
    ` }));
    await source.route('**/batchexecute*', route => route.fulfill({ contentType: 'application/json', body: `)]}'\n\n[]` }));
    await source.goto('https://gemini.google.com/app/cross_origin_native');
    const response = await options.evaluate(async () => {
        const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
        return chrome.tabs.sendMessage(tabs[0].id!, { action: 'getConversationDetail', conversationId: 'cross_origin_native', accountSlot: 'default' });
    });
    expect(response.success).toBe(true);
    expect(response.data.conversation.messages).toHaveLength(2);
    await source.close();
    const stored = await options.evaluate(async () => {
        const request = indexedDB.open('gemini_exporter_domain');
        const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        try {
            return await new Promise<unknown>((resolve, reject) => {
                const tx = db.transaction('conversations', 'readonly');
                const get = tx.objectStore('conversations').get(JSON.stringify(['gemini', 'u0', 'cross_origin_native']));
                let value: unknown;
                get.onsuccess = () => { value = get.result; };
                tx.oncomplete = () => resolve(value);
                tx.onerror = () => reject(tx.error);
            });
        } finally { db.close(); }
    }) as { conversation: { messages: Array<{ model?: string; content: unknown[] }> }; storageVersion: number; identity: { accountSlot: string } };
    expect(stored.storageVersion).toBe(2);
    expect(stored.identity.accountSlot).toBe('u0');
    expect(stored.conversation.messages).toHaveLength(2);
    expect(stored.conversation.messages[1].model).toBe('Cross origin model');
    expect(JSON.stringify(stored.conversation)).toContain('Persist this answer');
});
