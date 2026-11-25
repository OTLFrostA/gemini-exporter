import { test, expect, seedRegistryAccounts } from './fixtures';
import { accountId, exposeUIStorage, openOptions, seedConversations, storedSettings } from './uiFixture';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const JSZip = require(path.resolve(__dirname, '../../lib/jszip.min.js'));
test.beforeEach(async({context,extensionId})=>{void extensionId;await seedRegistryAccounts(context);});
test('conversation checkboxes are named by their displayed titles in both languages', async ({context, extensionId}) => {
    const page = await openOptions(context, extensionId);
    const rows = [{id:'quantum',title:'Quantum computing'}, {id:'architecture',title:'AI 架构与设计模式'}, {id:'untitled'}];
    await seedConversations(page, rows);
    for (const language of ['en', 'zh']) {
        await page.locator('#langToggle').setChecked(language === 'en');
        const list = page.locator('#list');
        await expect(list.getByRole('checkbox')).toHaveCount(rows.length);
        for (const row of rows) {
            const title = row.title || row.id;
            await expect(list.locator(`[data-chat-id="${row.id}"] .chat-title`)).toHaveText(title);
            await expect(list.getByRole('checkbox', {name:`${language === 'en' ? 'Select' : '选择'} ${title}`, exact:true})).toHaveCount(1);
        }
    }
});
test('workbench list preserves explicit selection across row clicks, search and language changes',async({context,extensionId})=>{
    const page=await openOptions(context,extensionId);
    await seedConversations(page,[{id:'chat_001',title:'量子计算的基本原理'},{id:'chat_002',title:'AI 架构与设计模式'},{id:'chat_003',title:'Python 性能优化指南'}],{chat_001:{exportedAt:200,format:'markdown',status:'ok',chatTime:100}});
    await expect(page.locator('#list input:checked')).toHaveCount(0);
    await page.locator('#btnSelectAll').click();await expect(page.locator('#list input:checked')).toHaveCount(3);await expect(page.locator('#selectedStat')).toHaveText('3 of 3 selected');
    await page.locator('#btnSelectAll').click();await expect(page.locator('#list input:checked')).toHaveCount(0);
    const row=page.locator('[data-chat-id="chat_002"]');await row.locator('.chat-title').click();await expect(row.locator('input')).toBeChecked();
    await expect(page.locator('#btnSelectAll')).toHaveJSProperty('indeterminate',true);
    await row.locator('.chat-title').click();await expect(row.locator('input')).not.toBeChecked();
    await expect(page.locator('#btnSelectAll')).toHaveJSProperty('indeterminate',false);
    await page.locator('#chatSearchInput').fill('量子');await expect(page.locator('#list .item')).toHaveCount(1);await page.locator('#btnSelectAll').click();await expect(page.locator('#selectedStat')).toHaveText('1 of 3 selected');
    await page.locator('#chatSearchInput').fill('');await expect(page.locator('#list .item')).toHaveCount(3);
    for(const language of ['zh','en']) {await page.locator('#langToggle').setChecked(language==='en');await expect(page.locator('#btnSelectAll')).toHaveAttribute('aria-label',language==='zh'?'全选当前可见会话':'Select all visible conversations');await expect(page.locator('[data-chat-id="chat_001"] input')).toBeChecked();}
    await expect(page.locator('#feedbackBox')).toHaveAttribute('href','https://tally.so/r/Y56ZBB?source=extension');await expect(page.locator('#feedbackBox')).toHaveAttribute('target','_blank');await expect(page.locator('#feedbackBox')).toContainText('Send Feedback');
    await expect(page.locator('#btnSelectUpdated,#btnSelectUnexported,#btnFeedback')).toHaveCount(0);
});
test('list badges distinguish success, later activity, incomplete exports and missing records',async({context,extensionId})=>{
    const page=await openOptions(context,extensionId);
    await seedConversations(page,[{id:'fresh'},{id:'exported'},{id:'updated',updatedAt:300},{id:'partial'},{id:'partial_updated',updatedAt:300},{id:'no-record'},{id:'empty'}],{
        exported:{exportedAt:200,format:'markdown',status:'ok',chatTime:100},
        updated:{exportedAt:200,format:'html',status:'ok',chatTime:100},
        partial:{exportedAt:200,format:'markdown',status:'partial',chatTime:100},
        partial_updated:{exportedAt:200,format:'json',status:'partial',chatTime:100}
    });
    for(const id of ['fresh','no-record','empty']) {
        await expect(page.locator(`[data-chat-id="${id}"] .status-tag`)).toHaveCount(0);
        await expect(page.locator(`[data-chat-id="${id}"] .meta`)).not.toContainText('No export record');
    }
    await expect(page.locator('[data-chat-id="exported"] .status-exported')).toContainText(/^Export successful \(.+\)$/);
    await expect(page.locator('[data-chat-id="updated"] .status-updated')).toHaveText('Updated');
    await expect(page.locator('[data-chat-id="partial"] .status-partial')).toHaveText('Incomplete export');
    await expect(page.locator('[data-chat-id="partial_updated"] .status-partial')).toHaveText('Incomplete export');
    await expect(page.locator('[data-chat-id="updated"] .meta')).toContainText('Last export · html');
    await expect(page.locator('[data-chat-id="updated"] .meta')).not.toContainText('Updated');
    await expect(page.locator('#list input:checked')).toHaveCount(0);
    await expect(page.locator('.status-exported')).toHaveCount(1);
    await expect(page.locator('.status-updated')).toHaveCount(1);
    await expect(page.locator('.status-partial')).toHaveCount(2);
    await page.locator('[data-chat-id="partial"] input').check();
    await page.locator('#langToggle').uncheck();
    await expect(page.locator('[data-chat-id="partial"] input')).toBeChecked();
    await expect(page.locator('[data-chat-id="partial"] .status-partial')).toHaveText('导出不完整');
    await expect(page.locator('[data-chat-id="updated"] .status-updated')).toHaveText('有更新');
    await expect(page.locator('[data-chat-id="exported"] .status-exported')).toContainText(/^导出成功（.+）$/);
    await page.reload();
    await expect(page.locator('#list .item')).toHaveCount(7);
    await expect(page.locator('#list input:checked')).toHaveCount(0);
});

