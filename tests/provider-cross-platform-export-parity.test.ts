import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { v2ExportHost } from './helpers/v2ExportHost.js';
import { getOrCreateAccount } from '../src/runtime/api/accountRegistry.js';
import { ingestIndexes } from '../src/l2/ingestion.js';
import { getDetail, getExportRecord } from '../src/l3a/storageService.js';
import { runExport } from '../src/application/export/runExport.js';
import { __getZipConstructor, __setZipConstructor, type ZipConstructor } from '../src/l4/packaging/writers/zipWriter.js';
import { detailGen as geminiDetailGen } from './fixtures/providers/geminiDetail.js';
import { detailGen as chatgptDetailGen } from './fixtures/providers/chatgptDetail.js';
import { sessionGen as chatgptSessionGen } from './fixtures/providers/chatgptSession.js';
import { organizationsGen as claudeOrganizationsGen } from './fixtures/providers/claudeOrganizations.js';
import { detailGen as claudeDetailGen } from './fixtures/providers/claudeDetail.js';
import { detailGen as grokDetailGen, metadataGen as grokMetadataGen, treeGen as grokTreeGen, responsesGen as grokResponsesGen } from './fixtures/providers/grokDetail.js';

const JSZip: ZipConstructor & {
    loadAsync(bytes: ArrayBuffer): Promise<{ files: Record<string, { dir: boolean; async(type: 'string'): Promise<string> }> }>;
} = require('../lib/jszip.min.js');

function offlineExportHost(t: TestContext, fetchFixture: typeof fetch = async input => {
    throw new Error(`Unexpected HTTP request: ${input}`);
}) {
    const host = v2ExportHost(t);
    const previousZip = __getZipConstructor();
    const previousFetch = globalThis.fetch;
    __setZipConstructor(JSZip);
    globalThis.fetch = fetchFixture;
    t.after(() => {
        __setZipConstructor(previousZip);
        globalThis.fetch = previousFetch;
    });
    return host;
}

function assertContent(artifacts: Record<string, string>, present: readonly string[], absent: readonly string[] = []) {
    for (const [format, body] of Object.entries(artifacts)) {
        for (const snippet of present) assert.ok(body.includes(snippet), `${format} missing ${snippet}`);
        for (const snippet of absent) assert.ok(!body.includes(snippet), `${format} leaked ${snippet}`);
    }
}

async function exportFourFormatsFromIndexOnly(
    accountId: string,
    conversationId: string,
    host: ReturnType<typeof offlineExportHost>,
) {
    // Verify we truly start Index-only (no pre-seeded Detail in IDB) so runExport MUST invoke the real Provider
    assert.equal(await getDetail({ accountId, conversationId }), null, `${conversationId}: must start Index-only before export`);

    const results: { markdown: string; html: string; json: string; docxXml: string } = {
        markdown: '',
        html: '',
        json: '',
        docxXml: '',
    };

    for (const format of ['markdown', 'html', 'json', 'docx'] as const) {
        const before = host.blobs.length;
        const outcome = await runExport({
            keys: [{ accountId, conversationId }],
            format,
            delivery: 'browserDownload',
            includeAssets: false,
            skipUnchanged: false,
        });
        assert.equal(outcome.exported + outcome.partial, 1, `${conversationId} (${format}): must deliver 1 conversation`);
        assert.deepEqual(outcome.failed, [], `${conversationId} (${format}): must have 0 failures`);
        assert.equal(host.blobs.length, before + 1);
        const extension = format === 'markdown' ? 'md' : format;
        assert.ok(host.filenames[before]?.endsWith(`.${extension}`));
        const blob = host.blobs[host.blobs.length - 1];
        if (format === 'docx') {
            const zip = await JSZip.loadAsync(await blob.arrayBuffer());
            assert.ok(zip.files['[Content_Types].xml'], 'DOCX archive must contain [Content_Types].xml');
            assert.ok(zip.files['word/document.xml'], 'DOCX archive must contain word/document.xml');
            results.docxXml = await zip.files['word/document.xml'].async('string');
        } else {
            results[format] = await blob.text();
        }
        const record = await getExportRecord({ accountId, conversationId });
        assert.equal(record?.format, format, `${conversationId}: delivered format must be recorded`);
        assert.equal(record?.status, outcome.partial ? 'partial' : 'ok');
    }

    // Confirm Detail was committed to L3a by the real L1 Provider
    assert.ok(await getDetail({ accountId, conversationId }), `${conversationId}: Detail must be persisted by Provider`);
    return results;
}

