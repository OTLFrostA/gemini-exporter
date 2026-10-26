import { test, expect } from '@playwright/test';
import { mount, read, A, B } from '../helpers/uiPortHarness';

test('Popup Options navigation follows a verified account even without an open conversation', async ({ page }) => {
    page.on('pageerror', error => console.error('DIAG popup pageerror:', error.stack));
    await mount(page, 'popup', {
        contextReply: { ok: true, accountContext: { accountId: B, providerId: 'gemini' }, conversationId: null },
    });
    await expect(page.locator('#btnCurrent')).toBeDisabled();
    await page.locator('#btnOptions').click();
    console.error('DIAG popup:', JSON.stringify({ requests: await read(page, 'tabRequests'), events: await read(page, 'events'), status: await page.locator('#status').textContent(), messages: await read(page, 'messages') }));
    await expect.poll(async () => read(page, 'messages')).toContainEqual({ action: 'openOptions', accountId: B });
});

test('Popup still opens Options without source selection when account context is unavailable', async ({ page }) => {
    await mount(page, 'popup', { noContext: true });
    await page.locator('#btnOptions').click();
    await expect.poll(async () => read(page, 'messages'))
        .toContainEqual({ action: 'openOptions', accountId: null });
});

test('Content Badge passes its current account when opening Options', async ({ page }) => {
    await mount(page, 'badge', { source: B });
    await page.locator('#geminiExportBadge').click();
    await expect.poll(async () => read(page, 'messages')).toContainEqual({ action: 'openOptions', accountId: B });
});

test('Options applies a one-time source handoff on load and reuse, but not while exporting', async ({ page }) => {
    page.on('pageerror', error => console.error('DIAG options pageerror:', error.stack));
    await mount(page, 'options', { initialOpenOptionsAccountId: B, holdExport: true });
    console.error('DIAG options:', JSON.stringify({ events: await read(page, 'events'), initialAccountId: await page.locator('#accountIdSelect').inputValue(), messages: await read(page, 'messages'), status: await page.locator('#status').textContent() }));
    const selector = page.locator('#accountIdSelect');
    await expect(selector).toHaveValue(B);
    await expect.poll(async () => page.evaluate(() => chrome.storage.session.get('openOptionsAccountId')))
        .toEqual({ openOptionsAccountId: null });

    await page.evaluate(id => Reflect.get(window, 'harness').openOptionsFor(id), A);
    await expect(selector).toHaveValue(A);
    await page.locator('#btnSelectAll').click();
    await page.locator('#btnExport').click();
    await expect(page.locator('body')).toHaveAttribute('data-busy', 'true');

    await page.evaluate(id => Reflect.get(window, 'harness').openOptionsFor(id), B);
    await expect(selector).toHaveValue(A);
    await page.evaluate(() => Reflect.get(window, 'harness').finishExport());
    await expect(page.locator('body')).toHaveAttribute('data-busy', 'false');
    await expect(selector).toHaveValue(A);
});

test('UI v2: Popup four formats use one request, preserve enabledDisk, include assets and never skip', async ({ page }) => {
    await mount(page, 'popup');
    // Product contract: the dark card/tabs layout survives the v2 service migration with the new Linear-inspired palette.
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(16, 16, 17)');
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
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(16, 16, 17)');
});


test('UI v2: appearance stays switchable during long-running scan and export', async ({ page }) => {
    await mount(page, 'options', { holdScan: true, holdExport: true });
    const theme = page.locator('#btnThemeToggle');
    await page.locator('#btnSyncAll').click();
    await expect(page.locator('body')).toHaveAttribute('data-busy', 'true');
    await expect(theme).toBeEnabled();
    await theme.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 247, 252)');
    await expect.poll(async () => (await read(page, 'settings')).theme).toBe('light');
    await page.evaluate(() => (window as any).harness.finishScan());
    await expect(page.locator('body')).toHaveAttribute('data-busy', 'false');

    await page.locator('#btnSelectAll').click();
    await page.locator('#btnExport').click();
    await expect(page.locator('body')).toHaveAttribute('data-busy', 'true');
    await expect(theme).toBeEnabled();
    await theme.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(async () => (await read(page, 'settings')).theme).toBe('dark');
    await expect.poll(async () => (await read(page, 'exports')).length).toBe(1);
    await page.evaluate(() => (window as any).harness.finishExport());
    await expect(page.locator('body')).toHaveAttribute('data-busy', 'false');
});

