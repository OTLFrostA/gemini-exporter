import { test, expect } from '@playwright/test';
import { mount, read, A, B } from '../helpers/uiPortHarness';

test('UI v2: Popup four formats use one request, preserve enabledDisk, include assets and never skip', async ({ page }) => {
    await mount(page, 'popup');
    // Product contract: the v1 dark card/tabs presentation survives the v2 service migration.
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(9, 10, 16)');
    await expect(page.locator('#chatInfoCard')).toBeVisible();
    await expect(page.locator('#formatTabs .tab-btn')).toHaveCount(4);
    for (const hiddenOfProductScope of ['#countBadge', '#chatTurnBadge', '#langToggle', '#progWrap', '#format']) {
        await expect(page.locator(hiddenOfProductScope)).toHaveCount(0);
    }
    await expect(page.locator('#btnCurrent')).toBeEnabled();
    await expect(page.locator('button')).toHaveCount(7);
    await expect(page.locator('#currentChatTitle')).toHaveText('<img src=x onerror=alert(1)>');
    for (const format of ['markdown','html','json','pdf']) {
        await page.locator(`[data-format="${format}"]`).click();
        await expect(page.locator(`[data-format="${format}"]`)).toHaveAttribute('aria-pressed','true');
        await page.locator('#btnCurrent').click();
        await expect(page.locator('#status')).toHaveText('Download initiated');
    }
    const requests = await read(page,'exports'); expect(requests.map((r: any)=>r.format)).toEqual(['markdown','html','json','pdf']);
    for (const request of requests) expect(request).toEqual({keys:[{accountId:A,conversationId:'a'}],format:request.format,delivery:'browserDownload',includeAssets:true,skipUnchanged:false});
    expect((await read(page,'settings')).enabledDisk).toBe(true);
    expect((await read(page,'events')).slice(-3)).toEqual(['fonts','context','export']);
});
test('UI v2: Options can toggle Light and Dark, persisting a shared preference', async ({ page }) => {
    await mount(page, 'options');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#btnThemeToggle')).toHaveAttribute('aria-label', 'Switch to light mode');
    await page.locator('#btnThemeToggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 247, 252)');
    await expect(page.locator('.card-left')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('#btnThemeToggle')).toHaveAttribute('aria-label', 'Switch to dark mode');
    expect((await read(page, 'settings')).theme).toBe('light');
    expect(await read(page, 'patches')).toContainEqual({ theme: 'light' });
    await page.locator('#btnThemeToggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(9, 10, 16)');
});