for (const permission of ['throws', 'pending'] as const) test(`saved conversations render after reload when folder permission ${permission}`, async ({context, extensionId}) => {
    const page = await openOptions(context, extensionId);
    await seedConversations(page, [{id:'reload-survivor', title:'Persisted conversation'}]);
    await page.evaluate(async () => {
        await Reflect.get(globalThis, 'uiFixture').setDirectoryHandle(await navigator.storage.getDirectory());
    });
    await page.addInitScript(permission => {
        Object.defineProperty(FileSystemHandle.prototype, 'queryPermission', { configurable: true,
            value: () => permission === 'throws'
                ? Promise.reject(new DOMException('Saved folder is unavailable', 'NotAllowedError'))
                : new Promise(() => {}) });
    }, permission);
    await page.reload();
    await expect(page.locator('[data-chat-id="reload-survivor"]')).toBeVisible();
    await expect(page.locator('#selectedStat')).toContainText('0 of 1');
    await page.locator('#btnSelectAll').click();
    await expect(page.locator('#btnExport')).toBeEnabled();
    if (permission === 'throws') await expect(page.locator('#status')).toContainText('Folder permission could not be restored');
});

test('a workbench opened without an account refreshes when the first account is admitted', async ({context, extensionId}) => {
    const seed = await openOptions(context, extensionId);
    await seed.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const r = indexedDB.open('gemini_exporter_v2'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
        });
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('accounts', 'readwrite'); tx.objectStore('accounts').clear();
            tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
        });
        db.close();
    });
    const waiting = await openOptions(context, extensionId);
    await expect(waiting.locator('#accountIdSelect option')).toHaveCount(0);
    await seed.evaluate(async () => {
        const api = Reflect.get(globalThis, 'uiFixture');
        const accountId = '10000000-0000-4000-8000-000000000001';
        await api.putAccount({id:accountId, providerId:'gemini', providerAccountId:'10000000001'});
        await api.putIndexes([{key:{accountId,conversationId:'first-admission'},title:'First admitted chat',titleSource:'provider',updatedAt:123}]);
    });
    const worker = context.serviceWorkers()[0];
    await worker.evaluate(() => chrome.runtime.sendMessage({action:'domainChanged',accountId:'10000000-0000-4000-8000-000000000001'}));
    await expect(waiting.locator('[data-chat-id="first-admission"]')).toBeVisible();
});

