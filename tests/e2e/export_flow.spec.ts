import { test, expect, seedRegistryAccounts } from './fixtures';
import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Download } from '@playwright/test';
import { accountId, exposeUIStorage, openOptions, seedConversations, storedSettings } from './uiFixture';
test.beforeEach(async({context,extensionId})=>{void extensionId;await seedRegistryAccounts(context);});
for (const language of ['en', 'zh'] as const) test(`single-conversation export progress uses correct ${language} counters`, async ({context,extensionId}, testInfo) => {
    const page = await openOptions(context, extensionId);
    await page.setViewportSize({width:1440,height:1100});
    await seedConversations(page, [{id:'one'}]);
    await page.locator('#devToggle').check();
    await page.locator('#includeAssets').check();
    await page.evaluate(async ({accountId,language}) => {
        const api = Reflect.get(globalThis, 'uiFixture');
        await api.ingestDetail(accountId, 'one', {
            savedAt:100, quality:{status:'complete'},
            assets:[{id:'file',kind:'file',name:'report.md',document:{contentMarkdown:'Report one'}}],
            messages:[{role:'user',content:[{type:'paragraph',children:[{type:'text',text:'Question one'}]}]},
                {role:'assistant',content:[{type:'file',assetId:'file'}]}],
        }, {title:'one',titleSource:'provider',updatedAt:100});
        await api.updateSettings({language});
    }, {accountId,language});
    await page.reload();
    // Keep the real record transaction open so the delivered progress remains observable.
    await page.evaluate(() => {
        Reflect.set(window, 'releaseExportRecord', false);
        const transaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function(...args) {
            const tx: IDBTransaction = Reflect.apply(transaction, this, args);
            if (args[1] === 'readwrite' && tx.objectStoreNames.contains('exportRecords')) {
                const keepAlive = () => {
                    if (!Reflect.get(window, 'releaseExportRecord'))
                        tx.objectStore('exportRecords').get('progress-test').onsuccess = keepAlive;
                };
                keepAlive();
            }
            return tx;
        };
    });
    await page.locator('#btnSelectAll').click();
    const download = page.waitForEvent('download');
    await page.locator('#btnExport').click();
    await download;
    try {
        await expect(page.locator('#progText')).toContainText(language === 'en' ? 'delivered 1' : '已交付正文 1');
        await page.waitForTimeout(250);
        await page.screenshot({path:testInfo.outputPath('progress.png'),fullPage:true});
        await expect(page.locator('#progText')).toHaveText(language === 'en'
            ? 'Prepared 1 conversation · delivered 1 document · downloaded 1 attachment'
            : '已准备 1 条会话 · 已交付正文 1 条 · 已下载 1 个附件');
    } finally {
        await page.evaluate(() => Reflect.set(window, 'releaseExportRecord', true));
    }
    await expect(page.locator('body')).toHaveAttribute('data-busy','false');
});
test('batch export delivers both physical bodies and refreshes recent ExportRecords',async({context,extensionId})=>{
    const page=await openOptions(context,extensionId);await seedConversations(page,[{id:'one'},{id:'two'}]);await page.locator('#btnSelectAll').click();
    const pending=page.waitForEvent('download');await page.locator('#btnExport').click();const file=await pending;expect(file.suggestedFilename()).toMatch(/\.zip$/);
    const JSZip=require(path.resolve(__dirname,'../../lib/jszip.min.js'));const zip=await JSZip.loadAsync(await readFile((await file.path())!));const files=Object.keys(zip.files).filter(x=>x.endsWith('.md'));expect(files).toHaveLength(2);
    const bodies=await Promise.all(files.map(x=>zip.file(x).async('string')));expect(bodies.join('\n')).toContain('Answer one');expect(bodies.join('\n')).toContain('Answer two');
    await expect(page.locator('#status')).toContainText('Successfully downloaded: 2');await expect(page.locator('#list small')).toHaveText([/Last export/,/Last export/]);
    const records=await page.evaluate(id=>Reflect.get(globalThis,'uiFixture').listExportRecords(id),accountId);expect(Object.keys(records).sort()).toEqual(['one','two']);expect(records.one.status).toBe('ok');
});
test('unchanged exports skip through Application without producing an empty ZIP',async({context,extensionId})=>{
    const page=await openOptions(context,extensionId);await seedConversations(page,[{id:'unchanged'}],{unchanged:{exportedAt:200,chatTime:100,format:'markdown',status:'ok'}});
    await page.locator('#btnSelectAll').click();let downloads=0;page.on('download',()=>{downloads++;});await page.locator('#btnExport').click();await expect(page.locator('#status')).toContainText('Skipped: 1');await expect(page.locator('body')).toHaveAttribute('data-busy','false');expect(downloads).toBe(0);
});
test('clearing export records preserves bodies and skip preference, then explicit selection can export again',async({context,extensionId})=>{
    const page=await openOptions(context,extensionId);await seedConversations(page,[{id:'one'}],{one:{exportedAt:200,chatTime:100,format:'markdown',status:'ok'}});
    await expect(page.locator('#btnClearExported')).toBeHidden();
    await page.locator('#devToggle').check();
    await page.locator('#btnMoreActions').click();
    await expect(page.locator('#btnClearExported')).toBeVisible();
    const before=await storedSettings(page);await page.locator('#btnClearExported').click();await page.locator('#btnCleanupConfirm').click();await expect(page.locator('#status')).toHaveText('Records cleared');
    expect(await page.evaluate(id=>Reflect.get(globalThis,'uiFixture').listExportRecords(id),accountId)).toEqual({});expect((await storedSettings(page)).skipExported).toBe(before.skipExported);
    expect(await page.evaluate(id=>Reflect.get(globalThis,'uiFixture').readConversation({accountId:id,conversationId:'one'}),accountId)).toBeTruthy();
    await page.locator('#btnSelectAll').click();const pending=page.waitForEvent('download');await page.locator('#btnExport').click();expect(await readFile((await(await pending).path())!,'utf8')).toContain('Answer one');
});