test('Cross-platform parity [ChatGPT derived DIL & questionnaire]: real ChatGPTProvider refreshes Index-only conversations and exports MD/HTML/JSON/DOCX/ZIP without leaking DIL source', async t => {
    const session = chatgptSessionGen('C_PARITY_EXPORT_SESSION_01');
    const dilAudit = chatgptDetailGen('C_DERIVED_DIL_MULTIMODAL_AUDIT_01');
    const compostQuiz = chatgptDetailGen('C_DERIVED_DYNAMIC_QUESTIONNAIRE_01');

    const host = offlineExportHost(t, async input => {
        const url = new URL(String(input));
        if (url.origin === 'https://chatgpt.com') {
            if (url.pathname === '/api/auth/session') return Response.json(session);
            if (url.pathname === `/backend-api/conversation/${dilAudit.id}`) return Response.json(dilAudit);
            if (url.pathname === `/backend-api/conversation/${compostQuiz.id}`) return Response.json(compostQuiz);
        }
        throw new Error('Unexpected ChatGPT HTTP request: ' + url);
    });

    const account = await getOrCreateAccount('chatgpt', '["parity-user","parity-workspace"]');
    await ingestIndexes(account.id, [
        { conversationId: dilAudit.id, fields: { title: dilAudit.title, titleSource: 'provider', updatedAt: 1760000120000 } },
        { conversationId: compostQuiz.id, fields: { title: compostQuiz.title, titleSource: 'provider', updatedAt: 1760000260000 } },
    ]);

    const dilOut = await exportFourFormatsFromIndexOnly(account.id, dilAudit.id, host);
    const quizOut = await exportFourFormatsFromIndexOnly(account.id, compostQuiz.id, host);
    const auditText = ['def syndrome(codeword):', '工程审计报告', '偶校验'];
    const quizText = ['家庭堆肥知识小问卷', '果皮和蔬菜残渣', '适当混合并保持透气', '颜色较深、质地疏松且有泥土气味'];
    const dilInternals = ['DIL.useState', 'setAnswers', 'GenUI.issueNewTurn'];
    assertContent(dilOut, auditText);
    assertContent(quizOut, quizText, dilInternals);

    // Batch ZIP archive across both ChatGPT conversations
    const batchBefore = host.blobs.length;
    const batch = await runExport({
        keys: [
            { accountId: account.id, conversationId: dilAudit.id },
            { accountId: account.id, conversationId: compostQuiz.id },
        ],
        format: 'markdown',
        delivery: 'browserDownload',
        includeAssets: false,
        skipUnchanged: false,
    });
    assert.equal(batch.exported, 2);
    assert.match(host.filenames[batchBefore], /\.zip$/);
    const zip = await JSZip.loadAsync(await host.blobs[batchBefore].arrayBuffer());
    const entries = Object.entries(zip.files).filter(([name, file]) => !file.dir && name.endsWith('.md'));
    assert.equal(entries.length, 2);
    const bodies = await Promise.all(entries.map(([, entry]) => entry.async('string')));
    const audit = bodies.find(body => body.includes(auditText[0]));
    const quiz = bodies.find(body => body.includes(quizText[1]));
    assert.ok(audit && quiz && audit !== quiz, 'each conversation must have its own Markdown entry');
    assertContent({ 'ZIP audit': audit }, auditText);
    assertContent({ 'ZIP questionnaire': quiz }, quizText, dilInternals);
});

