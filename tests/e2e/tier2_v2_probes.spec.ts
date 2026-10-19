import { test, expect, seedRegistryAccounts } from './fixtures';
import { execFileSync } from 'node:child_process';
import { buildSync } from 'esbuild';
import { resolve } from 'node:path';
import { readGeminiAuditInput, auditGeminiEvidence } from '../helpers/geminiDualParse';

const root = resolve(__dirname, '../..');
const accountId = '10000000-0000-4000-8000-000000000001';
const probe = execFileSync('python3', ['-c', 'from scripts.framework.v2_probe import probe_bundle; print(probe_bundle())'], { cwd: root, maxBuffer: 12 * 1024 * 1024 }).toString();
const scanObserver = execFileSync('python3', ['-c', 'from scripts.framework.actions import SCAN_OBSERVER; print(SCAN_OBSERVER)'], { cwd: root }).toString();
const capture = execFileSync('python3', ['-c', 'from scripts.framework.gemini_dual_parse import INSTALL_CAPTURE; print(INSTALL_CAPTURE)'], { cwd: root }).toString();
const fixture = buildSync({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import * as storage from './src/core/storage/storageService.ts';
    import { ingestDetail } from './src/core/domain/ingestion.ts';
    Object.assign(globalThis,{probeFixture:{...storage,ingestDetail}});
` }, bundle: true, write: false, format: 'iife', conditions: ['worker', 'browser'] }).outputFiles[0].text;

async function workbench(context: import('@playwright/test').BrowserContext, extensionId: string) {
    await seedRegistryAccounts(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html`);
    await expect(page.locator('body')).toHaveAttribute('data-busy', 'false');
    await page.evaluate(probe); await page.evaluate(fixture);
    await page.evaluate(() => Reflect.get(globalThis, '__tier2V2').updateSettings({language:'en'}));
    return page;
}
async function source(context: import('@playwright/test').BrowserContext) {
    const page = await context.newPage();
    await page.route('https://gemini.google.com/**', route => route.fulfill({contentType:'text/html',body:`<!doctype html><script>window.WIZ_global_data={qDCSke:'10000000001',SNlM0e:'token',cfb2h:'build'};</script><main>Fixture</main>`}));
    await page.goto('https://gemini.google.com/app/probe');
    return page;
}
function wire() {
    const turn = [['c_probe','r_question'],[1700000000,0],[['Question']],[[['rc_question',[['Answer']]]]]];
    return JSON.stringify([['wrb.fr','hNvQHb',JSON.stringify([[turn]])]]);
}

test('Tier 2 v2 read probe sees actual account-scoped data; Coverage reset preserves Domain and ExportRecords', async ({ context, extensionId }) => {
    const page = await workbench(context, extensionId);
    await page.evaluate(async accountId => {
        const api = Reflect.get(globalThis,'probeFixture');
        const key = {accountId,conversationId:'probe'};
        await api.ingestDetail(accountId,'probe',{savedAt:100,quality:{status:'complete'},assets:[],messages:[
            {role:'user',content:[{type:'paragraph',children:[{type:'text',text:'Question'}]}]},
            {role:'assistant',content:[{type:'paragraph',children:[{type:'text',text:'Answer'}]}]},
        ]},{title:'Probe title',titleSource:'provider',updatedAt:100});
        await api.putExportRecord(key,{exportedAt:200,chatTime:100,status:'ok',format:'markdown'});
        await api.putCoverage(accountId,'recent',{range:{head:{id:'probe',time:100},tail:{id:'probe',time:100}}});
    },accountId);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('#list .item[data-chat-id="probe"]')).toHaveCount(1);
    const before = await page.evaluate(() => Reflect.get(globalThis,'__tier2V2').snapshot());
    await page.evaluate(() => Reflect.get(globalThis,'__tier2V2').resetCoverage());
    const after = await page.evaluate(() => Reflect.get(globalThis,'__tier2V2').snapshot());
    expect(after.coverage).toBeNull(); expect(after.rows).toEqual(before.rows); expect(after.records).toEqual(before.records);
    const [conversation] = await page.evaluate(() => Reflect.get(globalThis,'__tier2V2').conversations(['probe']));
    expect(conversation.domain.detail.messages).toHaveLength(2);
    await page.locator('#accountIdSelect').selectOption('10000000-0000-4000-8000-000000000002');
    expect((await page.evaluate(() => Reflect.get(globalThis,'__tier2V2').snapshot())).rows).toEqual([]);
});

test('Tier 2 scan observer sees real UI → Application → Recent RPC completion and persisted Coverage', async ({ context, extensionId }) => {
    const page = await workbench(context,extensionId); await source(context);
    const list = JSON.stringify([['wrb.fr','MaZiqc',JSON.stringify([null,null,[['c_probe','Probe title',null,null,null,[1700000000,0]]]])]]);
    await page.route('**/batchexecute*',route => route.fulfill({contentType:'application/json',body:list}));
    expect(await page.evaluate(scanObserver)).toEqual({clicked:true});
    await expect.poll(() => page.evaluate(() => Reflect.get(window,'__tier2ScanEvidence').finished)).toBe(true);
    const evidence = await page.evaluate(() => Reflect.get(window,'__tier2ScanEvidence'));
    expect(evidence.error).toBeUndefined(); expect(evidence.response).toEqual({status:'complete',pagesFetched:1,conversationsFetched:1});
    const state = await page.evaluate(() => Reflect.get(globalThis,'__tier2V2').snapshot());
    expect(state.coverage.range.head.id).toBe('probe');
});

