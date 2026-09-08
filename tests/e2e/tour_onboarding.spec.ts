import { test, expect } from './fixtures';

test.describe('Onboarding Tour Guide & Welcome Flow', () => {
  test('should trigger tour on welcome param, navigate 5 steps, and complete', async ({ context, extensionId }) => {
    const page = await context.newPage();

    // 1. Open options page with ?welcome=1
    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?welcome=1`);
    await page.waitForLoadState('domcontentloaded');

    // 2. Wait for Tour popover to appear
    const popover = page.locator('.tour-popover');
    await expect(popover).toBeVisible({ timeout: 5000 });

    // Step 1 check
    await expect(page.locator('.tour-step-badge')).toHaveText('1 / 5');
    await expect(page.locator('#tourNextBtn')).toBeVisible();

    // 3. Step through tour
    await page.click('#tourNextBtn');
    await expect(page.locator('.tour-step-badge')).toHaveText('2 / 5');

    await page.click('#tourNextBtn');
    await expect(page.locator('.tour-step-badge')).toHaveText('3 / 5');

    await page.click('#tourNextBtn');
    await expect(page.locator('.tour-step-badge')).toHaveText('4 / 5');

    await page.click('#tourNextBtn');
    await expect(page.locator('.tour-step-badge')).toHaveText('5 / 5');

    // Step 5 check: highlights feedback box and mentions active development
    await expect(page.locator('.tour-title')).toContainText('Active Development & Feedback');
    await expect(page.locator('.tour-content')).toContainText('actively under development');
    await expect(page.locator('#tourNextBtn')).toHaveText('🎉 Got it & Start');

    // Step 5 final button
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

    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => typeof window.__workbenchLoadStore === 'function');

    // Verify #btnTourGuide has exactly one lightbulb emoji
    const btnText = await page.locator('#btnTourGuide').innerText();
    expect((btnText.match(/💡/g) || []).length).toBe(1);
    expect(['💡 新手引导', '💡 Tour Guide']).toContain(btnText.replace(/\s+/g, ' ').trim());

    // Click #btnTourGuide in header
    await page.click('#btnTourGuide');

    const popover = page.locator('.tour-popover');
    await expect(popover).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.tour-step-badge')).toHaveText('1 / 5');

    // Click close/skip
    await page.click('#tourSkipBtn');
    await expect(popover).toBeHidden();
  });

  test('should never overlap target element across all 5 steps', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?welcome=1`);
    await page.waitForLoadState('domcontentloaded');

    const popover = page.locator('.tour-popover');
    await expect(popover).toBeVisible({ timeout: 5000 });

    for (let i = 0; i < 5; i++) {
      const isOverlapping = await page.evaluate(() => {
        const popEl = document.querySelector('.tour-popover');
        const step = window.TourGuide.STEPS[window.TourGuide.getCurrentStep()];
        const target = step.getTarget ? step.getTarget() : null;
        if (!popEl || !target) return false;
        const pRect = popEl.getBoundingClientRect();
        const tRect = target.getBoundingClientRect();
        return !(pRect.right <= tRect.left || pRect.left >= tRect.right || pRect.bottom <= tRect.top || pRect.top >= tRect.bottom);
      });
      expect(isOverlapping).toBe(false);
      if (i < 4) {
        await page.click('#tourNextBtn');
        await page.waitForTimeout(200);
      }
    }
  });
});