test('specific attachment failures retain details beneath one concise badge', async ({context, extensionId}, testInfo) => {
    const page = await openOptions(context, extensionId);
    const expired = {resourceId:'missing',name:'photo.png',code:'RESOURCE_LOCATOR_UNAVAILABLE',httpStatus:404,sourceUrl:'https://example.test/photo'};
    const download = {resourceId:'retry',name:'retry.png',code:'RESOURCE_DOWNLOAD_FAILED',httpStatus:503};
    const restricted = {resourceId:'private',name:'private.png',code:'RESOURCE_ACCESS_RESTRICTED',httpStatus:403};
    await seedConversations(page, [{id:'expired-only'}, {id:'mixed'}, {id:'restricted'}, {id:'text-incomplete'}, {id:'legacy-partial'}], {
        'expired-only':{exportedAt:200,format:'markdown',status:'partial',chatTime:100,attachmentIssues:[expired]},
        mixed:{exportedAt:200,format:'html',status:'partial',chatTime:100,attachmentIssues:[expired,download]},
        restricted:{exportedAt:200,format:'json',status:'partial',chatTime:100,attachmentIssues:[restricted]},
        'text-incomplete':{exportedAt:200,format:'html',status:'partial',chatTime:100,otherContentMissing:true,attachmentIssues:[expired]},
        'legacy-partial':{exportedAt:200,format:'pdf',status:'partial',chatTime:100},
    });
    const row = page.locator('[data-chat-id="expired-only"]');
    await expect(page.locator('.status-unavailable,.attachment-issues')).toHaveCount(0);
    await expect(page.locator('[data-chat-id="text-incomplete"] .status-partial')).toHaveText('Incomplete export');
    await page.locator('#devToggle').check();
    await expect(row.locator('.status-unavailable')).toHaveText('Some source attachments unavailable');
    await expect(row.locator('.status-partial')).toHaveCount(0);
    await page.locator('#btnThemeToggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(row.locator('.status-unavailable')).toHaveCSS('color', 'rgb(225, 189, 133)');
    await row.locator('summary').click();
    await expect(row.locator('input')).not.toBeChecked();
    await expect(row.locator('details')).toContainText('photo.png: Source attachment unavailable');
    await expect(row.locator('details')).toContainText('HTTP 404');
    await expect(row.locator('details a')).toHaveAttribute('href', 'https://example.test/photo');
    await expect(page.locator('[data-chat-id="mixed"] .status-unavailable')).toHaveText('Some attachments failed');
    await expect(page.locator('[data-chat-id="restricted"] .status-unavailable')).toHaveText('Some attachments failed');
    await expect(page.locator('[data-chat-id="text-incomplete"] .status-partial')).toHaveText('Incomplete export');
    await expect(page.locator('[data-chat-id="legacy-partial"] .status-partial')).toHaveText('Incomplete export');
    await page.locator('#langToggle').uncheck();
    await row.locator('summary').click();
    await expect(row.locator('details')).toContainText('来源附件无法获取');
    await expect(page.locator('[data-chat-id="mixed"] .status-unavailable')).toHaveText('部分附件获取失败');
    await expect(page.locator('[data-chat-id="text-incomplete"] .status-partial')).toHaveText('导出不完整');
    await page.screenshot({path:testInfo.outputPath('attachment-expiry.png'),fullPage:true});
    await page.reload();
    await expect(row.locator('.status-unavailable')).toHaveText('部分来源附件无法获取');
    await page.locator('#devToggle').uncheck();
    await expect(page.locator('.status-unavailable,.attachment-issues')).toHaveCount(0);
    await expect(page.locator('[data-chat-id="text-incomplete"] .status-partial')).toHaveText('导出不完整');
});


test('conversation row padding and gaps toggle selection without double-toggling controls', async ({context, extensionId}) => {
    const page = await openOptions(context, extensionId);
    await seedConversations(page, [{id:'click-target', title:'Click target'}]);
    const row = page.locator('[data-chat-id="click-target"]');
    const checkbox = row.locator('input');
    // The row advertises a pointer over its padding, outside the inner body.
    await row.click({position:{x:2,y:2}});
    await expect(checkbox).toBeChecked();
    await expect(page.locator('#selectedStat')).toHaveText('1 of 1 selected');
    await expect(page.locator('#btnExport')).toBeEnabled();
    await row.click({position:{x:2,y:2}});
    await expect(checkbox).not.toBeChecked();
    const gap = await row.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const input = element.querySelector('input');
        if (!input) throw new Error('Missing row checkbox');
        return {x:input.getBoundingClientRect().right - bounds.left + 2,y:10};
    });
    await row.click({position:gap});
    await expect(checkbox).toBeChecked();
    await checkbox.click();
    await expect(checkbox).not.toBeChecked();
    await checkbox.press('Space');
    await expect(checkbox).toBeChecked();
    await row.locator('.chat-title').click();
    await expect(checkbox).not.toBeChecked();
    const popup = page.waitForEvent('popup');
    await row.locator('.open-link').click();
    await (await popup).close();
    await expect(checkbox).not.toBeChecked();
});


