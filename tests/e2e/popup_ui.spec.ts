import { test, expect } from './fixtures';

test.describe('Popup UI & Action Center Localization', () => {
  test('should render properly localized UI and handle language toggle across controls and storage sync', async ({ context, extensionId }) => {
    const page = await context.newPage();

    // 1. Navigate to popup page
    await page.goto(`chrome-extension://${extensionId}/src/ui/popup/popup.html`);
    await page.waitForLoadState('domcontentloaded');

    // Wait for async initLanguage
    await page.waitForTimeout(400);

    // 2. Ensure zero raw i18n keys are exposed on the page
    const rawKeyCheck = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('[data-i18n]'));
      const violations: { id: string; key: string; text: string }[] = [];
      for (const el of elements) {
        const key = el.getAttribute('data-i18n');
        const text = el.textContent?.trim() || '';
        if (key && text === key) {
          violations.push({ id: el.id, key, text });
        }
      }
      return violations;
    });
    expect(rawKeyCheck).toEqual([]);

    // 3. Test explicit switch to English by clicking labelLangEn
    await page.click('#labelLangEn');
    await expect(page.locator('#btnScreenshot')).toHaveText('📸 Generate Long Screenshot');
    await expect(page.locator('#btnCopyMarkdown')).toHaveText('📋 Copy Markdown');
    await expect(page.locator('#btnCurrent')).toHaveText('📥 Download File');
    await expect(page.locator('#currentChatLabel')).toHaveText('Current Conversation');
    await expect(page.locator('#btnOptions')).toHaveText('Open Workbench ↗');
    await expect(page.locator('#historyTotalSynced')).toHaveText('History synced:');
    await expect(page.locator('#format option[value="json_openai"]')).toHaveText('JSON (OpenAI format)');
    expect(await page.locator('#langToggle').isChecked()).toBe(true);

    const enStorageLang = await page.evaluate(async () => {
      const data = await chrome.storage.local.get('gemini_exporter_lang');
      return data.gemini_exporter_lang;
    });
    expect(enStorageLang).toBe('en');

    // 4. Test explicit switch to Chinese by clicking labelLangZh
    await page.click('#labelLangZh');
    await expect(page.locator('#btnScreenshot')).toHaveText('📸 一键生成高清长截图');
    await expect(page.locator('#btnCopyMarkdown')).toHaveText('📋 复制 Markdown');
    await expect(page.locator('#btnCurrent')).toHaveText('📥 下载文件');
    await expect(page.locator('#currentChatLabel')).toHaveText('当前会话');
    await expect(page.locator('#btnOptions')).toHaveText('打开完整工作台 ↗');
    await expect(page.locator('#historyTotalSynced')).toHaveText('历史已同步:');
    await expect(page.locator('#format option[value="json_openai"]')).toHaveText('JSON (OpenAI格式)');
    expect(await page.locator('#langToggle').isChecked()).toBe(false);

    const zhStorageLang = await page.evaluate(async () => {
      const data = await chrome.storage.local.get('gemini_exporter_lang');
      return data.gemini_exporter_lang;
    });
    expect(zhStorageLang).toBe('zh');

    // 5. Test clicking the checkbox toggle directly
    await page.locator('#langToggle').click();
    await expect(page.locator('#btnScreenshot')).toHaveText('📸 Generate Long Screenshot');
    expect(await page.locator('#langToggle').isChecked()).toBe(true);

    // 6. Test clicking the outer capsule pill container (#langTogglePill)
    await page.locator('#langTogglePill').click({ position: { x: 2, y: 2 } });
    await expect(page.locator('#btnScreenshot')).toHaveText('📸 一键生成高清长截图');
    expect(await page.locator('#langToggle').isChecked()).toBe(false);

    // 7. Test cross-view sync via storage.onChanged
    await page.evaluate(async () => {
      await chrome.storage.local.set({ gemini_exporter_lang: 'en' });
    });
    await expect(page.locator('#btnScreenshot')).toHaveText('📸 Generate Long Screenshot');
    expect(await page.locator('#langToggle').isChecked()).toBe(true);
  });

  test('should synchronize language changes bidirectionally between options workbench and popup', async ({ context, extensionId }) => {
    const popupPage = await context.newPage();
    const optionsPage = await context.newPage();

    await popupPage.goto(`chrome-extension://${extensionId}/src/ui/popup/popup.html`);
    await optionsPage.goto(`chrome-extension://${extensionId}/src/ui/options/options.html`);

    await popupPage.waitForLoadState('domcontentloaded');
    await optionsPage.waitForLoadState('domcontentloaded');
    await popupPage.waitForTimeout(400);
    await optionsPage.waitForTimeout(400);

    // 1. Switch language in popup to English -> options workbench should update
    await popupPage.click('#labelLangEn');
    await expect(popupPage.locator('#btnScreenshot')).toHaveText('📸 Generate Long Screenshot');
    await expect(optionsPage.locator('#btnSelectAll')).toHaveText('All');

    // 2. Switch language in options workbench to Chinese -> popup should update
    await optionsPage.click('#labelLangZh');
    await expect(optionsPage.locator('#btnSelectAll')).toHaveText('全选');
    await expect(popupPage.locator('#btnScreenshot')).toHaveText('📸 一键生成高清长截图');
  });
});