test('Tier 2 raw fetch probe captures the actual export RPC without consuming its response', async ({ context, extensionId }) => {
    const page = await workbench(context,extensionId); await source(context);
    await page.evaluate(async accountId => Reflect.get(globalThis,'probeFixture').putIndexes([{
        key:{accountId,conversationId:'probe'},title:'Probe title',titleSource:'provider',updatedAt:1700000000000,
    }]),accountId);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('#list .item')).toHaveCount(1);
    await page.route('**/batchexecute*',route => route.fulfill({contentType:'application/json',body:wire()}));
    await page.locator('#btnSelectAll').click(); await page.evaluate(capture);
    const download = page.waitForEvent('download'); await page.locator('#btnExport').click();
    expect((await download).suggestedFilename()).toMatch(/\.md$/);
    const pages = await page.evaluate(async () => {
        const state = Reflect.get(window,'__geminiDualCapture'); await Promise.all(state.pending);
        return state.replies.probe;
    });
    expect(pages).toEqual([{requestCursor:null,text:wire()}]);
    const read = readGeminiAuditInput(JSON.stringify({schemaVersion:1,source:'raw_rpc_pages',conversationId:'probe',pages}), 'native_envelope');
    expect(auditGeminiEvidence(read.evidence).sourceMessages).toHaveLength(2);
});

test('Tier 2 Scan observer rejects idle clicks, partial limits and changed accounts, including synchronous completion', async ({ context }) => {
    const page = await context.newPage();
    for (const kind of ['idle','partial','changed','resolved','complete']) {
        await page.setContent('<body data-busy="false"><select id="accountIdSelect"><option value="account">Account</option><option value="other">Other</option></select><button id="btnSyncAll">Scan</button><p id="status"></p></body>');
        await page.evaluate(kind => {
            document.getElementById('btnSyncAll')!.onclick = () => {
                if (kind === 'idle') return;
                document.body.dataset.busy = 'true';
                if (kind === 'changed') {
                    document.getElementById('status')!.textContent = 'Committed 1 pages, 2 source entries';
                    queueMicrotask(() => {
                        (document.getElementById('accountIdSelect') as HTMLSelectElement).value = 'other';
                        document.getElementById('status')!.textContent = 'Reached the end of this Recent source · 1 / 2';
                        document.body.dataset.busy = 'false';
                    });
                    return;
                }
                if (kind === 'resolved') (document.getElementById('accountIdSelect') as HTMLSelectElement).value = 'other';
                document.getElementById('status')!.textContent = kind === 'partial' ? 'Source online access limit · 1 / 2' : 'Reached the end of this Recent source · 1 / 2';
                document.body.dataset.busy = 'false';
            };
        },kind);
        await page.evaluate(scanObserver);
        const evidence = await page.evaluate(() => Reflect.get(window,'__tier2ScanEvidence'));
        if (kind === 'idle') expect(evidence.finished).toBe(false);
        else if (kind === 'changed') expect(evidence.error).toMatch(/account changed/);
        else expect(evidence.response.status).toBe(kind === 'partial' ? 'partial_limit':'complete');
    }
});

test('Tier 2 Takeout probe reads source-bound archive bytes and actual UI-imported v2 Domain', async ({ context, extensionId }) => {
    const page = await workbench(context,extensionId);
    const encoded = await page.evaluate(async () => {
        const Zip = Reflect.get(globalThis,'JSZip'); const zip = new Zip();
        zip.file('Takeout/Gemini/MyActivity.html', '<div class="outer-cell"><a href="https://gemini.google.com/app/c_archive_contract">Conversation</a><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted Draw<br>2026-09-02T12:00:00Z<br><p>Answer <img src="photo.png"></p></div>1 generated image</div>');
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        zip.file('Takeout/Gemini/photo.png',canvas.toDataURL('image/png').split(',')[1],{base64:true});
        return zip.generateAsync({type:'base64'});
    });
    const source = await page.evaluate(async encoded => Reflect.get(globalThis,'__tier2V2').inspectTakeout(encoded,['Takeout/Gemini/photo.png']),encoded);
    expect(source.ids.length).toBeGreaterThan(0);
    expect(Object.values(source.resources).flat().length).toBeGreaterThan(0);
    await page.locator('#takeoutFileInput').setInputFiles({name:'source-fixture.zip',mimeType:'application/zip',buffer:Buffer.from(encoded,'base64')});
    await expect(page.locator('#status')).toContainText(/Imported .*\((ok|partial)\)/);
    await expect(page.locator('body')).toHaveAttribute('data-busy','false');
    const persisted = await page.evaluate(ids => Reflect.get(globalThis,'__tier2V2').conversations(ids),source.ids);
    for (const record of persisted) {
        expect(record.ok).toBe(true); expect(record.domain.index.key.accountId).toBe(accountId);
        expect(record.domain.detail.messages.length).toBeGreaterThan(0);
    }
});
