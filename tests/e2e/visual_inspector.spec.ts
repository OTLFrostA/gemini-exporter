import { test, expect } from './fixtures';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Visual Inspection & Physical Hit-Testing Suite (Phase 1 & 2)', () => {
  const outputDir = path.resolve(__dirname, '../../tests/output/visual_audit');

  test.beforeAll(() => {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  });

  test('should execute 5-step tour with 100% zero-occlusion and physical mouse hit-testing', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    // Open options page with onboarding welcome flag
    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?welcome=1`);
    await page.waitForLoadState('domcontentloaded');

    const popover = page.locator('.tour-popover');
    await expect(popover).toBeVisible({ timeout: 5000 });

    for (let stepIdx = 0; stepIdx < 5; stepIdx++) {
      const stepBadge = await page.locator('.tour-step-badge').innerText();
      expect(stepBadge).toBe(`${stepIdx + 1} / 5`);

      // 1. Capture visual snapshot
      const screenshotPath = path.join(outputDir, `tour_step_${stepIdx + 1}.png`);
      await page.screenshot({ path: screenshotPath });
      expect(fs.existsSync(screenshotPath)).toBe(true);

      // 2. Visual Collision Audit: verify popover does NOT overlap highlighted target
      const collisionResult = await page.evaluate(() => {
        const popEl = document.querySelector('.tour-popover');
        const TG = (window as any).TourGuide;
        if (!popEl || !TG) return { ok: false, reason: 'popover or TourGuide missing' };
        const step = TG.STEPS[TG.getCurrentStep()];
        const target = step.getTarget ? step.getTarget() : null;
        if (!target) return { ok: true, note: 'no target element on this step' };

        const pRect = popEl.getBoundingClientRect();
        const tRect = target.getBoundingClientRect();

        const overlaps = !(
          pRect.right <= tRect.left ||
          pRect.left >= tRect.right ||
          pRect.bottom <= tRect.top ||
          pRect.top >= tRect.bottom
        );

        return {
          ok: !overlaps,
          overlaps,
          popoverRect: { left: pRect.left, top: pRect.top, right: pRect.right, bottom: pRect.bottom },
          targetRect: { left: tRect.left, top: tRect.top, right: tRect.right, bottom: tRect.bottom }
        };
      });
      expect(collisionResult.ok).toBe(true);

      // 3. Physical Hit-Testing on next button: verify no element is blocking the click target
      const nextBtn = page.locator('#tourNextBtn');
      await expect(nextBtn).toBeVisible();
      const nextBtnBox = await nextBtn.boundingBox();
      expect(nextBtnBox).not.toBeNull();

      if (nextBtnBox) {
        const clickX = nextBtnBox.x + nextBtnBox.width / 2;
        const clickY = nextBtnBox.y + nextBtnBox.height / 2;

        const hitTestTag = await page.evaluate(({ x, y }) => {
          const hit = document.elementFromPoint(x, y);
          return hit ? hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') : null;
        }, { x: clickX, y: clickY });

        // Must hit the button itself or text/span inside it
        expect(hitTestTag).toMatch(/^(button#tournextbtn|span|div)/i);

        // Advance to next step
        if (stepIdx < 4) {
          await nextBtn.click();
          await expect(page.locator('.tour-step-badge')).toHaveText(`${stepIdx + 2} / 5`);
        } else {
          await nextBtn.click();
        }
      }
    }

    // Tour should be finished and destroyed
    await expect(popover).toBeHidden();
  });

  test('should verify modal backdrop provides complete visual shielding against accidental background clicks', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html`);
    await page.waitForLoadState('domcontentloaded');

    // Trigger takeout limit modal for visual inspection
    await page.evaluate(() => {
      const modal = document.getElementById('takeoutLimitModal');
      if (modal) {
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
      }
    });

    const modal = page.locator('#takeoutLimitModal');
    await expect(modal).toBeVisible();

    // Verify modal overlay covers the entire viewport
    const overlayBounds = await modal.boundingBox();
    expect(overlayBounds).not.toBeNull();
    if (overlayBounds) {
      expect(overlayBounds.width).toBeGreaterThanOrEqual(1280);
      expect(overlayBounds.height).toBeGreaterThanOrEqual(800);
    }

    // Hit-test on background area (e.g. at 50, 50 where header/sidebar would normally be)
    const backgroundHit = await page.evaluate(() => {
      const hit = document.elementFromPoint(50, 50);
      return hit ? hit.id || hit.className : 'null';
    });
    // Click must hit modal container/overlay, NOT underlying buttons
    expect(backgroundHit).toMatch(/modal|overlay|container/i);

    // Capture modal snapshot
    const modalPic = path.join(outputDir, 'modal_visual_backdrop.png');
    await page.screenshot({ path: modalPic });
    expect(fs.existsSync(modalPic)).toBe(true);

    // Dismiss modal cleanly
    await page.evaluate(() => {
      const modal = document.getElementById('takeoutLimitModal');
      if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
      }
    });
    await expect(modal).toBeHidden();
  });

  test('should audit layout integrity, preventing text truncation on buttons and key controls', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    // Check all primary action buttons for unintentional text overflow
    const truncationAudit = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, .btn, .item .title, .badge'));
      const truncated: { tag: string; id: string; text: string; scrollW: number; clientW: number }[] = [];

      buttons.forEach(el => {
        // Allow intentional ellipsis on long conversation titles, but action buttons must never be truncated
        if (el.tagName.toLowerCase() === 'button' || el.classList.contains('btn')) {
          if (el.scrollWidth > el.clientWidth + 2) {
            truncated.push({
              tag: el.tagName.toLowerCase(),
              id: el.id,
              text: el.textContent?.trim().slice(0, 30) || '',
              scrollW: el.scrollWidth,
              clientW: el.clientWidth
            });
          }
        }
      });

      return truncated;
    });

    expect(truncationAudit).toEqual([]);

    const fullPagePic = path.join(outputDir, 'workbench_layout_clean.png');
    await page.screenshot({ path: fullPagePic });
    expect(fs.existsSync(fullPagePic)).toBe(true);
  });
});
