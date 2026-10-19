import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

// Only the UI is under test. Domain/Application/Runtime ports are deliberate mocks.
const mock = `
const h = globalThis.harness;
export const getSettings = async () => ({...h.settings});
export const updateSettings = async patch => { h.patches.push(patch); Object.assign(h.settings,patch); };
export const isLiveSaveEffective = (s,d) => s.enabledDisk && s.defaultFormat==='markdown' && d;
export const ensureV2Ready = async () => {};
export const warmLocalFontCache = () => {h.events.push('fonts');return Promise.resolve();};
export const listAccounts = async () => h.accounts;
export const listIndexes = async id => h.indexes.filter(x=>x.key.accountId===id);
export const listExportRecords = async id => h.records[id]||{};
export const getIndex = async key => h.indexes.find(x=>x.key.accountId===key.accountId&&x.key.conversationId===key.conversationId)||null;
export const getAccount = async id => h.accounts.find(a=>a.id===id)||null;
export const getOrCreateAccount = async () => {h.events.push('create');return h.accounts[0];};
export const isAccountId = id => typeof id==='string' && id.length===36;
export const runExport = async (request,options={}) => {h.exports.push(request);h.events.push('export');options.onProgress?.({current:1,total:request.keys.length,key:request.keys[0]});
 if(h.holdExport) await new Promise(resolve=>h.finishExport=resolve);
 return {exported:options.signal?.aborted?0:1,partial:h.partial?1:0,skipped:0,failed:h.failExport?request.keys:[],aborted:!!options.signal?.aborted};};
export const resolveScanTarget = async () => h.source;
export const scanAll = async (request,options) => {h.scans.push(request);options.onProgress?.({pagesFetched:2,conversationsFetched:h.scanCount});if(h.holdScan)await new Promise(resolve=>h.finishScan=resolve);return {status:'partial_limit',reason:'max_pages',pagesFetched:2,conversationsFetched:h.scanCount};};
export const clearLocalExportRecords = async id => {h.clears.push(['exports',id]);};
export const clearLocalScanRecords = async id => {h.clears.push(['scan',id]);};
export const importTakeout = async (file,id,progress) => {h.imports.push(id);progress?.(100);return {imported:2,status:'partial'};};
export const getDirectoryHandle = async () => h.directory;
export const setDirectoryHandle = async handle => {h.directory=handle;};
export const clearDirectoryHandle = async () => {};
export const isVersionGreater = (a,b) => a.localeCompare(b,undefined,{numeric:true})>0;
`;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
async function mount(page: Page, kind: 'options' | 'popup' | 'badge', patch: Record<string, unknown> = {}, query = '') {
    const root = process.cwd();
    const bundle = await build({ ...(kind === 'badge' ? { stdin: { contents: `import { BadgeView } from './src/content/badgeView.ts'; globalThis.badge = BadgeView; BadgeView.ensureBadge();`, resolveDir: root } } : { entryPoints: [path.join(root, `src/ui/${kind}/${kind}.ts`)] }), bundle: true, write: false, format: 'iife', plugins: [{ name: 'ui-port-mocks', setup(build) {
        build.onResolve({ filter: /accountContext\.js$/ }, args => ({path:args.path,namespace:'account-mock'}));
        build.onLoad({filter:/.*/,namespace:'account-mock'},()=>({contents:`export const getAccountContext=()=>({accountId:globalThis.harness.source,providerId:'gemini'});export const resolveCurrentAccount=async()=>getAccountContext();`,loader:'js'}));
        build.onResolve({ filter: /core\// }, args => ({ path: args.path, namespace: 'ui-mock' }));
        build.onLoad({ filter: /.*/, namespace: 'ui-mock' }, () => ({ contents: mock, loader: 'js' }));
    } }] });
    await page.route('https://ui.test/**', route => route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(root, `src/ui/${kind === 'badge' ? 'options' : kind}/${kind === 'badge' ? 'options' : kind}.html`), 'utf8').replace(/<script[^>]*><\/script>/g, '').replace(/<link[^>]*>/g, '') }));
    await page.addInitScript(({ A, B, patch }) => {
        const w = window as any;
        w.harness = { settings: {defaultFormat:'markdown',includeAssets:true,skipExported:true,enabledDisk:true,developerMode:false,language:'en',lastSeenFeatureVersion:'1.8.1'},
            accounts:[{id:A,providerId:'gemini',providerAccountId:'A'},{id:B,providerId:'gemini',providerAccountId:'B'}],
            indexes:[{key:{accountId:A,conversationId:'a'},title:'<img src=x onerror=alert(1)>',updatedAt:5},{key:{accountId:B,conversationId:'b'},title:'B chat',updatedAt:5}],records:{},source:A,scanCount:150,
            patches:[],events:[],exports:[],scans:[],clears:[],imports:[],directory:null,...patch };
        w.chrome = { runtime:{getManifest:()=>({version:'1.8.1'}),openOptionsPage:async()=>w.harness.events.push('options'),sendMessage:async(message:any)=>{if(message.action==='getLocalIndexCount'){w.harness.countRequests=(w.harness.countRequests||0)+1;if(w.harness.holdCount)return new Promise(resolve=>w.harness.finishCount=resolve);return {ok:true,count:message.accountId===A?9:0};}w.harness.events.push(message.action);return {ok:true};}},
            tabs:{query:async()=>w.harness.tabs??[{id:1,active:true}],sendMessage:async()=>{w.harness.events.push('context');return w.harness.noContext?{ok:false}:{ok:true,accountContext:{accountId:A,providerId:'gemini'},conversationId:'a'};},create:async()=>{w.harness.events.push('open');},reload:async()=>{w.harness.events.push('reload');}},
            storage:{onChanged:{addListener:()=>{},removeListener:()=>{}}}};
    }, { A, B, patch });
    await page.goto('https://ui.test/' + query);
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'src/ui/tour/tourGuide.css'), 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
}
const read = (page: Page, key: string) => page.evaluate(key => (window as any).harness[key], key);