test('UI v2: Popup theme switch works while an export is running', async ({ page }) => {
    await mount(page, 'popup', { holdExport: true });
    const theme = page.locator('#btnThemeToggle');
    await page.locator('#btnCurrent').click();
    await expect(page.locator('#btnCurrent')).toBeDisabled();
    await expect(theme).toBeEnabled();
    await theme.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 247, 252)');
    await expect.poll(async () => (await read(page, 'settings')).theme).toBe('light');
    await expect.poll(async () => (await read(page, 'exports')).length).toBe(1);
    await page.evaluate(() => (window as any).harness.finishExport());
    await expect(page.locator('#btnCurrent')).toBeEnabled();
    await expect(theme).toBeEnabled();
});

test('UI v2: Dev switch uses left ON and right OFF beside its left label in both themes', async ({ page }) => {
    await mount(page, 'options', { settings: { theme: 'light', developerMode: false } });
    const toggle = page.locator('#devToggle');
    const label = page.locator('#labelDevMode');
    const knobX = () => toggle.evaluate(input =>
        Math.round(new DOMMatrixReadOnly(getComputedStyle(input, '::after').transform).m41));

    // Only Dev is inverted: the label remains on the left next to the checked knob.
    expect(await label.evaluate(el => {
        const input = document.getElementById('devToggle');
        return !!input && el.getBoundingClientRect().right <= input.getBoundingClientRect().left;
    })).toBe(true);
    await expect(toggle).toHaveAccessibleName('Dev');
    await expect(toggle).toBeEnabled();

    for (const theme of ['light', 'dark']) {
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(toggle).not.toBeChecked();
        await expect.poll(knobX).toBe(14); // OFF: knob on right.
        await expect(toggle).toHaveCSS('background-image', 'none');
        await expect(page.locator('body')).not.toHaveClass(/dev-mode/);

        await expect(toggle).toBeEnabled();
        await label.click();
        await expect(toggle).toBeChecked();
        await expect.poll(knobX).toBe(0); // ON: knob moves left, towards Dev.
        if (theme === 'light') {
            // Keep the original light gradient; dark mode deliberately uses a flat indigo accent.
            await expect(toggle).toHaveCSS('background-image', /linear-gradient/);
        } else {
            await expect(toggle).toHaveCSS('background-image', 'none');
            await expect(toggle).toHaveCSS('background-color', 'rgb(94, 106, 210)');
        }
        await expect(page.locator('body')).toHaveClass(/dev-mode/);
        await expect.poll(async () => (await read(page, 'settings')).developerMode).toBe(true);

        await expect(toggle).toBeEnabled();
        await label.click();
        await expect(toggle).not.toBeChecked();
        await expect.poll(knobX).toBe(14);
        await expect(page.locator('body')).not.toHaveClass(/dev-mode/);
        await expect.poll(async () => (await read(page, 'settings')).developerMode).toBe(false);

        if (theme === 'light') {
            await expect(toggle).toHaveCSS('background-color', 'rgb(203, 213, 225)');
            await page.locator('#btnThemeToggle').click();
        }
    }
});