for (const target of ['.chat-title', 'input']) test(`a background refresh between mouse down and up preserves a click on ${target}`, async ({context, extensionId}) => {
    const page = await openOptions(context, extensionId);
    await seedConversations(page, [{id:'pressed',title:'Pressed conversation'}, {id:'background',title:'Background conversation'}]);
    const row = page.locator('[data-chat-id="pressed"]');
    await row.locator(target).hover();
    await page.mouse.down();
    await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'uiFixture');
        const accountId = '10000000-0000-4000-8000-000000000001';
        const indexes = await api.listIndexes(accountId);
        await api.putIndexes(indexes.map((index: {key:{conversationId:string};title:string}) =>
            index.key.conversationId === 'background' ? {...index,title:'Background refreshed'} : index));
    });
    await context.serviceWorkers()[0].evaluate(() => chrome.runtime.sendMessage({action:'domainChanged',accountId:'10000000-0000-4000-8000-000000000001'}));
    await expect(page.locator('[data-chat-id="background"] .chat-title')).toHaveText('Background refreshed');
    await page.mouse.up();
    await expect(row.locator('input')).toBeChecked();
});

test('focus and unrelated storage changes avoid unchanged paints; notification bursts read once', async ({context, extensionId}) => {
    const page = await openOptions(context, extensionId);
    await seedConversations(page, [{id:'refresh-count',title:'Initial title'}]);
    await page.evaluate(() => {
        const metrics = {paints:0,accountReads:0,indexReads:0};
        Reflect.set(globalThis, 'refreshMetrics', metrics);
        const replace = Element.prototype.replaceChildren;
        Element.prototype.replaceChildren = function(...nodes) {
            if (this.id === 'accountIdSelect') metrics.paints++;
            return replace.apply(this, nodes);
        };
        const getAll = IDBObjectStore.prototype.getAll;
        IDBObjectStore.prototype.getAll = function(...args) {
            if (this.transaction.mode === 'readonly') {
                if (this.name === 'accounts') metrics.accountReads++;
                if (this.name === 'indexes') metrics.indexReads++;
            }
            return getAll.apply(this, args);
        };
    });
    const metrics = () => page.evaluate(() => ({...Reflect.get(globalThis, 'refreshMetrics')}));
    await page.evaluate(async () => {
        await chrome.storage.local.set({unrelated_refresh_probe:'changed'});
        await Reflect.get(globalThis, 'uiFixture').updateSettings({badgePosition:{left:10,top:20}});
        window.dispatchEvent(new Event('focus'));
    });
    await expect.poll(async () => (await metrics()).accountReads).toBeGreaterThan(0);
    await page.waitForTimeout(100);
    expect(await metrics()).toEqual({paints:0,accountReads:1,indexReads:1});

    await context.serviceWorkers()[0].evaluate(async () => {
        await Promise.all(Array.from({length:20}, () => chrome.runtime.sendMessage({action:'domainChanged',accountId:'10000000-0000-4000-8000-000000000002'})));
    });
    await expect.poll(async () => (await metrics()).accountReads).toBe(2);
    await page.waitForTimeout(100);
    expect(await metrics()).toEqual({paints:0,accountReads:2,indexReads:1});

    await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'uiFixture');
        const accountId = '10000000-0000-4000-8000-000000000001';
        await api.putIndexes([{key:{accountId,conversationId:'refresh-count'},title:'Updated title',titleSource:'provider',updatedAt:100}]);
        Object.assign(Reflect.get(globalThis, 'refreshMetrics'), {paints:0,accountReads:0,indexReads:0});
        window.dispatchEvent(new Event('focus'));
    });
    await expect(page.locator('[data-chat-id="refresh-count"] .chat-title')).toHaveText('Updated title');
    expect(await metrics()).toEqual({paints:1,accountReads:1,indexReads:1});
    await page.locator('#btnThemeToggle').click();
    await expect(page.locator('#btnThemeToggle')).toBeEnabled();
    // Theme's optimistic paint and unlock paint are enough; its own storage echo adds none.
    expect((await metrics()).paints).toBe(3);
});