test('UI v2: Popup four formats use one request, preserve enabledDisk, include assets and never skip', async ({ page }) => {
    await mount(page, 'popup');
    await expect(page.locator('#btnCurrent')).toBeEnabled();
    await expect(page.locator('button')).toHaveCount(6);
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
test('UI v2: Popup blocks unknown context, supports index-less trusted key and partial result', async ({ page }) => {
    await mount(page,'popup',{indexes:[],partial:true}); await expect(page.locator('#btnCurrent')).toBeEnabled();
    await page.locator('#btnCurrent').click(); await expect(page.locator('#status')).toContainText('some content is missing');
    await page.evaluate(()=>{(window as any).harness.noContext=true;}); await page.locator('#btnCurrent').click();
    await expect(page.locator('#btnCurrent')).toBeDisabled(); expect((await read(page,'exports')).length).toBe(1);
});
test('UI v2: account switch clears selection and only selected current keys export; cancel waits for return', async ({ page }) => {
    await mount(page,'options',{holdExport:true}); await expect(page.locator('#list .item')).toHaveCount(1);
    await expect(page.locator('#list img')).toHaveCount(0); await expect(page.locator('#btnExport')).toBeDisabled();
    await page.locator('#btnSelectAll').click(); await page.locator('#accountIdSelect').selectOption(B);
    await expect(page.locator('#btnExport')).toBeDisabled(); await expect(page.locator('#list')).toContainText('B chat');
    await page.locator('#btnSelectAll').click(); await page.locator('#btnExport').click();
    await expect(page.locator('#accountIdSelect')).toBeDisabled(); await page.locator('#btnCancel').click();
    await expect(page.locator('#accountIdSelect')).toBeDisabled(); await expect(page.locator('#status')).toHaveText('Cancelling…');
    await page.evaluate(()=>{(window as any).harness.finishExport();}); await expect(page.locator('#accountIdSelect')).toBeEnabled();
    expect((await read(page,'exports'))[0].keys).toEqual([{accountId:B,conversationId:'b'}]);
});
test('UI v2: zero accounts can scan, no fake percent, strict Takeout threshold and source switching', async ({ page }) => {
    await mount(page,'options',{accounts:[],indexes:[],holdScan:true}); await expect(page.locator('#btnSyncAll')).toBeEnabled();
    await page.locator('#btnSyncAll').click(); await expect(page.locator('#status')).toHaveText('Committed 2 pages, 150 source entries');
    expect(await read(page,'scans')).toEqual([{accountId:A}]); await page.evaluate(()=>{(window as any).harness.finishScan();});
    await expect(page.locator('#btnSyncAll')).toBeEnabled(); await expect(page.locator('.tour-popover')).toHaveCount(0);
    await page.evaluate(()=>{Object.assign((window as any).harness,{holdScan:false,scanCount:151});});
    await page.locator('#btnSyncAll').click(); await expect(page.locator('.tour-popover')).toContainText('More complete history');
    expect((await read(page,'patches')).length).toBe(0); await page.locator('.tour-popover button',{hasText:'Got it'}).click();
    expect(await read(page,'patches')).toContainEqual({takeoutPromptCompleted:true});
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
    await page.locator('#takeoutFileInput').setInputFiles({name:'Takeout.zip',mimeType:'application/zip',buffer:Buffer.from('fixture')});
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
    await page.evaluate(()=>{(window as any).badge.showLiveSaveResult(null);});
    await expect(page.locator('#geminiExportBadge')).toContainText('Some content was not saved');
    await expect(page.locator('#geminiExportBadge')).toContainText('0 conversations indexed',{timeout:4000});
    expect(await read(page,'countRequests')).toBe(2);
    await page.locator('#geminiExportBadge').focus(); await page.keyboard.press('Enter'); expect(await read(page,'events')).toContain('openOptions');
});
test('UI v2: Badge drag saves only Settings on pointerup, ignores ordinary clicks and resizes', async ({ page }) => {
    await mount(page,'badge'); await expect(page.locator('#geminiExportBadge')).toContainText('9 conversations indexed');
    const badge=page.locator('#geminiExportBadge'); const before=await badge.boundingBox();
    await page.mouse.move(before!.x+15,before!.y+10);await page.mouse.down();await page.mouse.move(before!.x-100,before!.y-80);
    expect(await read(page,'patches')).toEqual([]);await page.mouse.up();
    const patches=await read(page,'patches');expect(patches).toHaveLength(1);expect(patches[0].badgePosition).toBeTruthy();
    expect(await read(page,'events')).not.toContain('openOptions');
    await page.setViewportSize({width:900,height:700});expect(await read(page,'patches')).toHaveLength(1);
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
