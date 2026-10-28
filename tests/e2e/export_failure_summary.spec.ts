import { test, expect } from '@playwright/test';
import { A, mount, read } from '../helpers/uiPortHarness';

test('100 failed conversations collapse into one group, copy the reason once, and retry only failures', async ({ page }) => {
    const indexes = Array.from({ length: 101 }, (_, i) => ({
        key: { accountId: A, conversationId: `chat-${i}` }, title: `Conversation ${i}`, updatedAt: 5,
    }));
    await mount(page, 'options', { indexes, failExport: true, partial: true });
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
        value: { writeText: async (value: string) => { Reflect.set(window, 'copiedFailures', value); } } }));
    await page.locator('#btnSelectAll').click();
    await page.locator('#btnExport').click();
    await page.locator('#btnModalContinueZip').click();
    await expect(page.locator('#exportFailureTitle')).toHaveText('100 conversations failed · Issue groups: 1');
    const groups = page.locator('#exportFailureList > details');
    await expect(groups).toHaveCount(1);
    await expect(groups.locator('summary')).toHaveText('File delivery failed · 100 conversations · 100 occurrences');
    await expect(groups).not.toHaveAttribute('open');
    await groups.locator('summary').click();
    await expect(groups).toContainText('Injected export failure');
    await expect(groups).toContainText('Conversation 100 (chat-100)');
    await expect(groups).not.toContainText('Conversation 0 (chat-0)');
    await page.locator('#btnCopyFailedLog').click();
    const copied = await page.evaluate(() => Reflect.get(window, 'copiedFailures'));
    expect(copied.split('Injected export failure').length - 1).toBe(1);
    expect(copied).toContain(`${A}/chat-100`);
    await page.locator('#langToggle').uncheck();
    await expect(page.locator('#exportFailureTitle')).toHaveText('100 条会话导出失败 · 1 组问题');
    await page.locator('#btnRetryFailed').click();
    const retry = (await read(page, 'exports'))[1];
    expect(retry.keys).toHaveLength(100);
    expect(retry.keys).not.toContainEqual(indexes[0].key);
    expect(retry.skipUnchanged).toBe(false);
});

test('error messages and conversation titles are rendered as text', async ({ page }) => {
    const message = '<img src=x onerror=alert(1)>';
    await mount(page, 'options', { failExport: true, exportError: message });
    await page.locator('#btnSelectAll').click();
    await page.locator('#btnExport').click();
    const group = page.locator('#exportFailureList > details');
    await expect(group).toHaveCount(1);
    await group.locator('summary').click();
    await expect(group).toContainText(message);
    await expect(group).toContainText(`${message} (a)`);
    await expect(page.locator('#exportFailureList img')).toHaveCount(0);
    await expect(page.locator('#list img')).toHaveCount(0);
});

test('partial exports aggregate warnings, preserve all counts beyond log limits, and export the groups', async ({ page }) => {
    await mount(page, 'options', { holdExport: true, partial: true });
    await page.locator('#devToggle').check();
    await page.locator('#btnSelectAll').click();
    await page.locator('#btnExport').click();
    await page.evaluate(() => {
        const h = Reflect.get(window, 'harness');
        const key = h.exports[0].keys[0];
        for (let i = 0; i < 10001; i++) h.exportOptions.onDiagnostic({ key, stage: 'resource', severity: 'warning',
            code: 'RESOURCE_PROCESSING_FAILED', message: `Resource ${i} rejected` });
        h.finishExport();
    });
    await expect(page.locator('#exportFailureTitle')).toHaveText('0 conversations failed · Issue groups: 1');
    await expect(page.locator('#exportFailureList summary')).toHaveText('Attachment could not be processed · 1 conversations · 10001 occurrences');
    await expect(page.locator('#btnRetryFailed')).toBeHidden();
    const downloaded = page.waitForEvent('download');
    await page.locator('#btnExportDiag').focus();
    await page.locator('#btnExportDiag').press('Enter');
    const file = await downloaded;
    const { readFile } = await import('node:fs/promises');
    const filePath = await file.path();
    expect(filePath).toBeTruthy();
    if (!filePath) throw new Error('Diagnostic download missing');
    const report = JSON.parse(await readFile(filePath, 'utf8'));
    expect(report.exportRuns[0].diagnostics).toHaveLength(10000);
    expect(report.exportRuns[0].droppedDiagnostics).toBe(1);
    expect(report.exportRuns[0].issues[0]).toMatchObject({ category: 'RESOURCE_PROCESSING_FAILED', severity: 'warning', occurrences: 10001 });
    expect(report.exportRuns[0].issues[0].conversations).toHaveLength(1);
});

test('preflight folder authorization is a status prompt, not a batch failure', async ({ page }) => {
    await mount(page, 'options', { settings: { exportDelivery: 'folderWriter' } });
    await page.locator('#btnSelectAll').click();
    await page.locator('#btnExport').click();
    await expect(page.locator('#status')).toHaveText('Authorize a folder first');
    await expect(page.locator('#exportFailureCard')).toBeHidden();
    expect(await read(page, 'exports')).toHaveLength(0);
});