test('large unchanged exports do not rebuild the conversation list for each skipped item', async ({context,extensionId}) => {
    test.setTimeout(120000);
    const page = await openOptions(context,extensionId);
    const rows = Array.from({length:1343},(_,i)=>({id:`skip-${i}`}));
    await seedConversations(page,rows,Object.fromEntries(rows.map(row=>[row.id,
        {exportedAt:200,chatTime:100,format:'markdown' as const,status:'ok' as const}])));
    await page.locator('#btnSelectAll').click();
    await page.evaluate(() => {
        const metrics = {listRebuilds:0,storageOpens:0};
        Reflect.set(window,'skipMetrics',metrics);
        const list = document.getElementById('list');
        const replace = Element.prototype.replaceChildren;
        Element.prototype.replaceChildren = function(...nodes) {
            if(this === list) metrics.listRebuilds++;
            return replace.apply(this,nodes);
        };
        const open = indexedDB.open;
        indexedDB.open = function(...args) {
            metrics.storageOpens++;
            return open.apply(this,args);
        };
    });
    let downloads = 0;
    page.on('download',()=>{downloads++;});
    await page.locator('#btnExport').click();
    await expect(page.locator('#directWriteModal')).toBeVisible();
    const started = Date.now();
    await page.locator('#btnModalContinueZip').click();
    await expect(page.locator('#status')).toContainText('Skipped: 1343',{timeout:90000});
    await expect(page.locator('body')).toHaveAttribute('data-busy','false');
    const metrics = await page.evaluate(()=>Reflect.get(window,'skipMetrics'));
    console.log('Unchanged export performance:',{durationMs:Date.now()-started,...metrics});
    expect(downloads).toBe(0);
    // A few task-start/task-end renders are allowed; per-item list replacement and per-item DB opens are not.
    expect(metrics.listRebuilds).toBeLessThanOrEqual(6);
    expect(metrics.storageOpens).toBeLessThanOrEqual(4);
    await expect(page.locator('#list input:checked')).toHaveCount(1343);
});


