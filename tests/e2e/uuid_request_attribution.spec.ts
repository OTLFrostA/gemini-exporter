import { test, expect } from './fixtures';

for (const transport of ['fetch', 'xhr'] as const) {
  for (const kind of ['list', 'detail'] as const) {
    test(`${transport} ${kind} captures identity at send time and rejects a response after same-slot Gaia switch`, async ({ context, extensionId }) => {
      const page = await context.newPage();
      await page.route('https://gemini.google.com/app', route => route.fulfill({ contentType: 'text/html', body:
        `<script>window.WIZ_global_data={qDCSke:'10000000001',oPEP7c:'same@example.com'}</script><body>Fixture</body>` }));
      const options = await context.newPage();
      await options.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
      await page.goto('https://gemini.google.com/app');
      const binding = () => options.evaluate(async () => {
        const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
        return (await chrome.tabs.sendMessage(tabs[0].id!, { action: 'getAccountContext' })).accountContext;
      });
      const original = await binding();
      expect(original?.accountId).toMatch(/^[0-9a-f-]{36}$/);
      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      let arrived!: () => void;
      const requestArrived = new Promise<void>(resolve => { arrived = resolve; });
      let round = 0;
      const rpc = kind === 'list' ? 'MaZiqc' : 'hNvQHb';
      await page.route('**/batchexecute*', async route => {
        const index = round++;
        if (index === 0) { arrived(); await held; }
        const id = index === 0 ? 'staleuuid123' : 'currentuuid123';
        const data = kind === 'list'
          ? [null, [[`c_${id}`, 'Source title', null, null, null, [1700000000, 0]]], null]
          : [[[[`c_${id}`, 'r_turn'], [1700000000, 0], [['Question']], [['rc_turn', [['Answer']]]]]], null, 'Source title'];
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify([['wrb.fr', rpc, JSON.stringify(data)]]) });
      });
      const send = () => page.evaluate(async ({ transport, rpc }) => {
        const url = '/_/BardChatUi/data/batchexecute';
        const body = new URLSearchParams({ 'f.req': JSON.stringify([[[rpc, JSON.stringify([20, null, [0, null, 1]]), null, 'generic']]]) }).toString();
        if (transport === 'fetch') { await fetch(url, { method: 'POST', body }); }
        else await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest(); xhr.open('POST', url);
          xhr.onload = () => resolve(); xhr.onerror = () => reject(new Error('XHR failed')); xhr.send(body);
        });
      }, { transport, rpc });
      const pending = send();
      await requestArrived;
      await page.evaluate(() => { (window as unknown as { WIZ_global_data: { qDCSke: string } }).WIZ_global_data.qDCSke = '10000000002'; });
      const current = await binding();
      expect(current.accountId).not.toBe(original.accountId);
      release(); await pending;
      // A valid response under B provides a positive completion check for the same pipeline.
      await send();
      const rows = () => options.evaluate(async () => (await chrome.storage.local.get<{ gemini_conversations?: { id: string }[] }>('gemini_conversations')).gemini_conversations || []);
      await expect.poll(async () => (await rows()).some((row: { id: string }) => row.id === 'currentuuid123')).toBe(true);
      expect((await rows()).some((row: { id: string }) => row.id === 'staleuuid123')).toBe(false);
    });
  }
}