test('repeated list refresh does not resurrect a verified deletion or display a removed archive-state notice', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    await seedConversations(page, [{ id: 'deleted_notice' }, { id: 'keep' }]);
    await page.evaluate(async id => Reflect.get(globalThis, 'uiFixture').ingestDeletedConversation(id, 'deleted_notice'), accountId);
    for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(page.locator('#list .item')).toHaveCount(1);
        await expect(page.locator('[data-chat-id="deleted_notice"],#archiveNotice')).toHaveCount(0);
    }
});

test('record cleanup requires confirmation and retains all bodies; a subsequent verified deletion removes only that conversation', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    await seedConversations(page, [{ id: 'one' }, { id: 'unlisted' }, { id: 'another' }], { one: { exportedAt: 100, format: 'markdown', status: 'ok' } });
    await expect(page.locator('#btnClearExported')).toBeHidden();
    await page.locator('#devToggle').check();
    await page.locator('#btnMoreActions').click();
    await expect(page.locator('#btnClearExported')).toBeVisible();
    await page.locator('#btnClearExported').click();
    await page.locator('#btnCleanupCancel').click();
    expect(Object.keys(await page.evaluate(id => Reflect.get(globalThis, 'uiFixture').listExportRecords(id), accountId))).toEqual(['one']);
    await page.locator('#btnMoreActions').click();
    await page.locator('#btnClearExported').click();
    await page.locator('#btnCleanupConfirm').click();
    await expect(page.locator('#status')).toHaveText('Records cleared');
    await expect(page.locator('#list .item')).toHaveCount(3);
    expect(await page.evaluate(id => Reflect.get(globalThis, 'uiFixture').listExportRecords(id), accountId)).toEqual({});
    await page.evaluate(async id => Reflect.get(globalThis, 'uiFixture').ingestDeletedConversation(id, 'another'), accountId);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('#list .item')).toHaveCount(2);
    expect(await page.evaluate(id => Reflect.get(globalThis, 'uiFixture').readConversation({ accountId: id, conversationId: 'unlisted' }), accountId)).toBeTruthy();
});