test('UI v2: Popup loads the shared Light preference and can switch to Dark', async ({ page }) => {
    await mount(page, 'popup', { settings: { theme: 'light' } });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('#chatInfoCard')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await page.locator('#btnThemeToggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect((await read(page, 'settings')).theme).toBe('dark');
});

test('UI v2: Light mode styles the Tour', async ({ page }) => {
    await mount(page, 'options', { settings: { theme: 'light' } }, '?startTour=1');
    await expect(page.locator('.tour-popover')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('UI v2: Light Badge does not modify Gemini page theme', async ({ page }) => {
    await mount(page, 'badge', { settings: { theme: 'light' } });
    await expect(page.locator('#geminiExportBadge')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('#geminiExportBadge')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light');
});

test('UI v2: Popup blocks unknown context, supports index-less trusted key and partial result', async ({ page }) => {
    await mount(page,'popup',{indexes:[],partial:true}); await expect(page.locator('#btnCurrent')).toBeEnabled();
    await page.locator('#btnCurrent').click(); await expect(page.locator('#status')).toContainText('some content is missing');
    await page.evaluate(()=>{(window as any).harness.noContext=true;}); await page.locator('#btnCurrent').click();
    await expect(page.locator('#btnCurrent')).toBeDisabled(); expect((await read(page,'exports')).length).toBe(1);
});
test('UI v2: account switch clears selection and only selected current keys export; cancel waits for return', async ({ page }) => {
    await mount(page,'options',{holdExport:true});
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(9, 10, 16)');
    await expect(page.locator('.card-left')).toBeVisible();
    await expect(page.locator('.card-right')).toBeVisible();
    for (const id of ['progWrap','exportFailureCard','logSection','btnImportTakeout']) {
        await expect(page.locator('#'+id)).toHaveCount(1);
    }
    await expect(page.locator('#takeoutImportModal')).toHaveCount(0);
    await expect(page.locator('#list .item')).toHaveCount(1);
    await expect(page.locator('#list img')).toHaveCount(0); await expect(page.locator('#btnExport')).toBeDisabled();
    await page.locator('#btnSelectAll').click(); await page.locator('#accountIdSelect').selectOption(B);
    await expect(page.locator('#btnExport')).toBeDisabled(); await expect(page.locator('#list')).toContainText('B chat');
    await page.locator('#btnSelectAll').click(); await page.locator('#btnExport').click();
    await expect(page.locator('#accountIdSelect')).toBeDisabled(); await page.locator('#btnCancel').click();
    await expect(page.locator('#accountIdSelect')).toBeDisabled(); await expect(page.locator('#status')).toHaveText('Cancelling…');
    await page.evaluate(()=>{(window as any).harness.finishExport();}); await expect(page.locator('#accountIdSelect')).toBeEnabled();
    expect((await read(page,'exports'))[0].keys).toEqual([{accountId:B,conversationId:'b'}]);
});
test('UI v2: Takeout prompts at 151 committed records regardless of Scan reason', async ({ page }) => {
    await mount(page,'options',{accounts:[],indexes:[],holdScan:true}); await expect(page.locator('#btnSyncAll')).toBeEnabled();
    await page.locator('#btnSyncAll').click(); await expect(page.locator('#status')).toHaveText('Committed 2 pages, 150 source entries');
    expect(await read(page,'scans')).toEqual([{accountId:A}]);
    await page.evaluate(()=>{(window as any).harness.finishScan();});
    await expect(page.locator('#btnSyncAll')).toBeEnabled();
    await expect(page.locator('.tour-popover')).toHaveCount(0);
    await page.evaluate(()=>{Object.assign((window as any).harness,{holdScan:false,scanCount:151});});
    await page.locator('#btnSyncAll').click();
    await expect(page.locator('.tour-popover')).toContainText('This scan fetched 151 conversations');
    expect((await read(page,'patches')).length).toBe(0);
    await page.getByRole('button',{name:'Got it, don’t show again'}).click();
    await expect(page.locator('.tour-popover')).toHaveCount(0);
    expect(await read(page,'patches')).toContainEqual({takeoutPromptCompleted:true});
    await page.locator('#btnSyncAll').click();
    await expect(page.locator('.tour-popover')).toHaveCount(0);
});
test('UI v2: settings preserve Live Save intent, record cleanup never deletes conversations', async ({ page }) => {
    await mount(page,'options'); await expect(page.locator('#liveSaveDiskToggle')).toBeChecked();
    await page.locator('#format').selectOption('pdf'); await expect(page.locator('#liveSaveDiskToggle')).toBeDisabled();
    await expect(page.locator('#liveSaveDiskToggle')).toBeChecked(); await page.locator('#format').selectOption('markdown');
    await expect(page.locator('#liveSaveDiskToggle')).toBeEnabled(); await expect(page.locator('#liveSaveDiskToggle')).toBeChecked();
    page.on('dialog',dialog=>dialog.accept()); await page.locator('#btnClearScan').click();
    await expect(page.locator('#status')).toHaveText('Records cleared'); expect(await read(page,'clears')).toEqual([['scan',A]]);
    await expect(page.locator('#list .item')).toHaveCount(1); expect((await read(page,'settings')).enabledDisk).toBe(true);
});
test('UI v2: Takeout file input directly imports into current account and reports partial', async ({ page }) => {
    await mount(page,'options'); await page.locator('#accountIdSelect').selectOption(B);
    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('#btnImportTakeout').click();
    const chooser = await chooserPromise;
    await chooser.setFiles({name:'Takeout.zip',mimeType:'application/zip',buffer:Buffer.from('fixture')});
    await expect(page.locator('#status')).toHaveText('Imported 2 conversations (partial)');
    expect(await read(page,'imports')).toEqual([B]); expect(await read(page,'patches')).toContainEqual({takeoutPromptCompleted:true});
});
test('UI v2: real Tour hit testing, stale delays, feedback close, and no persistent Tour fields', async ({ page }) => {
    await mount(page,'options',{},'?startTour=1'); await expect(page).toHaveURL('https://ui.test/');
    await expect(page.locator('.tour-popover h2')).toHaveText('Scan conversations');
    // Highlighted scan is a real business click and advances without awaiting completion.
    await page.locator('#btnSyncAll').click(); await expect(page.locator('.tour-popover h2')).toHaveText('Select conversations');
    expect((await read(page,'scans')).length).toBe(1);
    await page.locator('#list input').check(); await page.getByRole('button',{name:'Next',exact:true}).click();
    await page.waitForTimeout(350); await expect(page.locator('.tour-popover h2')).toHaveText('Choose a format');
    // Clicking an unrelated button is intercepted, closes the Tour and does not export.
    const rect = await page.locator('#btnExport').boundingBox(); await page.mouse.click(rect!.x+5,rect!.y+5);
    await expect(page.locator('.tour-popover')).toHaveCount(0); expect(await read(page,'exports')).toEqual([]);
    await page.locator('#btnTourGuide').click(); await expect(page.locator('.tour-popover')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.locator('.tour-overlay-container')).toHaveCount(0);
    expect(await read(page,'patches')).toEqual([]);
});
test('UI v2: Badge isolates account counts, rejects delayed old count, partial persists until timeout, keyboard opens Options', async ({ page }) => {
    await mount(page,'badge',{holdCount:true});
    await expect(page.locator('#geminiExportBadge')).toContainText('Count unavailable');
    await page.evaluate(async (id) => {const w=window as any; w.harness.source=id;w.harness.holdCount=false;await w.badge.refreshAccount();},B);
    await expect(page.locator('#geminiExportBadge')).toContainText('0 conversations indexed');
    await page.evaluate(()=>{(window as any).harness.finishCount({ok:true,count:9});});
    await expect(page.locator('#geminiExportBadge')).toContainText('0 conversations indexed');
    await page.evaluate(()=>{const w=window as any;w.badge.showLiveSaveResult({exported:1,partial:1,failed:[],skipped:0,aborted:false},w.harness.source);});
    await expect(page.locator('#geminiExportBadge')).toContainText('Some content was not saved');
    await page.evaluate(()=>{const w=window as any; w.badge.showLiveSaveResult(null,w.harness.source);});
    await expect(page.locator('#geminiExportBadge')).toContainText('Some content was not saved');
    await expect(page.locator('#geminiExportBadge')).toContainText('0 conversations indexed',{timeout:4000});
    expect(await read(page,'countRequests')).toBe(2);
    await page.locator('#geminiExportBadge').focus(); await page.keyboard.press('Enter'); expect(await read(page,'events')).toContain('openOptions');
});
test('UI v2: Badge owns visibility-triggered count Pull without exposing a Runtime push callback', async ({ page }) => {
    await mount(page, 'badge');
    await expect(page.locator('#geminiExportBadge')).toContainText('9 conversations indexed');
    expect(await read(page, 'countRequests')).toBe(1);
    expect(await page.evaluate(() => typeof (window as any).badge.refreshIndexCount)).toBe('undefined');
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await read(page, 'countRequests')).toBe(1);
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => read(page, 'countRequests')).toBe(2);
    await expect(page.locator('#geminiExportBadge')).toContainText('9 conversations indexed');
});
test('UI v2: Badge drag sends position to Runtime on pointerup, ignores ordinary clicks and resizes', async ({ page }) => {
    await mount(page,'badge'); await expect(page.locator('#geminiExportBadge')).toContainText('9 conversations indexed');
    await expect(page.locator('#geminiExportBadge .pulse')).toHaveCount(1);
    await expect(page.locator('#geminiExportBadge')).toHaveCSS('background-color', 'rgb(15, 16, 26)');
    const badge=page.locator('#geminiExportBadge'); const before=await badge.boundingBox();
    await page.mouse.move(before!.x+15,before!.y+10);await page.mouse.down();await page.mouse.move(before!.x-100,before!.y-80);
    expect(await read(page,'patches')).toEqual([]);await page.mouse.up();
    const updates=(await read(page,'messages')).filter((m: {action: string})=>m.action==='updateBadgePosition');
    expect(updates).toHaveLength(1); expect(updates[0].position).toMatchObject({left: expect.any(Number), top: expect.any(Number)});
    expect(await read(page,'patches')).toEqual([]);
    expect(await read(page,'events')).not.toContain('openOptions');
    await page.setViewportSize({width:900,height:700});
    expect((await read(page,'messages')).filter((m: {action: string})=>m.action==='updateBadgePosition')).toHaveLength(1);
    await badge.click(); expect(await read(page,'events')).toContain('openOptions');
    expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([]);
});
test('UI v2: Connect opens Gemini only on explicit action, manual Next and closing never persist Tour state', async ({ page }) => {
    await mount(page,'options',{tabs:[]},'?startTour=1');
    await expect(page.locator('.tour-popover h2')).toHaveText('Connect Gemini');
    expect(await read(page,'events')).not.toContain('open');
    await page.getByRole('button',{name:'Open Gemini',exact:true}).click(); expect(await read(page,'events')).toContain('open');
    await page.getByRole('button',{name:'Next',exact:true}).click(); await expect(page.locator('.tour-popover h2')).toHaveText('Scan conversations');
    await page.getByRole('button',{name:'Skip',exact:true}).click(); await expect(page.locator('.tour-popover')).toHaveCount(0);
    expect(await read(page,'patches')).toEqual([]);
});
test('UI v2: final Tutorial button closes without opening feedback, actual feedback link opens only once', async ({ page }) => {
    await mount(page,'options');
    const lastStep = async () => {
        await page.locator('#btnTourGuide').click();
        await expect(page.locator('.tour-popover h2')).toHaveText('Scan conversations');
        for (let i=0;i<5;i++) await page.getByRole('button',{name:'Next',exact:true}).click();
        await expect(page.locator('.tour-popover h2')).toHaveText('Optional feedback');
    };
    await lastStep(); await page.getByRole('button',{name:'Start using',exact:true}).click();
    await expect(page.locator('.tour-overlay-container')).toHaveCount(0);
    expect(page.context().pages()).toHaveLength(1);
    await lastStep(); const popup = page.waitForEvent('popup'); await page.locator('#feedbackBox').click();
    const feedback = await popup; await expect(page.locator('.tour-overlay-container')).toHaveCount(0); await feedback.close();
    expect(await read(page,'patches')).toEqual([]);
});