test('Cross-platform parity [Claude native widgets & questionnaire]: real ClaudeProvider refreshes Index-only conversations and exports MD/HTML/JSON/DOCX without leaking private tool instructions', async t => {
    const host = offlineExportHost(t);

    const orgUuid = '11111111-1111-4111-8111-111111111111';
    const widgetsId = '11111111-1111-4111-8111-111111111111';
    const quizId = '22222222-2222-4222-8222-222222222222';
    const widgetsPayload = claudeDetailGen('CL_L1_SOURCE_WIDGETS_COMPLETE_01');
    const quizPayload = claudeDetailGen('CL_PARITY_QUESTIONNAIRE_01');
    const orgsPayload = claudeOrganizationsGen('CL_PARITY_EXPORT_ORG_01');

    Object.assign(globalThis.chrome, {
        tabs: { query: async () => [{ id: 101, url: 'https://claude.ai/new' }] },
        scripting: {
            executeScript: async (req: { args?: unknown[] }) => {
                const apiPath = String(req.args?.[0]);
                if (apiPath === '/api/organizations') return [{ result: { ok: true, value: orgsPayload } }];
                const detailPath = (id: string) => `/api/organizations/${orgUuid}/chat_conversations/${id}?tree=true&rendering_mode=messages&render_all_tools=true`;
                if (apiPath === detailPath(widgetsId)) {
                    return [{ result: { ok: true, value: widgetsPayload } }];
                }
                if (apiPath === detailPath(quizId)) {
                    return [{ result: { ok: true, value: quizPayload } }];
                }
                throw new Error('Unexpected Claude endpoint: ' + apiPath);
            },
        },
    });

    const account = await getOrCreateAccount('claude', orgUuid);
    await ingestIndexes(account.id, [
        { conversationId: widgetsId, fields: { title: 'Claude Native Widgets', titleSource: 'provider', updatedAt: 1760000000000 } },
        { conversationId: quizId, fields: { title: 'Claude Questionnaire', titleSource: 'provider', updatedAt: 1760000010000 } },
    ]);

    const widgetsOut = await exportFourFormatsFromIndexOnly(account.id, widgetsId, host);
    const quizOut = await exportFourFormatsFromIndexOnly(account.id, quizId, host);
    assertContent(widgetsOut, ['Resonator', 'f = 149.44', 'Derivation', 'Confirm the chosen units?'],
        ['PRIVATE SETUP', 'INTERNAL FILE CARD INSTRUCTIONS', 'PRIVATE-FILE-ID']);
    assertContent(quizOut, ['Which role?', 'Engineer', 'Researcher']);
});

function serveGrokDetail(conversationId: string, metadata: unknown, tree: unknown, responses: unknown) {
    const base = `/rest/app-chat/conversations/${conversationId}`;
    const endpoints = new Map([
        [`/rest/app-chat/conversations_v2/${conversationId}?includeWorkspaces=true&includeTaskResult=true`, metadata],
        [`${base}/response-node?includeThreads=true`, tree],
        [`${base}/load-responses`, responses],
    ]);
    const domOnlyImages: readonly never[] = [];
    Object.assign(globalThis.chrome, {
        tabs: { query: async () => [{ id: 102, url: 'https://grok.com/' }] },
        scripting: {
            executeScript: async (req: { args?: unknown[] }) => {
                const path = String(req.args?.[0]);
                if (endpoints.has(path)) return [{ result: { ok: true, value: endpoints.get(path) } }];
                if (path === conversationId) return [{ result: domOnlyImages }];
                throw new Error('Unexpected Grok endpoint: ' + path);
            },
        },
    });
}

test('P0 real capture [Grok text/table/code/math]: real GrokProvider refreshes Index-only conversation from captured Grok text endpoints and exports MD/HTML/JSON/DOCX', async t => {
    const host = offlineExportHost(t);

    const grokUserUuid = '11111111-1111-4111-8111-111111111111';
    const textWire = grokDetailGen('GR_DETAIL_TEXT_01');
    serveGrokDetail(textWire.id, grokMetadataGen('GR_METADATA_01'), grokTreeGen('GR_TREE_STABLE_01'), grokResponsesGen('GR_RESPONSES_01'));

    const account = await getOrCreateAccount('grok', grokUserUuid);
    await ingestIndexes(account.id, [
        { conversationId: textWire.id, fields: { title: textWire.metadata.conversation.title, titleSource: 'provider' } },
    ]);

    const out = await exportFourFormatsFromIndexOnly(account.id, textWire.id, host);
    for (const expected of ['Hierarchical, nested', 'import csv, json', 'E = mc^2']) {
        assert.ok(out.markdown.includes(expected), `Grok text MD missing ${expected}`);
        assert.ok(out.html.includes(expected), `Grok text HTML missing ${expected}`);
    }
    assert.ok(out.docxXml.includes('import csv, json') && out.docxXml.includes('<w:tbl>'), 'Grok DOCX must contain Python code and Word table');
    assertContent({ json: out.json }, ['Hierarchical, nested', 'import csv, json', 'E = mc^2']);
});