test('absence from a source list alone keeps local conversations and never manufactures deletion state', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    await seedConversations(page, [{ id: 'unlisted_notice' }, { id: 'active' }]);
    await page.evaluate(async id => Reflect.get(globalThis, 'uiFixture').ingestIndexes(id, [{ conversationId: 'active', fields: { title: 'Latest title', titleSource: 'provider' } }]), accountId);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('#list .item')).toHaveCount(2);
    await expect(page.locator('#archiveNotice,.cloud-status')).toHaveCount(0);
    await expect(page.locator('[data-chat-id="active"]')).toContainText('Latest title');
});

test('explicit scan reset clears the current local list and bodies only after confirmation', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    await seedConversations(page, [{ id: 'reset-one' }, { id: 'reset-two' }], { 'reset-one': { exportedAt: 100, format: 'markdown', status: 'ok' } });
    await page.locator('#btnMoreActions').click();
    await page.locator('#btnClearScan').click();
    await page.locator('#btnCleanupCancel').click();
    await expect(page.locator('#list .item')).toHaveCount(2);
    await page.locator('#btnMoreActions').click();
    await page.locator('#btnClearScan').click();
    await expect(page.locator('#cleanupPromptText')).toContainText('all local conversations');
    await page.locator('#btnCleanupConfirm').click();
    await expect(page.locator('#status')).toHaveText('Records cleared');
    await expect(page.locator('#list .item')).toHaveCount(0);
    for (const conversationId of ['reset-one', 'reset-two']) {
        expect(await page.evaluate(({ accountId, conversationId }) => Reflect.get(globalThis, 'uiFixture').readConversation({ accountId, conversationId }), { accountId, conversationId })).toBeNull();
    }
    expect(await page.evaluate(id => Reflect.get(globalThis, 'uiFixture').listExportRecords(id), accountId)).toEqual({});
    await page.reload();
    await expect(page.locator('#list .item')).toHaveCount(0);
});

test('Show reveals a selected conversation hidden by both search and export status', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    await seedConversations(page, [
        { id: 'orchard', title: 'Orchard planning' },
        { id: 'ocean', title: 'Ocean research' },
    ], { ocean: { format: 'markdown', exportedAt: 100, status: 'ok' } });
    const ocean = page.locator('[data-chat-id="ocean"] input');
    await ocean.check();

    const search = page.locator('#chatSearchInput');
    const status = page.locator('#chatFilterSelect');
    await status.selectOption('no_record');
    await expect(page.locator('#hiddenSelectionNotice')).toContainText('1 selected conversation hidden by filter');
    await expect(page.locator('#btnExport')).toBeEnabled();
    await search.fill('Orchard');
    await expect(ocean).toBeHidden();
    await expect(page.locator('#hiddenSelectionNotice')).toContainText('1 selected conversation hidden by search or filter');

    await page.locator('#btnShowHiddenSelection').click();
    await expect(ocean).toBeChecked();
    await expect(search).toHaveValue('');
    await expect(status).toHaveValue('all');
    await expect(page.locator('#hiddenSelectionNotice')).toBeHidden();

    await page.locator('[data-chat-id="orchard"] input').check();
    await status.selectOption('has_record');
    await expect(page.locator('#hiddenSelectionNotice')).toContainText('1 selected conversation hidden by filter');
    await page.locator('#btnDeselectHidden').click();
    await expect(page.locator('#hiddenSelectionNotice')).toBeHidden();
    await expect(page.locator('#selectedStat')).toHaveText('1 of 2 selected');
    await expect(status).toHaveValue('has_record');
    await expect(ocean).toBeChecked();
});