test('UI v2: radio delivery gates aligned folder picker and Live Save without losing intent', async ({ page }) => {
    await mount(page, 'options', { settings: { enabledDisk: false } });
    const browser = page.locator('input[name="delivery"][value="browserDownload"]');
    const folder = page.locator('input[name="delivery"][value="folderWriter"]');
    const live = page.locator('#liveSaveDiskToggle');
    const picker = page.locator('#btnSetDir');
    const details = page.locator('#localFolderControls');

    await expect(page.locator('.delivery-card')).toHaveCount(2);
    await expect(page.locator('.delivery-card')).toContainText(['Browser download', 'Save to local folder']);
    await expect(browser).toBeChecked();
    await expect(folder).not.toBeChecked();
    await expect(details).toBeVisible();
    await expect(details).toHaveClass(/is-disabled/);
    await expect(details).toHaveCSS('opacity', '0.45');
    await expect(picker).toBeDisabled();
    await expect(live).toBeDisabled();
    await expect(page.locator('#skipExported')).toBeChecked();

    // Both dependent settings use the same left indentation.
    const offsets = await page.evaluate(() => {
        const left = (id: string) => document.getElementById(id)!.getBoundingClientRect().left;
        return [left('dirBox'), left('liveSaveControls')];
    });
    expect(Math.abs(offsets[0] - offsets[1])).toBeLessThan(2);

    await folder.check();
    await expect(folder).toBeChecked();
    await expect(details).not.toHaveClass(/is-disabled/);
    await expect(picker).toBeEnabled();
    await expect(live).toBeDisabled(); // A folder must be authorized before enabling Live Save.
    await expect.poll(async () => (await read(page, 'settings')).exportDelivery).toBe('folderWriter');

    await picker.click();
    await expect(page.locator('#dirLabel')).toHaveText('Chosen folder');
    await expect(page.locator('#dirPermissionLabel')).toHaveText('Authorized');
    await expect(live).toBeEnabled();
    await live.check();
    await expect(page.locator('#liveSaveStatus')).toHaveText('Live Save active');

    await page.locator('#btnSelectAll').check();
    await page.locator('#btnExport').click();
    await expect.poll(async () => (await read(page, 'exports'))[0]?.delivery).toBe('folderWriter');
    await browser.check();
    await expect(browser).toBeChecked();
    await expect(details).toHaveClass(/is-disabled/);
    await expect(picker).toBeDisabled();
    await expect(live).toBeDisabled();
    await expect(live).toBeChecked(); // Paused, not turned off.
    await expect(page.locator('#liveSaveStatus')).toContainText('Paused');
    await expect.poll(async () => (await read(page, 'settings')).exportDelivery).toBe('browserDownload');
    await expect.poll(async () => (await read(page, 'settings')).enabledDisk).toBe(true);
    expect(await read(page, 'events')).toContain('picker');

    await page.locator('#btnSelectAll').check();
    await page.locator('#btnExport').click();
    await expect.poll(async () => (await read(page, 'exports'))[1]?.delivery).toBe('browserDownload');

    await folder.check();
    await expect(live).toBeEnabled();
    await expect(page.locator('#liveSaveStatus')).toHaveText('Live Save active');
    await page.locator('#format').selectOption('pdf');
    await expect(live).toBeDisabled();
    await expect(live).toBeChecked();
    await expect(page.locator('#liveSaveStatus')).toContainText('Paused');
    await page.locator('#format').selectOption('markdown');
    await expect(live).toBeEnabled();
    await expect(page.locator('#liveSaveStatus')).toHaveText('Live Save active');
    await live.uncheck();
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
    await page.locator('#btnCurrent').click(); await expect(page.locator('#status')).toContainText('Other incomplete conversations: 1');
    await page.evaluate(()=>{(window as any).harness.noContext=true;}); await page.locator('#btnCurrent').click();
    await expect(page.locator('#btnCurrent')).toBeDisabled(); expect((await read(page,'exports')).length).toBe(1);
});
test('UI v2: account switch clears selection and only selected current keys export; cancel waits for return', async ({ page }) => {
    await mount(page,'options',{holdExport:true});
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(16, 16, 17)');
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
    await mount(page,'options',{indexes:[],holdScan:true}); await expect(page.locator('#btnSyncAll')).toBeEnabled();
    await page.locator('#btnSyncAll').click(); await expect(page.locator('#status')).toHaveText('Committed 2 pages, 150 source entries');
    expect(await read(page,'scans')).toEqual([{accountId:A}]);
    await page.evaluate(()=>{(window as any).harness.finishScan();});
    await expect(page.locator('#btnSyncAll')).toBeEnabled();
    await expect(page.locator('.tour-popover')).toHaveCount(0);
    await page.evaluate(()=>{Object.assign((window as any).harness,{holdScan:false,scanCount:151});});
    await page.locator('#btnSyncAll').click();
    await expect(page.locator('.tour-popover')).toContainText('This scan fetched 151 conversations');
    await expect.poll(async () => read(page, 'patches')).toContainEqual({takeoutPromptCompleted:true});
    await page.getByRole('button',{name:'Got it, don’t show again'}).click();
    await expect(page.locator('.tour-popover')).toHaveCount(0);
    expect(await read(page,'patches')).toContainEqual({takeoutPromptCompleted:true});
    await page.locator('#btnSyncAll').click();
    await expect(page.locator('.tour-popover')).toHaveCount(0);
});
test('UI v2: settings preserve Live Save intent while scan reset clears local conversations', async ({ page }) => {
    await mount(page,'options', { directoryName: 'MyVault', settings: { exportDelivery: 'folderWriter' } }); await expect(page.locator('#liveSaveDiskToggle')).toBeChecked();
    await page.locator('#format').selectOption('pdf');
    await expect(page.locator('#liveSaveDiskToggle')).toBeDisabled();
    await expect(page.locator('#liveSaveDiskToggle')).toBeChecked();
    await expect(page.locator('#liveSaveStatus')).toContainText('Paused');
    await page.locator('#format').selectOption('markdown');
    await expect(page.locator('#liveSaveDiskToggle')).toBeEnabled(); await expect(page.locator('#liveSaveDiskToggle')).toBeChecked();
    await page.locator('#btnMoreActions').click(); await page.locator('#btnClearScan').click(); await page.locator('#btnCleanupConfirm').click();
    await expect(page.locator('#status')).toHaveText('Records cleared'); expect(await read(page,'clears')).toEqual([['scan',A]]);
    await expect(page.locator('#list .item')).toHaveCount(0); expect((await read(page,'settings')).enabledDisk).toBe(true);
});
test('UI v2: Takeout file input directly imports into current account and reports partial', async ({ page }) => {
    await mount(page,'options'); await page.locator('#accountIdSelect').selectOption(B);
    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('#btnMoreActions').click();
    await page.locator('#btnImportTakeout').click();
    const chooser = await chooserPromise;
    await chooser.setFiles({name:'Takeout.zip',mimeType:'application/zip',buffer:Buffer.from('fixture')});
    await expect(page.locator('#status')).toHaveText('Imported 2 conversations (partial)');
    expect(await read(page,'imports')).toEqual([B]); expect(await read(page,'patches')).toContainEqual({takeoutPromptCompleted:true});
});
test('UI v2: real Tour hit testing, stale delays, feedback close, and no persistent Tour fields', async ({ page }) => {
    await mount(page,'options',{},'?startTour=1'); await expect(page).toHaveURL('https://ui.test/');
    await expect(page.locator('.tour-popover h2')).toHaveText('Authorize AI platforms');
    await page.locator('#tourNextBtn').click();
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
test('UI v2: authorization uses one selected-platform action and closing never persists Tour state', async ({ page }) => {
    await mount(page,'options',{tabs:[],geminiAccess:false},'?startTour=1');
    await expect(page.locator('.tour-popover h2')).toHaveText('Authorize AI platforms');
    await expect(page.locator('#tourNextBtn')).toBeDisabled();
    for (const platform of ['Gemini','ChatGPT','Claude'])
        await expect(page.getByRole('checkbox',{name:platform,exact:true})).toBeChecked();
    await page.getByRole('checkbox',{name:'ChatGPT',exact:true}).uncheck();
    await page.getByRole('checkbox',{name:'Claude',exact:true}).uncheck();
    await page.getByRole('checkbox',{name:'Grok',exact:true}).uncheck();
    await page.getByRole('button',{name:'Authorize',exact:true}).click();
    await expect(page.locator('#tourNextBtn')).toBeEnabled();
    expect(await read(page,'connectionRequests')).toEqual([[['gemini'],true]]);
    expect(await read(page,'events')).not.toContain('open');
    await page.locator('#tourNextBtn').click();
    await expect(page.locator('.tour-popover h2')).toHaveText('Scan conversations');
    await page.getByRole('button',{name:'Skip',exact:true}).click();
    expect(await read(page,'patches')).toEqual([]);
});
test('UI v2: final Tutorial button closes without opening feedback, actual feedback link opens only once', async ({ page }) => {
    await mount(page,'options');
    const lastStep = async () => {
        await page.locator('#btnTourGuide').click();
        await expect(page.locator('.tour-popover h2')).toHaveText('Authorize AI platforms');
        await page.locator('#tourNextBtn').click();
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

for (const mode of ['scan','export'] as const) test(`UI v2: ${mode} stop button is below the progress bar`, async ({page}) => {
    await mount(page,'options',{holdScan:true,holdExport:true});
    if (mode === 'export') {
        await page.locator('#btnSelectAll').click();
        await page.locator('#btnExport').click();
    } else await page.locator('#btnSyncAll').click();
    const stop = page.locator(mode === 'scan' ? '#btnStopScan' : '#btnCancel');
    await expect(stop).toBeVisible();
    await expect(stop).toBeInViewport();
    const bar = await page.locator('#progWrap').boundingBox();
    const button = await stop.boundingBox();
    expect(bar).toBeTruthy(); expect(button).toBeTruthy();
    expect(button!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height);
    await page.screenshot({path:`tests/output/visual_audit/${mode}-stop-below-progress.png`});
    await stop.click();
    await expect(page.locator('#status')).toHaveText('Cancelling…');
    await page.evaluate(mode => { const h = Reflect.get(window,'harness'); if (mode === 'scan') h.finishScan(); else h.finishExport(); },mode);
    await expect(stop).toBeHidden();
});


test('UI v2: committed scan pages appear before completion and preserve selection', async ({ page }) => {
    await mount(page, 'options', { holdScan: true });
    await page.locator('#btnSelectAll').click();
    await page.locator('#btnSyncAll').click();
    await expect(page.locator('body')).toHaveAttribute('data-busy', 'true');
    for (let pageNumber = 3; pageNumber <= 4; pageNumber++) {
        await page.evaluate(async ({ accountId, pageNumber }) => {
            const h = (window as any).harness;
            h.indexes.push({ key: { accountId, conversationId: `scanned-${pageNumber}` },
                title: `Committed page ${pageNumber}`, updatedAt: pageNumber + 10 });
            h.scanProgress({ pagesFetched: pageNumber, conversationsFetched: pageNumber * 50 });
            h.domainListener(accountId);
        }, { accountId: A, pageNumber });
        await expect(page.locator('#list')).toContainText(`Committed page ${pageNumber}`);
        await expect(page.locator('body')).toHaveAttribute('data-busy', 'true');
        await expect(page.locator('#btnStopScan')).toBeVisible();
    }
    await expect(page.locator('#list input[type="checkbox"]:checked')).toHaveCount(1);
    await page.evaluate(() => (window as any).harness.finishScan());
    await expect(page.locator('body')).toHaveAttribute('data-busy', 'false');
    await expect(page.locator('#list')).toContainText('Committed page 3');
    await expect(page.locator('#list')).toContainText('Committed page 4');
});
