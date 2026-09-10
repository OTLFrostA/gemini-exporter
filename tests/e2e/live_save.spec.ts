import { test, expect } from './fixtures';

test.describe('E2E: Live Auto-Save Controls & In-Page Persistence Flow', () => {
  test('should render live auto-save card in workbench and toggle disk sync box', async ({ context, extensionId }) => {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/src/ui/options/options.html`);
    await optionsPage.waitForLoadState('domcontentloaded');

    // 1. Verify card elements exist (and legacy/removed toggles are absent)
    const diskToggle = optionsPage.locator('#liveSaveDiskToggle');
    const diskBox = optionsPage.locator('#liveSaveDiskBox');
    const statusTag = optionsPage.locator('#liveSaveStatusTag');

    await expect(optionsPage.locator('#includeIndex')).toHaveCount(0);
    await expect(optionsPage.locator('#liveSaveDbToggle')).toHaveCount(0);
    await expect(diskToggle).toBeVisible();
    await expect(statusTag).toBeVisible();

    // Default: Disk is unchecked and hidden
    await expect(diskToggle).not.toBeChecked();
    await expect(diskBox).not.toBeVisible();

    // 2. Click diskToggle to enable disk sync UI
    await diskToggle.click();
    await expect(diskToggle).toBeChecked();
    await expect(diskBox).toBeVisible();

    // 3. Click again to disable
    await diskToggle.click();
    await expect(diskToggle).not.toBeChecked();
    await expect(diskBox).not.toBeVisible();

    await optionsPage.close();
  });

  test('should trigger live save execution and display visual badge feedback on completion', async ({ context, extensionId }) => {
    const geminiPage = await context.newPage();

    // Route HTML for Gemini page
    await geminiPage.route('https://gemini.google.com/app/live_test_chat_1', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<!DOCTYPE html>
        <html>
        <head>
          <title>AI Agent Live Auto-Save Test - Google Gemini</title>
        </head>
        <body>
          <h1 data-test-id="conversation-title">AI Agent Live Auto-Save Test</h1>
          <user-query><div class="query-text">Can you live save this message?</div></user-query>
          <model-response><div class="markdown">Yes, live save persists your conversation in real time!</div></model-response>
        </body>
        </html>`
      });
    });

    const mockDetailInner = JSON.stringify([
      [
        ["c_live_test_chat_1", "turn_1", [null, null, ["Can you live save this message?"]]],
        ["c_live_test_chat_1", "turn_2", [null, null, ["Yes, live save persists your conversation in real time!"]]]
      ],
      "token_123",
      "AI Agent Live Auto-Save Test"
    ]);
    const mockRpcResponse = `)]}'\n\n[["wrb.fr","hNvQHb",${JSON.stringify(mockDetailInner)}]]`;

    await geminiPage.route('**/batchexecute*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: mockRpcResponse
      });
    });

    await geminiPage.goto('https://gemini.google.com/app/live_test_chat_1');
    await geminiPage.waitForLoadState('domcontentloaded');

    // Wait for injected badge
    const badge = geminiPage.locator('#geminiExportBadge');
    await expect(badge).toBeVisible();

    // Trigger live save via window.postMessage with mockMode to test in-page visual badge feedback
    await geminiPage.evaluate(() => {
      window.postMessage({
        type: 'GEMINI_LIVE_SAVE_TRIGGER',
        payload: {
          cid: 'live_test_chat_1',
          reason: 'turn_complete',
          mockMode: true
        }
      }, location.origin);
    });

    // Verify badge received feedback state
    await expect(badge).toHaveClass(/live-saved/, { timeout: 4000 });
    const badgeText = geminiPage.locator('#geminiExportBadgeText');
    await expect(badgeText).toContainText('✓', { timeout: 4000 });

    await geminiPage.close();
  });
});