test('search preserves selection, explains hidden items and exports the full selection', async ({ context, extensionId }, testInfo) => {
    const page = await openOptions(context, extensionId);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedConversations(page, [
        { id: 'visible', title: 'Orchard planning', body: 'Visible selected conversation' },
        { id: 'hidden-one', title: 'Ocean research', body: 'Hidden selected conversation one' },
        { id: 'hidden-two', title: 'Mountain routes', body: 'Hidden selected conversation two' },
    ]);
    const notice = page.locator('#hiddenSelectionNotice');
    const search = page.locator('#chatSearchInput');
    await expect(notice).toBeHidden();
    await page.locator('#btnSelectAll').check();
    await search.fill('Orchard');
    await expect(page.locator('#list .item')).toHaveCount(1);
    await expect(page.locator('#selectedStat')).toHaveText('3 of 3 selected');
    await expect(notice).toContainText('2 selected conversations hidden by search');

    const pending = page.waitForEvent('download');
    await page.locator('#btnExport').click();
    const download = await pending;
    const destination = testInfo.outputPath('hidden-selection.zip');
    await download.saveAs(destination);
    const zip = await JSZip.loadAsync(await readFile(destination));
    const entries: string[] = Object.keys(zip.files).filter(name => name.endsWith('.md'));
    expect(entries).toHaveLength(3);
    const contents: string[] = await Promise.all(entries.map(name => zip.file(name).async('string')));
    for (const body of ['Visible selected conversation', 'Hidden selected conversation one', 'Hidden selected conversation two']) {
        expect(contents.join('\n')).toContain(body);
    }
    await expect(page.locator('#btnShowHiddenSelection')).toBeEnabled();
    await page.locator('#btnShowHiddenSelection').click();
    await expect(search).toHaveValue('');
    await expect(notice).toBeHidden();
    await expect(page.locator('#list input[type="checkbox"]:checked')).toHaveCount(3);
    await search.fill('no matches');
    await expect(notice).toContainText('3 selected conversations hidden by search');
    await search.fill('Orchard');
    await page.locator('#btnDeselectHidden').click();
    await expect(notice).toBeHidden();
    await expect(page.locator('#selectedStat')).toHaveText('1 of 3 selected');
    await expect(search).toHaveValue('Orchard');
    await search.fill('');
    await expect(page.locator('[data-chat-id="visible"] input')).toBeChecked();
    await expect(page.locator('[data-chat-id="hidden-one"] input')).not.toBeChecked();
    await expect(page.locator('[data-chat-id="hidden-two"] input')).not.toBeChecked();
    await search.fill('Ocean');
    await expect(page.locator('#hiddenSelectionText')).toHaveText('1 selected conversation hidden by search');
});

test('format picker is page-rendered and supports pointer, keyboard and dismissal', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    await page.setViewportSize({ width: 1280, height: 800 });
    const select = page.locator('#format');
    await expect(select).toHaveCSS('appearance', 'base-select');
    await select.click();
    const pdf = select.locator('option[value="pdf"]');
    await expect(pdf).toBeVisible();
    const box = await pdf.boundingBox();
    expect(box?.height).toBeGreaterThan(20);
    await mkdir('tests/output/visual_audit', { recursive: true });
    await page.screenshot({ animations: 'disabled', path: 'tests/output/visual_audit/format_picker_dark.png' });
    await pdf.click();
    await expect(select).toHaveValue('pdf');
    await expect.poll(async () => (await storedSettings(page)).defaultFormat).toBe('pdf');
    await expect.poll(() => select.evaluate(node => node.matches(':open'))).toBe(false);

    await select.click();
    await page.keyboard.press('Escape');
    await expect.poll(() => select.evaluate(node => node.matches(':open'))).toBe(false);
    await expect(select).toBeFocused();
    await expect(select).toHaveValue('pdf');

    await select.press('Space');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(select).toHaveValue('json');
    await expect.poll(async () => (await storedSettings(page)).defaultFormat).toBe('json');

    await select.click();
    await page.locator('h1').click();
    await expect.poll(() => select.evaluate(node => node.matches(':open'))).toBe(false);
    await expect(select).toHaveValue('json');
    await page.evaluate(async () => Reflect.get(globalThis, 'uiFixture').updateSettings({ theme: 'light' }));
    await select.click();
    await page.screenshot({ animations: 'disabled', path: 'tests/output/visual_audit/format_picker_light.png' });
    await page.keyboard.press('Escape');
    await page.close();
});