test('export progress keeps one cumulative three-counter message through source and attachment events', async ({context,extensionId}) => {
    const page = await openOptions(context, extensionId);
    await seedConversations(page, [{id:'one'}, {id:'two'}]);
    await page.locator('#devToggle').check();
    await expect(page.locator('#devToggle')).toBeEnabled();
    await page.locator('#includeAssets').check();
    await expect(page.locator('#includeAssets')).toBeEnabled();
    await page.evaluate(async accountId => {
        const api = Reflect.get(globalThis, 'uiFixture');
        for (const id of ['one', 'two']) await api.ingestDetail(accountId, id, {
            savedAt: 100, quality: {status:'complete'},
            assets: [{id:'file',kind:'file',name:'report.md',document:{contentMarkdown:`Report ${id}`}}],
            messages: [{role:'user',content:[{type:'paragraph',children:[{type:'text',text:`Question ${id}`}]}]},
                {role:'assistant',content:[{type:'file',assetId:'file'}]}],
        }, {title:id,titleSource:'provider',updatedAt:100});
        const messages: string[] = [];
        Reflect.set(window, 'exportProgressMessages', messages);
        const progress = document.getElementById('progText');
        if (!progress) throw new Error('Missing export progress element');
        new MutationObserver(() => {
            if (progress?.textContent) messages.push(progress.textContent);
        }).observe(progress, {childList:true,subtree:true,characterData:true});
    }, accountId);
    await page.locator('#btnSelectAll').click();
    const download = page.waitForEvent('download');
    await page.locator('#btnExport').click();
    await download;
    await expect(page.locator('body')).toHaveAttribute('data-busy','false');
    const messages: string[] = await page.evaluate(() => Reflect.get(window, 'exportProgressMessages'));
    expect(messages.length).toBeGreaterThan(2);
    const counts = messages.map(message => {
        const match = /^Prepared (\d+) conversations? · delivered (\d+) documents? · downloaded (\d+) attachments?$/.exec(message);
        if (!match) throw new Error(`Unexpected export progress: ${message}`);
        const values = match.slice(1).map(Number);
        const [prepared, delivered, downloaded] = values;
        expect(message).toBe(`Prepared ${prepared} conversation${prepared === 1 ? '' : 's'} · delivered ${delivered} document${delivered === 1 ? '' : 's'} · downloaded ${downloaded} attachment${downloaded === 1 ? '' : 's'}`);
        return values;
    });
    expect(counts).toContainEqual([0,0,0]);
    for (let i=1;i<counts.length;i++) for (let metric=0;metric<3;metric++)
        expect(counts[i][metric]).toBeGreaterThanOrEqual(counts[i-1][metric]);
    expect(counts.at(-1)).toEqual([2,2,2]);
});

test('old interrupted sessions stay inert after reload and language changes; source titles remain untouched', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    await seedConversations(page, [{ id: 'one', title: 'Takeout Prompt 临时问题', titleSource: 'derived' }, { id: 'two' }]);
    await page.evaluate(() => chrome.storage.local.set({ gemini_last_export_session: { status: 'interrupted', total: 2, current: 1, lastChatId: 'one', lastChatTitle: 'Must not overwrite source title' } }));
    await page.reload();
    await expect(page.locator('#list .item')).toHaveCount(2);
    await expect(page.locator('#exportSessionBanner,#btnResumeExport,#btnDismissExportBanner')).toHaveCount(0);
    await expect(page.locator('#list input:checked')).toHaveCount(0);
    await page.locator('#langToggle').uncheck();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('[data-chat-id="one"]')).toContainText('Takeout Prompt 临时问题');
    await expect(page.locator('#btnExport')).toBeDisabled();
    await page.locator('#langToggle').check();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('[data-chat-id="one"]')).toContainText('Takeout Prompt 临时问题');
    await exposeUIStorage(page);
    const index = await page.evaluate(id => Reflect.get(globalThis, 'uiFixture').getIndex({ accountId: id, conversationId: 'one' }), accountId);
    expect(index.title).toBe('Takeout Prompt 临时问题');
    expect(index.titleSource).toBe('derived');
});