test('P0 real capture [Grok 3-turn image generation]: real GrokProvider refreshes Index-only conversation from captured Grok image endpoints and exports MD/HTML/JSON/DOCX with generated asset metadata', async t => {
    const host = offlineExportHost(t);

    const grokUserUuid = '11111111-1111-4111-8111-111111111111';
    const imageWire = grokDetailGen('GR_DETAIL_IMAGE_01');
    serveGrokDetail(imageWire.id, grokMetadataGen('GR_IMAGE_METADATA_01'), grokTreeGen('GR_IMAGE_TREE_STABLE_01'), grokResponsesGen('GR_IMAGE_RESPONSES_01'));

    const account = await getOrCreateAccount('grok', grokUserUuid);
    await ingestIndexes(account.id, [
        { conversationId: imageWire.id, fields: { title: imageWire.metadata.conversation.title, titleSource: 'provider' } },
    ]);

    const out = await exportFourFormatsFromIndexOnly(account.id, imageWire.id, host);
    const exportedJson = JSON.parse(out.json);
    assert.equal(exportedJson.account.providerId, 'grok');
    assert.equal(exportedJson.conversation.detail.messages.length, 6, '3-turn Grok image capture must preserve all 6 messages');
    assert.equal(exportedJson.conversation.detail.messages[5].model, 'imagine_x_1');
    assert.ok(
        exportedJson.conversation.detail.assets.some((a: { kind: string; sourceUri?: string; generation?: { prompt?: string } }) =>
            a.kind === 'image'
            && a.sourceUri?.startsWith('https://assets.grok.com/')
            && a.generation?.prompt?.includes('origami fox')),
        'Grok generated image asset metadata (sourceUri + generation prompt) must survive full pipeline export',
    );
    assertContent(out, [], ['<grok:render', '&lt;grok:render']);
    assert.ok(out.docxXml.includes('<w:tbl>'), 'Grok 3-turn DOCX export must render native table');
});

test('Cross-platform parity [Gemini P0 5-turn Bragg capture]: real GeminiProvider refreshes Index-only conversation and exports MD/HTML/JSON/DOCX with native Word math and tables', async t => {
    const convId = '681f66f21ffa9d2a';
    const rawWire = geminiDetailGen('G_P0_CAPTURED_MULTIMODAL_BRAGG_01');
    const host = offlineExportHost(t, async (input, init) => {
        const url = new URL(String(input));
        if (url.origin === 'https://gemini.google.com' && url.pathname.endsWith('/data/batchexecute')
            && init?.method === 'POST' && url.searchParams.get('rpcids')?.split(',').includes('hNvQHb')
            && new URLSearchParams(String(init?.body)).get('f.req')?.includes(`c_${convId}`)) {
            return new Response(rawWire);
        }
        throw new Error('Unexpected Gemini HTTP request: ' + url);
    });
    const account = await getOrCreateAccount('gemini', 'gaia-parity-001');

    Object.assign(globalThis.chrome, {
        tabs: {
            query: async () => [{ id: 101, url: 'https://gemini.google.com/u/1/app' }],
            sendMessage: async () => ({ ok: true, accountContext: { accountId: account.id, providerId: 'gemini', slot: 'u1' } }),
        },
    });

    const sessionStore: Record<string, unknown> = {
        gemini_credentials_map: {
            'sid-parity': { sid: 'sid-parity', at: 'AT_PARITY_TOKEN_12345', bl: 'boq_parity', accountSlot: 'u1', accountId: account.id, lastUsed: Date.now() },
        },
    };
    Object.assign(globalThis.chrome.storage, {
        session: {
            get: async (keys: string[]) => Object.fromEntries(keys.filter(k => k in sessionStore).map(k => [k, sessionStore[k]])),
            set: async (obj: Record<string, unknown>) => { Object.assign(sessionStore, obj); },
            remove: async () => {},
        },
    });
    await ingestIndexes(account.id, [
        { conversationId: convId, fields: { title: "Bragg's Law X-Ray Diffraction Schematic", titleSource: 'provider' } },
    ]);

    const out = await exportFourFormatsFromIndexOnly(account.id, convId, host);
    assert.ok(out.markdown.includes('$$') && out.markdown.includes('|'));
    assert.ok(out.html.includes('<table'));
    assert.ok(out.docxXml.includes('<w:tbl>') && out.docxXml.includes('<m:oMath'), 'Gemini DOCX must render native Word tables and OMML math');
    assert.equal(JSON.parse(out.json).conversation.detail.messages.length, 10, 'all five Gemini turns must reach JSON');
});