test('55-conversation browser delivery suggests folder once, then ZIP remains available and suppression survives reload', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    await seedConversations(page, Array.from({ length: 55 }, (_, i) => ({
        id: `bulk_${i}`, title: `Bulk ${i}`, body: `Bulk answer ${i}`,
    })));
    await page.locator('#btnSelectAll').click();
    await page.locator('#btnExport').click();

    const modal = page.locator('#directWriteModal');
    await expect(modal).toBeVisible();
    await expect(page.locator('#directWritePromptText')).toContainText('55 conversations');
    await expect(page.locator('#btnModalSwitchFolder')).toBeVisible();
    await expect(page.locator('#btnModalContinueZip')).toBeVisible();
    await expect.poll(async () => (await storedSettings(page)).directWritePromptCompleted).toBe(true);

    const pending = page.waitForEvent('download');
    await page.locator('#btnModalContinueZip').click();
    await expect(modal).toBeHidden();
    const file = await pending;
    expect(file.suggestedFilename()).toMatch(/\.zip$/);
    const zip = await JSZip.loadAsync(await readFile((await file.path())!));
    const files = Object.keys(zip.files).filter(x => x.endsWith('.md'));
    expect(files).toHaveLength(55);
    expect((await Promise.all(files.map(x => zip.file(x).async('string')))).join('\n')).toContain('Bulk answer 54');

    await expect(page.locator('#status')).toContainText('Successfully downloaded: 55', { timeout: 30000 });
    await expect.poll(async () => page.evaluate(async () =>
        Object.keys(await Reflect.get(globalThis, 'uiFixture')
            .listExportRecords('10000000-0000-4000-8000-000000000001')).length),
        { timeout: 30000 }).toBe(55);

    await page.reload();
    await expect(page.locator('#list .item')).toHaveCount(55);
    await page.locator('#btnSelectAll').click();
    await page.locator('#btnExport').click();
    await expect(page.locator('#status')).toContainText('Skipped: 55');
    await expect(modal).toBeHidden();
});

test('closing a displayed batch suggestion permanently dismisses it without starting an export', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    await seedConversations(page, Array.from({ length: 21 }, (_, i) => ({ id: `tip_${i}` })));
    await page.locator('#btnSelectAll').click();
    await page.locator('#btnExport').click();
    await expect(page.locator('#directWriteModal')).toBeVisible();
    await page.locator('#btnDirectWriteClose').click();
    await expect(page.locator('#directWriteModal')).toBeHidden();
    await expect.poll(async () => (await storedSettings(page)).directWritePromptCompleted).toBe(true);

    await page.reload();
    await expect(page.locator('#list .item')).toHaveCount(21);
    await exposeUIStorage(page);
    await page.locator('#btnSelectAll').click();
    const pending = page.waitForEvent('download');
    await page.locator('#btnExport').click();
    await pending;
    await expect(page.locator('#directWriteModal')).toBeHidden();
    await expect(page.locator('#status')).toContainText('Successfully downloaded: 21', { timeout: 30000 });
    await expect.poll(async () => page.evaluate(async () =>
        Object.keys(await Reflect.get(globalThis, 'uiFixture')
            .listExportRecords('10000000-0000-4000-8000-000000000001')).length),
        { timeout: 30000 }).toBe(21);
});