test('Options Markdown download preserves literal prompt separator lines', async ({ context, extensionId }, testInfo) => {
    const page = await openOptions(context, extensionId);
    await seedConversations(page, [{ id: 'literal-separators', question: 'Standalone\n\n---\n\nText above\n---\n***\n___\n- - -\nHeading\n===', body: 'Unchanged answer' }]);
    await page.locator('#btnSelectAll').click();
    const pending = page.waitForEvent('download');
    await page.locator('#btnExport').click();
    const download = await pending;
    expect(download.suggestedFilename()).toMatch(/\.md$/);
    const file = (await download.path())!;
    await copyFile(file, testInfo.outputPath('export.md'));
    const markdown = await readFile(file, 'utf8');
    expect(markdown).toContain('Standalone\n\n\\---');
    expect(markdown).toContain('Text above\n\\---');
    expect(markdown).toContain('\\*\\*\\*\n\\_\\_\\_\n\\- - -\nHeading\n\\===');
    expect(markdown).toContain('Unchanged answer');
});

const archivePng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS9sAAAAASUVORK5CYII=';
test('physical archive bytes survive verified local deletion; missing bodies fail rather than fabricate content, and record cleanup stays nondestructive', async ({ context, extensionId }) => {
    test.setTimeout(60000);
    const page = await openOptions(context, extensionId);
    await seedConversations(page, [{ id: 'archive_local', body: 'Preserved local answer' }]);
    const source = await context.newPage();
    await source.route('https://gemini.google.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><script>window.WIZ_global_data={qDCSke:'10000000001',SNlM0e:'token',cfb2h:'build'}</script><main>Offline source fixture</main>` }));
    await source.goto('https://gemini.google.com/app/archive_local');
    await expect(source.locator('#geminiExportBadge')).toBeVisible();
    await context.route('https://lh3.googleusercontent.com/archive-fixture.png', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(archivePng, 'base64') }));
    await page.evaluate(async id => {
        const api = Reflect.get(globalThis, 'uiFixture');
        const key = { accountId: id, conversationId: 'archive_local' };
        const detail = await api.getDetail(key);
        const { key: _key, ...fields } = detail;
        fields.savedAt = 200;
        fields.assets = [{ id: 'img', kind: 'image', sourceUri: 'https://lh3.googleusercontent.com/archive-fixture.png', mediaType: 'image/png' }];
        fields.messages[1].content.push({ type: 'image', assetId: 'img' });
        await api.ingestDetail(id, 'archive_local', fields, { title: 'Retained local archive', titleSource: 'provider' });
        await api.ingestIndexes(id, [{ conversationId: 'metadata_only', fields: { title: 'Title without body', titleSource: 'derived' } }]);
        window.dispatchEvent(new Event('focus'));
    }, accountId);
    await expect(page.locator('#list .item')).toHaveCount(2);
    await page.locator('#devToggle').check();
    await expect(page.locator('#devToggle')).toBeEnabled();
    await page.locator('#includeAssets').check();
    await expect(page.locator('#includeAssets')).toBeEnabled();
    await page.locator('[data-chat-id="archive_local"] input').check();
    const downloads: Download[] = [];
    page.on('download', file => downloads.push(file));
    await page.locator('#btnExport').click();
    await expect.poll(() => downloads.length).toBe(1);
    await expect(page.locator('body')).toHaveAttribute('data-busy', 'false');
    const file = downloads[0];
    const bytes = await readFile((await file.path())!);
    const JSZip = require(path.resolve(__dirname, '../../lib/jszip.min.js'));
    const zip = await JSZip.loadAsync(bytes);
    const documentPath = Object.keys(zip.files).find(name => name.endsWith('.md'));
    expect(documentPath).toBeTruthy();
    const body = await zip.file(documentPath).async('string');
    expect(body).toContain('Preserved local answer');
    const attachment = Object.keys(zip.files).find(x => x.endsWith('.png'));
    expect(attachment).toBeTruthy();
    expect(body).toContain(attachment);
    expect(Buffer.from(await zip.file(attachment).async('uint8array'))).toEqual(Buffer.from(archivePng, 'base64'));
    await page.locator('[data-chat-id="archive_local"] input').uncheck();
    await page.locator('[data-chat-id="metadata_only"] input').check();
    await page.locator('#btnExport').click();
    await expect(page.locator('#status')).toContainText('failed: 1');
    await page.locator('#btnMoreActions').click();
    await expect(page.locator('#btnClearExported')).toBeVisible();
    await page.locator('#btnClearExported').click();
    await page.locator('#btnCleanupCancel').click();
    expect(await page.evaluate(id => Reflect.get(globalThis, 'uiFixture').getExportRecord({ accountId: id, conversationId: 'archive_local' }), accountId)).toBeTruthy();
    await page.locator('#btnMoreActions').click();
    await page.locator('#btnClearExported').click();
    await page.locator('#btnCleanupConfirm').click();
    await expect(page.locator('#status')).toHaveText('Records cleared');
    expect(await page.evaluate(id => Reflect.get(globalThis, 'uiFixture').readConversation({ accountId: id, conversationId: 'archive_local' }), accountId)).toBeTruthy();
    await page.evaluate(id => Reflect.get(globalThis, 'uiFixture').ingestDeletedConversation(id, 'archive_local'), accountId);
    expect(await page.evaluate(id => Reflect.get(globalThis, 'uiFixture').readConversation({ accountId: id, conversationId: 'archive_local' }), accountId)).toBeNull();
    expect(await readFile((await file.path())!)).toEqual(bytes);
});

