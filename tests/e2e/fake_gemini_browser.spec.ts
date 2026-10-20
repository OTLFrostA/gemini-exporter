import { test, expect, seedRegistryAccounts } from './fixtures';
import { openOptions, accountId } from './uiFixture';
import { FakeGeminiHarness, loadFakeGeminiReplay } from './fake-gemini/harness';
import * as fs from 'node:fs';
import * as path from 'node:path';

const fixturesFromDisk = process.env.FAKE_GEMINI_REPLAY
    ? loadFakeGeminiReplay(process.env.FAKE_GEMINI_REPLAY) : undefined;

function createHarness() {
    return new FakeGeminiHarness({ ...(fixturesFromDisk ? { replay: fixturesFromDisk } : {}) });
}

async function maybeSaveScreenshot(page: import('@playwright/test').Page, name: string) {
    // Diagnostic artifact only. No screenshot baselines / visual assertions.
    if (process.env.FAKE_GEMINI_SCREENSHOTS !== '1') return;
    const folder = path.resolve(__dirname, '../output/fake-gemini');
    fs.mkdirSync(folder, { recursive: true });
    await page.screenshot({ path: path.join(folder, name), fullPage: true });
}

test.describe('Offline Gemini website + real MV3 extension', () => {
    test('unpacked extension injects into the simulated https://gemini.google.com page', async ({ context, extensionId }) => {
        const harness = createHarness();
        await harness.install(context);
        const source = await context.newPage();
        await source.goto('https://gemini.google.com/app');
        await expect(source.locator('[data-testid="fake-gemini-root"]')).toBeVisible();
        await expect(source.locator('#geminiExportBadge')).toBeAttached({ timeout: 15000 });

        // Open the actual shipped extension popup, not a mock of its DOM.
        const popup = await context.newPage();
        await popup.goto('chrome-extension://' + extensionId + '/src/ui/popup/popup.html');
        await expect(popup.locator('#formatTabs')).toBeVisible();
        await maybeSaveScreenshot(source, 'fake-gemini-page.png');
        await maybeSaveScreenshot(popup, 'real-extension-popup.png');
        expect(harness.unexpectedPaths).toEqual([]);
    });

    test('page requests list pages and detail; L1 captures through real Content and L2 storage', async ({ context, extensionId }) => {
        const harness = createHarness();
        await harness.install(context);
        await seedRegistryAccounts(context);
        const source = await context.newPage();
        await source.goto('https://gemini.google.com/app');
        await expect(source.locator('#geminiExportBadge')).toBeAttached();

        const options = await openOptions(context, extensionId);
        await source.getByRole('button', { name: 'Load conversations' }).click();
        await expect(source.locator('#fakeStatus')).toHaveText('List complete');
        await source.getByRole('button', { name: 'Load next page' }).click();
        await expect(source.locator('#fakeStatus')).toHaveText('Next page complete');

        expect(harness.requests.filter(req => req.kind === 'list').map(req => req.cursor)).toEqual([null, 'tC_2']);
        await expect.poll(async () => options.evaluate(async id =>
            (await Reflect.get(globalThis, 'uiFixture').listIndexes(id)).length, accountId), { timeout: 15000 }).toBe(3);

        await source.goto('https://gemini.google.com/app/a100000000000001');
        await source.getByRole('button', { name: 'Load detail' }).click();
        await expect(source.locator('#fakeStatus')).toHaveText('Detail complete');
        expect(harness.requests.some(req => req.kind === 'detail' && req.conversationId === 'a100000000000001')).toBe(true);
        await expect.poll(async () => options.evaluate(async id => {
            const conversation = await Reflect.get(globalThis, 'uiFixture')
                .readConversation({ accountId: id, conversationId: 'a100000000000001' });
            return JSON.stringify(conversation ?? {});
        }, accountId), { timeout: 15000 }).toContain('Answer from demo chat one.');

        await options.bringToFront();
        await options.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(options.locator('#list .item')).toHaveCount(3);
        await maybeSaveScreenshot(options, 'real-extension-workbench.png');
    });

    test('Gems, StreamGenerate and deletion endpoints are deterministic and fail closed on unknown URLs', async ({ context }) => {
        const harness = createHarness();
        await harness.install(context);
        const source = await context.newPage();
        await source.goto('https://gemini.google.com/app/a100000000000002');
        await source.getByRole('button', { name: 'Load gems' }).click();
        await expect(source.locator('#fakeStatus')).toHaveText('Gems complete');
        await source.getByRole('button', { name: 'Send message' }).click();
        await expect(source.locator('#fakeStatus')).toHaveText('Stream complete');
        await source.getByRole('button', { name: 'Delete conversation' }).click();
        await expect(source.locator('#fakeStatus')).toHaveText('Delete complete');

        expect(harness.requests.map(req => req.kind)).toEqual(['gems', 'stream', 'delete']);
        const status = await source.evaluate(async () => (await fetch('/unrecognized-fake-endpoint')).status);
        expect(status).toBe(501);
        expect(harness.unexpectedPaths).toContain('/unrecognized-fake-endpoint');
    });
});
