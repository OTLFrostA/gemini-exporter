const { test, expect } = require('./fixtures');

test.describe('Onboarding Tour Guide & Welcome Flow', () => {
  test('should trigger tour on welcome param, navigate 4 steps, and complete', async ({ context, extensionId }) => {
    const page = await context.newPage();

    // 1. Open options page with ?welcome=1
    await page.goto(`chrome-extension://${extensionId}/options.html?welcome=1`);
    await page.waitForLoadState('domcontentloaded');

    // 2. Wait for Tour popover to appear
    const popover = page.locator('.tour-popover');
    await expect(popover).toBeVisible({ timeout: 5000 });

    // Step 1 check
    await expect(page.locator('.tour-step-badge')).toHaveText('1 / 4');
    await expect(page.locator('#tourNextBtn')).toBeVisible();

    // 3. Step through tour
    await page.click('#tourNextBtn');
    await expect(page.locator('.tour-step-badge')).toHaveText('2 / 4');

    await page.click('#tourNextBtn');
    await expect(page.locator('.tour-step-badge')).toHaveText('3 / 4');

    await page.click('#tourNextBtn');
    await expect(page.locator('.tour-step-badge')).toHaveText('4 / 4');

    // Step 4 final button
    await page.click('#tourNextBtn');

    // Popover should be removed
    await expect(popover).toBeHidden();

    // Verify storage has tour completed
    const completed = await page.evaluate(async () => {
      const data = await chrome.storage.local.get('has_completed_tour');
      return !!data.has_completed_tour;
    });
    expect(completed).toBe(true);
  });

  test('should launch tour on clicking header button', async ({ context, extensionId }) => {
    const page = await context.newPage();

    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForLoadState('domcontentloaded');

    // Click #btnTourGuide in header
    await page.click('#btnTourGuide');

    const popover = page.locator('.tour-popover');
    await expect(popover).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.tour-step-badge')).toHaveText('1 / 4');

    // Click close/skip
    await page.click('#tourSkipBtn');
    await expect(popover).toBeHidden();
  });
});