test('manual Drive export authorizes on connect/export and verifies the file in the reused root export folder', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    expect(extensionId).toBe('ldpbiafkgjlaooeplkiooljccpalpkgf');
    expect(await page.evaluate(() => chrome.identity.getRedirectURL('drive-auth')))
        .toBe('https://ldpbiafkgjlaooeplkiooljccpalpkgf.chromiumapp.org/drive-auth');
    const initialPermissions = await page.evaluate(() => chrome.permissions.getAll());
    expect(initialPermissions.permissions ?? []).toContain('identity');
    expect(initialPermissions.origins ?? []).not.toContain('https://www.googleapis.com/*');
    await expect(page.locator('#driveDeliveryCard')).toBeVisible();
    await expect(page.locator('#driveConnectionStatus')).toHaveText('Connect to Google Drive.');
    await seedConversations(page, [{ id: 'chosen' }, { id: 'other' }]);
    await page.evaluate(async id => {
        const api = Reflect.get(globalThis, 'uiFixture');
        await api.ingestDetail(id, 'other', {
            savedAt: 100, quality: { status: 'complete' },
            assets: [{ id: 'file', kind: 'file', name: 'report.md', document: { contentMarkdown: 'Drive attachment fixture' } }],
            messages: [
                { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Question other' }] }] },
                { role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Answer other' }] }, { type: 'file', assetId: 'file' }] },
            ],
        }, { title: 'other', titleSource: 'provider', updatedAt: 100 });
    }, accountId);
    await page.addInitScript(() => {
        const scope = 'https://www.googleapis.com/auth/drive.file';
        Object.defineProperty(chrome, 'identity', { configurable: true, value: {
            getRedirectURL: (path: string) => 'https://ldpbiafkgjlaooeplkiooljccpalpkgf.chromiumapp.org/' + path,
            launchWebAuthFlow: async (flow: chrome.identity.WebAuthFlowDetails) => {
                const query = new URL(flow.url).searchParams;
                const prompt = query.get('prompt');
                const hint = query.get('login_hint');
                if (query.get('client_id') !== '123-web.apps.googleusercontent.com' || query.get('scope') !== scope
                    || query.get('redirect_uri') !== 'https://ldpbiafkgjlaooeplkiooljccpalpkgf.chromiumapp.org/drive-auth'
                    || (prompt === 'none') === flow.interactive) throw new Error('Unexpected authorization request');
                if (sessionStorage.getItem('cancelSwitch')) throw new Error('Cancelled');
                const email = prompt === 'select_account'
                    ? sessionStorage.getItem('chooseDriveAccount') ?? 'drive@example.test' : hint;
                if (email !== 'drive@example.test' && email !== 'second@example.test') throw new Error('Missing account selection');
                sessionStorage.setItem('driveAuthMode', String(flow.interactive));
                sessionStorage.setItem('driveWebPrompt', prompt ?? '');
                return query.get('redirect_uri') + '#' + new URLSearchParams({
                    state: query.get('state') ?? '', access_token: email === 'second@example.test' ? 'second' : 'fixture', scope,
                });
            },
        } });
    });
    let accountConfigReads = 0;
    await page.route('**/drive-account-client.json', route => {
        accountConfigReads++;
        return route.fulfill({ json: '123-web.apps.googleusercontent.com' });
    });
    await page.reload();
    type DriveFile = { id: string; name: string; parent: string; mimeType: string; size: number };
    const uploads: { file: DriveFile; body: Buffer }[] = [];
    const files = new Map<string, DriveFile>();
    const sessions = new Map<string, DriveFile>();
    const folders = new Map<string, string>([['second-root/Gemini Exporter', 'second-folder']]);
    let createdRootFolders = 0;
    let patchedUploads = 0;
    let metadataReads = 0;
    let expireNext = false;
    let returnEmpty = true;
    page.on('dialog', async dialog => { await dialog.dismiss(); throw new Error('Unexpected confirmation'); });
    await page.route('https://www.googleapis.com/**', async route => {
        const req = route.request();
        const url = new URL(req.url());
        const method = req.method();
        const auth = req.headers().authorization;
        expect(['Bearer fixture', 'Bearer second']).toContain(auth);
        const second = auth === 'Bearer second';
        const accountRoot = second ? 'second-root' : 'first-root';
        if (expireNext) { expireNext = false; return route.fulfill({ status: 401 }); }
        if (url.pathname.endsWith('/about')) return route.fulfill({ json: { user: { emailAddress: second ? 'second@example.test' : 'drive@example.test' } } });
        if (url.pathname === '/drive/v3/files' && method === 'GET') {
            const query = url.searchParams.get('q') ?? '';
            const match = /^'([^']+)' in parents and trashed = false and name = '([^']+)'/.exec(query);
            if (!match) throw new Error('Unexpected Drive query');
            const [, parent, name] = match;
            if (query.includes("mimeType = 'application/vnd.google-apps.folder'")) {
                const id = folders.get((parent === 'root' ? accountRoot : parent) + '/' + name);
                return route.fulfill({ json: { files: id ? [{ id, capabilities: { canAddChildren: true } }] : [] } });
            }
            const existing = [...files.values()].find(file => file.parent === parent && file.name === name);
            return route.fulfill({ json: { files: existing ? [{ id: existing.id, capabilities: { canModifyContent: true } }] : [] } });
        }
        if (url.pathname === '/drive/v3/files' && method === 'POST') {
            const { name, parents, mimeType } = req.postDataJSON();
            expect(mimeType).toBe('application/vnd.google-apps.folder');
            if (parents[0] === 'root') {
                expect(name).toBe('Gemini Exporter');
                createdRootFolders++;
            }
            const id = 'folder-' + folders.size;
            folders.set((parents[0] === 'root' ? accountRoot : parents[0]) + '/' + name, id);
            return route.fulfill({ json: { id } });
        }
        if (url.pathname.startsWith('/drive/v3/files/') && method === 'GET') {
            const file = files.get(url.pathname.split('/').at(-1) ?? '');
            if (!file) throw new Error('Unknown uploaded file');
            metadataReads++;
            return route.fulfill({ json: { ...file, size: String(returnEmpty ? 0 : file.size), parents: [file.parent], trashed: false } });
        }
        if (method === 'POST' || method === 'PATCH') {
            const { name, parents, mimeType } = req.postDataJSON();
            expect(name).not.toMatch(/\.zip$|\//);
            const previous = method === 'PATCH' ? files.get(url.pathname.split('/').at(-1) ?? '') : undefined;
            if (method === 'PATCH') {
                expect(previous?.name).toBe(name);
                patchedUploads++;
            }
            const parent = previous?.parent ?? parents[0];
            const id = previous?.id ?? 'file-' + sessions.size;
            const uploadId = String(sessions.size);
            sessions.set(uploadId, { id, name, parent, mimeType, size: 0 });
            return route.fulfill({ status: 200, headers: {
                location: 'https://www.googleapis.com' + url.pathname + '?upload_id=' + uploadId,
                'access-control-expose-headers': 'Location',
            } });
        }
        expect(method).toBe('PUT');
        const file = sessions.get(url.searchParams.get('upload_id') ?? '');
        const body = req.postDataBuffer();
        if (!file || !body) throw new Error('Missing upload session or body');
        file.size = body.length;
        files.set(file.id, file);
        if (!returnEmpty) uploads.push({ file, body });
        return route.fulfill({ json: { id: file.id } });
    });
    // Selecting Google Drive does not force-pop OAuth; Connect and Export button invite authorization cleanly.
    await page.locator('#driveDeliveryRadio').check();
    await expect(page.locator('#driveConnectionStatus')).toHaveText('Connect to Google Drive.');
    await expect(page.locator('#driveConnect')).toBeVisible();
    await expect(page.locator('#btnExport')).toHaveText('Connect Google Drive');
    await expect(page.locator('#btnExport')).toBeEnabled();
    expect(await page.evaluate(() => sessionStorage.getItem('driveAuthMode'))).toBeNull();
    await page.locator('#btnExport').click();
    await expect(page.locator('#driveConnectionStatus')).toHaveText('Export account: drive@example.test');
    expect(await page.evaluate(() => sessionStorage.getItem('driveAuthMode'))).toBe('true');
    await expect(page.locator('#skipExported')).toBeEnabled();
    await page.reload();
    await expect(page.locator('#driveConnectionStatus')).toHaveText('Export account: drive@example.test');
    expect(await page.evaluate(() => sessionStorage.getItem('driveAuthMode'))).toBe('false');
    await expect(page.locator('#skipExported')).toBeChecked();
    await expect(page.locator('#skipExported')).toBeEnabled();
    const driveDestination = page.locator('#driveDestination');
    await expect(driveDestination).toHaveText('Save to: My Drive / Gemini Exporter');
    await expect(driveDestination).not.toHaveAttribute('href', /./);
    expect(createdRootFolders).toBe(0);
    await page.locator('#list .item').filter({ hasText: 'chosen' }).locator('input').check();
    await page.locator('#btnExport').click();
    await expect(page.locator('#exportFailureCard')).toBeVisible();
    expect(metadataReads).toBe(1);
    expect(sessions.size).toBe(1);
    returnEmpty = false;
    await page.locator('#btnExport').click();
    const firstFolderUrl = 'https://drive.google.com/drive/folders/folder-1?authuser=drive%40example.test';
    await expect(driveDestination).toHaveAttribute('href', firstFolderUrl);
    await expect(page.locator('#openDriveExport')).toHaveCount(0);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].body.toString()).toContain('Answer chosen');
    expect(uploads[0].body.toString()).not.toContain('Answer other');
    await expect(page.locator('#status')).toContainText('Uploaded to Drive: 1');
    await page.locator('#btnExport').click();
    await expect(page.locator('#status')).toContainText('Skipped: 1');
    expect(uploads).toHaveLength(1);
    await page.locator('#skipExported').uncheck();
    await page.locator('#includeAssets').check();
    await page.locator('#btnSelectAll').check();
    await page.locator('#btnExport').click();
    await expect(page.locator('#status')).toContainText('Uploaded to Drive: 2');
    expect(createdRootFolders).toBe(1);
    expect(uploads).toHaveLength(4);
    const root = folders.get('first-root/Gemini Exporter');
    const documents = uploads.slice(1).filter(({ file }) => file.parent === root);
    expect(documents).toHaveLength(2);
    expect(documents.every(({ file }) => file.name.endsWith('.md'))).toBe(true);
    expect(documents.find(({ body }) => body.toString().includes('Answer chosen'))?.file.id).toBe('file-0');
    const other = documents.find(({ body }) => body.toString().includes('Answer other'));
    expect(other?.body.toString()).toContain(`files/gemini/${accountId}/other/report.md`);
    const attachments = folders.get(folders.get(folders.get(folders.get(root + '/files') + '/gemini') + '/' + accountId) + '/other');
    expect(uploads.find(({ file }) => file.parent === attachments)?.body.toString()).toBe('Drive attachment fixture');
    expect(patchedUploads).toBe(2);
    await expect(page.locator('#driveConnect')).toBeHidden();
    expect(accountConfigReads).toBe(2);
    await page.evaluate(() => sessionStorage.setItem('cancelSwitch', '1'));
    await page.locator('#driveSwitch').click();
    await expect(page.locator('#driveConnectionStatus')).toContainText('Export account: drive@example.test · Account switch did not complete.');
    await expect(driveDestination).toHaveAttribute('href', firstFolderUrl);
    await page.evaluate(() => {
        sessionStorage.removeItem('cancelSwitch');
        sessionStorage.setItem('chooseDriveAccount', 'second@example.test');
    });
    await page.locator('#driveSwitch').click();
    await expect(page.locator('#driveConnectionStatus')).toHaveText('Export account: second@example.test');
    const secondFolderUrl = 'https://drive.google.com/drive/folders/second-folder?authuser=second%40example.test';
    await expect(driveDestination).toHaveAttribute('href', secondFolderUrl);
    expect(await page.evaluate(() => sessionStorage.getItem('driveWebPrompt'))).toBe('select_account');
    expect(accountConfigReads).toBe(2);
    await page.reload();
    await expect(page.locator('#driveConnectionStatus')).toHaveText('Export account: second@example.test');
    expect(await page.evaluate(() => sessionStorage.getItem('driveWebPrompt'))).toBe('none');
    await expect(driveDestination).toHaveAttribute('href', secondFolderUrl);
    await page.locator('#btnSelectAll').check();
    await page.locator('#btnExport').click();
    await expect(driveDestination).toHaveAttribute('href', secondFolderUrl);
    await expect(page.locator('#status')).toContainText('Uploaded to Drive: 2');
    expect(createdRootFolders).toBe(1);
    expect(uploads.slice(4).filter(({ file }) => file.parent === 'second-folder')).toHaveLength(2);
    expireNext = true;
    await page.locator('#btnExport').click();
    await expect(page.locator('#driveConnect')).toBeVisible();
    await expect(driveDestination).not.toHaveAttribute('href', /./);
    await page.locator('#driveConnect').click();
    await expect(page.locator('#driveConnectionStatus')).toHaveText('Export account: second@example.test');
    await expect(page.locator('#driveConnect')).toBeHidden();
    await expect(driveDestination).toHaveAttribute('href', secondFolderUrl);
});
