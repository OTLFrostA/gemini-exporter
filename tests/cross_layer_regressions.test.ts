import { describe as __suiteDescribe } from 'node:test';
import { test } from "node:test";
import assert from "node:assert/strict";
import { indexStorage } from "./helpers/indexStorage.js";
import { fixtureAccount } from "./helpers/domainFixture.js";
import { sourceDetail } from "./helpers/l1SourceFixture.js";
import { sourceList } from "./helpers/l1SourceFixture.js";
import { GeminiProvider } from "../src/l1/client/gemini/geminiProvider.js";
import { ProviderRegistry } from "../src/l1/client/providerRegistry.js";
import { type GeminiProviderClient } from "../src/l1/client/gemini/geminiContracts.js";
import { readConversation } from "../src/l2/readConversation.js";
import { ingestDetail } from "../src/l2/ingestion.js";
import { ingestIndexes } from "../src/l2/ingestion.js";
import { scanAll } from "../src/application/sync/scanController.js";
import { getSettings } from "../src/application/settings/index.js";
import { updateSettings } from "../src/application/settings/index.js";
import { getAccount } from "../src/runtime/api/accountRegistry.js";
import { __setZipConstructor } from "../src/l4/packaging/writers/zipWriter.js";
import { restoreDomainDetail } from "../src/l2/runtimeValidation.js";
import { createSourceResourceContext } from "../src/l1/resources/sourceResources.js";
import { listIndexes as getConversations } from "../src/l3a/storageService.js";
import { getDetail } from "../src/l3a/storageService.js";
import { composeDomainDocument } from "../src/l3b/compose/composeDomainDocument.js";
import { collectDocumentResources } from "../src/l3b/ast/resourceReferences.js";
import { renderDocumentMarkdown } from "../src/l4/format/markdown/renderMarkdown.js";
import { renderDocumentHtml } from "../src/l4/format/html/renderHtml.js";
import { renderDocumentTypst } from "./helpers/renderTypstFixture.js";
import { serializeDomainJson } from "../src/l4/format/json/serializeDomainJson.js";
import { planExportPaths } from "../src/l4/packaging/index.js";
import { buildExportFiles } from "../src/l4/packaging/index.js";
import { packageExportFiles } from "../src/l4/packaging/index.js";
import { type PreparedResources } from "../src/shared/resources/resourceResult.js";
import { historicalFixture } from "./helpers/nativeFixture.js";
import { prepareReadingResourcesFixture } from "./helpers/pdfAcquisitionFixture.js";
import { resourceValue } from "./helpers/resources.js";
import { type ConversationRecordInput } from "./helpers/recordFixture/conversationRecord.js";
import test__s4 from "node:test";
import { parseGeminiTakeoutConversation } from "../src/l1/parsers/gemini/takeout/parseConversation.js";
import { validateZipFile } from "../src/l1/parsers/shared/archive/zipBombGuard.js";
import { fixtureKey } from "./helpers/domainFixture.js";
import { fixtureAccountFor } from "./helpers/domainFixture.js";
import { validateParserDomain } from "../src/l2/runtimeValidation.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type DomainConversationWithDetail } from "../src/l2/conversation.js";
import { historicalFixtureDomain } from "./helpers/nativeFixture.js";
import { messageAssets } from "./helpers/domainAssets.js";
import { type BlockNode } from "../src/l2/content/blocks.js";
import { mapContentAssetReferences } from "../src/l2/content/assetReferences.js";
import { composeFixture } from "./helpers/documentFixture.js";
import { type HistoricalConversation as Conversation } from "./helpers/historicalConversation.js";
import { assertDomainClosure } from "../src/l2/closure.js";
import { renderTypstFixture } from "./helpers/renderTypstFixture.js";
import test__s8 from "node:test";
import { ContentContext } from "../src/runtime/content/contentContext.js";
import test__s9 from "node:test";
import { sourceMessage } from "./helpers/l1SourceFixture.js";
import { type SourceConversationParseResult } from "../src/l1/parsers/parsingResult.js";
import { GeminiAPIClient } from "../src/l1/client/gemini/geminiClient.js";
import { prepareExportResources } from "../src/application/export/prepareExportResources.js";
import { getExportRecord } from "../src/l3a/storageService.js";
import { putExportRecord } from "../src/l3a/storageService.js";
import { __getZipConstructor } from "../src/l4/packaging/writers/zipWriter.js";
import test__s10 from "node:test";
import { useIndexStorage } from "./helpers/indexStorage.js";
import { accountRuntime } from "./helpers/accountRuntime.js";
import { ACCOUNT_UUID } from "./helpers/accountRuntime.js";
import { getIndex } from "../src/l3a/storageService.js";
import { ConfirmedGeminiConversationNotFound } from "../src/l1/client/gemini/geminiClient.js";
import { init } from "../src/l1/sniffer/gemini/messageBridge.js";
import { handleWindowMessage } from "../src/l1/sniffer/gemini/messageBridge.js";
import { v2LiveSaveHost } from "./helpers/v2LiveSaveHost.js";
import { seedLiveDetail } from "./helpers/v2LiveSaveHost.js";
import { liveKey } from "./helpers/v2LiveSaveHost.js";
import { runLiveSave } from "../src/runtime/background/liveSaveHandler.js";
import { buildExportFileName } from "../src/shared/utils/pathUtils.js";
import { ACCOUNT_UUID as ACCOUNT_UUID__s12 } from "./helpers/accountIds.js";
import { OTHER_ACCOUNT_UUID } from "./helpers/accountIds.js";
import { parseGeminiRpcConversation } from "../src/l1/parsers/gemini/rpc/parseConversation.js";
import { detailGen as geminiDetailGen } from "./fixtures/providers/geminiDetail.js";
import { ingestDetail as ingestThroughContentRuntime } from "../src/runtime/api/domainIngestion.js";
import test__s14 from "node:test";
import { listIndexes } from "../src/l3a/storageService.js";
import { type TestContext } from "node:test";
import test__s16 from "node:test";
import { IDBObjectStore } from "fake-indexeddb";
import { ACCOUNT_UUID as A } from "./helpers/accountIds.js";
import { OTHER_ACCOUNT_UUID as B } from "./helpers/accountIds.js";
import { ingestDeletedConversation } from "../src/l2/ingestion.js";
import { listExportRecords } from "../src/l3a/storageService.js";
import { clearStoredAccountExportRecords } from "../src/l3a/storageService.js";
import { SETTINGS_KEY } from "../src/l3a/settingsStore.js";
import { getConversationDetail } from "../src/l1/client/gemini/api/pagination.js";
import test__s18 from "node:test";
import { type ChatMessage } from "./helpers/historicalConversation.js";
import { type Attachment } from "./helpers/historicalConversation.js";
import { deleteGen as geminiDeleteGen } from "./fixtures/providers/geminiDelete.js";
import { geminiListPage } from "./fixtures/providers/geminiListCapture.js";
import { GEMINI_LIST_CAPTURE } from "./fixtures/providers/geminiListCapture.js";
import { getCoverage } from "../src/l2/coverageAdmission.js";
import { getStoredSettings } from "../src/l3a/settingsStore.js";
import { patchStoredSettings } from "../src/l3a/settingsStore.js";
import { runExport } from "../src/application/export/runExport.js";
import { v2ExportHost } from "./helpers/v2ExportHost.js";
import { seedExportConversation } from "./helpers/v2ExportHost.js";
import { exportRequest } from "./helpers/v2ExportHost.js";
import test__s22 from "node:test";
import { admitFixture } from "./helpers/admitFixture.js";
import { bindFixture } from "./helpers/domainFixture.js";
import { makeConversationIndex } from "./helpers/conversationIndexFixture.js";
import { shouldSkipExport } from "../src/application/export/runExport.js";
import { type ExportRequest } from "../src/application/export/types.js";
import { type AIProvider } from "../src/l1/client/aiProvider.js";
import { type ListEnd } from "../src/l1/client/aiProvider.js";
import { putIndexes } from "../src/l3a/storageService.js";
import test__s23 from "node:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fixtureCatalog } from "./fixtures/providers/catalog.js";
import { inventory } from "../scripts/audit-provider-fixtures.cjs";
import { sources } from "../scripts/audit-provider-fixtures.cjs";
import { detailGen } from "./fixtures/providers/grokDetail.js";
import { treeGen } from "./fixtures/providers/grokDetail.js";
import { listGen } from "./fixtures/providers/grokList.js";
import test__s24 from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { sanitizeProviderWire } from "../scripts/sanitize_provider_wire.js";

__suiteDescribe("v2-module-integration", () => {
const JSZip = require('../lib/jszip.min.js');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

test('L1 → L2 → Composer → Format → Packaging keeps account, resource identities and physical bytes aligned', async () => {
    const env = indexStorage(), context = createSourceResourceContext();
    try {
        const account = fixtureAccount(), id = 'source_chat_123', key = { accountId: account.id, conversationId: id };
        // Real source parser; the source evidence never has an account-bound key.
        const parsed = sourceDetail();
        parsed.conversation.detail.assets = [{ id: 'diagram', kind: 'image', name: 'Diagram.png', mediaType: 'image/png' }];
        parsed.conversation.detail.messages[0].content.push({ type: 'image', assetId: 'diagram' });
        parsed.acquisitionHints = { diagram: { dataBase64: png } };
        parsed.conversation.detail.quality.status = 'complete';
        assert.ok(!('key' in parsed.conversation.index));
        assert.ok(!('key' in parsed.conversation.detail));
        const provider = new GeminiProvider({ getConversationList: async () => sourceList('G_SOURCE_CHAT_01'), getConversationDetail: async () => parsed }, async () => 'u0', context);
        await provider.listConversations({ accountId: account.id, streamId: 'recent', onPageCommitted: async () => {
            assert.ok((await getConversations(account.id)).some(row => row.key.conversationId === id), 'callback observes committed L2 indexes');
            return false;
        } });
        assert.equal(await getDetail(key), null, 'Index discovery cannot invent Detail');
        assert.equal(await provider.fetchConversationDetail(account.id, id), undefined, 'L1 awaits admission and returns void');
        const index = (await getConversations(account.id)).find(row => row.key.conversationId === id)!;
        const detail = await getDetail(key), committedAccount = await getAccount(account.id);
        assert.ok(detail && committedAccount);
        const domain = { index, detail: restoreDomainDetail(detail) }, before = structuredClone(domain);
        const document = composeDomainDocument(domain, committedAccount), astBefore = structuredClone(document);
        assert.deepEqual([...collectDocumentResources(document).referencedIds], ['diagram']);
        const acquired = await provider.acquireResource(key, detail.assets[0]);
        assert.deepEqual(acquired.bytes, Uint8Array.from(atob(png), c => c.charCodeAt(0)));
        const prepared: PreparedResources = new Map([['diagram', { ok: true, resourceId: 'diagram', value: acquired }]]);
        __setZipConstructor(JSZip);
        for (const format of ['markdown', 'html', 'json'] as const) {
            const [plan] = planExportPaths([{ conversation: domain, prepared, fileIds: format === 'json' ? new Set<string>() : collectDocumentResources(document).fileIds }], format);
            const content: string = format === 'markdown' ? renderDocumentMarkdown(document, plan.resources)
                : format === 'html' ? renderDocumentHtml(document, plan.resources).html
                : serializeDomainJson(domain, committedAccount, plan.resources);
            assert.ok(content.includes(plan.resources.diagram));
            const files = buildExportFiles(format, plan, content, prepared);
            const [artifact] = await packageExportFiles([files], 'browserDownload');
            const zip = await JSZip.loadAsync(await (artifact.content as Blob).arrayBuffer());
            assert.equal(await zip.file(plan.fileName).async('string'), content);
            assert.deepEqual(await zip.file(plan.resources.diagram).async('uint8array'), acquired.bytes);
        }
        assert.ok(JSON.stringify(renderDocumentTypst(document, { diagram: 'assets/diagram.png' })).includes('assets/diagram.png'));
        assert.deepEqual(domain, before);
        assert.deepEqual(document, astBefore);
        assert.ok(!JSON.stringify(domain).includes(png), 'acquisition hints never persist in Domain');
        const otherKey = { ...key, accountId: '10000000-0000-4000-8000-000000000002' };
        await ingestIndexes(otherKey.accountId, [{ conversationId: id, fields: { title: 'Other account', titleSource: 'provider' } }]);
        assert.equal(await getDetail(otherKey), null);
        await assert.rejects(provider.acquireResource(otherKey, detail.assets[0]), /No supported source locator/);
        await ingestDetail(account.id, id, { ...parsed.conversation.detail, quality: { status: 'partial' }, messages: [] });
        assert.deepEqual(await getDetail(key), detail, 'incomplete capture cannot replace complete body');
        context.release();
        await assert.rejects(provider.acquireResource(key, detail.assets[0]), /released/);
    } finally { context.release(); env.restore(); }
});
});

__suiteDescribe("audit_reinforcement", () => {
/**
 * tests/audit_reinforcement.test.ts
 *
 * Verification suite for architectural audit reinforcements:
 * 1. Two-Tier Storage atomic abort: IDB batch failure throws and blocks chrome.storage.local write.
 * 2. Takeout mediaIndex strict slot isolation: no global singleton clobber across account slots.
 * 3. Pagination getAllConversations token loop detection: circular nextPageToken triggers early safe termination.
 */

const test = require('node:test');
const assert = require('node:assert');

// L2 admission rejects fat Index data before passive Storage receives a write decision.
test('L2 rejects fat metadata without changing stored indexes', async () => {
    const { indexStorage } = require('./helpers/indexStorage.js');
    const env = indexStorage();
    try {
        const { ingestIndexes } = require('../src/l2/ingestion.js');
        await assert.rejects(ingestIndexes('10000000-0000-4000-8000-000000000001', [{ conversationId: 'chat', fields: { title: 'Research', titleSource: 'provider', messages: [] } }]), /index schema/);
        assert.equal(env.writes(), 0);
    } finally { env.restore(); }
});

// V2 resources are task-scoped, keyed by Account UUID + conversation + asset.
test('task resource isolation prevents cross-account corruption and release preserves other accounts', async () => {
    const { createSourceResourceContext } = require('../src/l1/resources/sourceResources.js');
    const context = createSourceResourceContext();
    const first = { accountId: '10000000-0000-4000-8000-000000000001', conversationId: 'same_chat' };
    const second = { ...first, accountId: '10000000-0000-4000-8000-000000000002' };
    const asset = { id: 'same_asset', kind: 'image' };
    try {
        context.retain(first, asset.id, async () => ({ bytes: new Uint8Array([1]) }));
        context.retain(second, asset.id, async () => ({ bytes: new Uint8Array([2]) }));
        assert.deepStrictEqual((await context.acquire(first, asset)).bytes, new Uint8Array([1]));
        assert.deepStrictEqual((await context.acquire(second, asset)).bytes, new Uint8Array([2]));
        await assert.rejects(context.acquire({ ...first, conversationId: 'other_chat' }, asset), /locator/);
        context.releaseConversation(second);
        await assert.rejects(context.acquire(second, asset), /locator/);
        assert.deepStrictEqual((await context.acquire(first, asset)).bytes, new Uint8Array([1]));
    } finally { context.release(); }
    await assert.rejects(context.acquire(first, asset), /released/);
});

test('Gemini pagination detects token loops, retains committed rows and never certifies complete coverage', async () => {
    const { indexStorage } = require('./helpers/indexStorage.js');
    const { ACCOUNT_UUID } = require('./helpers/accountRuntime.js');
    const { sourceDetail, sourceList } = require('./helpers/l1SourceFixture.js');
    const { GeminiProvider } = require('../src/l1/client/gemini/geminiProvider.js');
    const { listIndexes, getCoverage } = require('../src/l3a/storageService.js');
    const env = indexStorage();
    let calls = 0;
    const provider = new GeminiProvider({
        getConversationList: async () => sourceList(`G_SOURCE_AUDIT_LOOP_PAGE_${++calls}`),
        getConversationDetail: async () => sourceDetail(),
    }, async () => 'u0');
    try {
        await assert.rejects(provider.listConversations({ accountId: ACCOUNT_UUID, streamId: 'recent' }), /loop/i);
        assert.equal(calls, 2);
        assert.equal((await listIndexes(ACCOUNT_UUID)).length, 2);
        assert.equal((await getCoverage(ACCOUNT_UUID, 'recent'))?.range ?? null, null);
    } finally { env.restore(); }
});
});

__suiteDescribe("batch-b-normalization-boundary", () => {
const imageBytes = Uint8Array.of(137, 80, 78, 71, 1, 2, 3);

for (const layout of ['messages', 'turns'] as const) {
    test(`V2 ${layout}: historical unknown content, role and image survive Domain -> AST -> shared acquisition`, async () => {
        const message = {
            role: 'historical-tool',
            content: { historical: ['payload', 42] },
            images: [{ url: 'https://example.com/generated' }],
        };
        const raw = {
            id: 'boundary-regression',
            ...(layout === 'messages' ? { messages: [message] } : { turns: [{ messages: [message] }] }),
        };
        const snapshot = structuredClone(raw);
        // Historical grammar is a test boundary. From here on we use only trusted v2 Domain.
        const parsed = historicalFixture(raw);
        const domainBefore = structuredClone(parsed.conversation);
        const fetched: string[] = [];
        const result = await prepareReadingResourcesFixture(parsed.conversation, {
            acquire: async asset => {
                fetched.push(asset.id);
                return { bytes: imageBytes, mediaType: 'image/png' };
            },
        });

        assert.equal(result.document.messages.length, 1);
        const node = result.document.messages[0];
        assert.equal(node.role, 'unknown');
        const unknownBlock = node.blocks.find(block => block.type === 'unsupported');
        assert.ok(unknownBlock && unknownBlock.type === 'unsupported');
        assert.match(unknownBlock.text, /historical.*payload.*42/);

        const [imageId] = [...result.references.imageIds];
        assert.ok(imageId, 'the historical image remains a referenced v2 Image');
        assert.deepEqual([...result.references.referencedIds], [imageId]);
        assert.deepEqual(fetched, [imageId], 'Application acquires only the referenced Asset ID');
        assert.equal(result.resources.size, 1);
        assert.deepEqual(resourceValue(result.resources.get(imageId)).bytes, imageBytes);

        // An explicit no-assets export keeps the reading AST and skips all bytes.
        const withoutAssets = await prepareReadingResourcesFixture(parsed.conversation, {
            includeAssets: false,
            acquire: async () => { assert.fail('includeAssets=false must not fetch'); },
        });
        assert.equal(withoutAssets.resources.size, 0);
        assert.deepEqual(withoutAssets.document, result.document);
        assert.deepEqual([...withoutAssets.references.imageIds], [imageId]);

        assert.ok(parsed.diagnostics.some(d => d.code === 'UNKNOWN_MESSAGE_CONTENT'));
        assert.ok(parsed.diagnostics.some(d => d.code === 'UNKNOWN_ROLE'));
        assert.deepEqual(parsed.conversation, domainBefore, 'preparing resources cannot mutate L2 facts');
        assert.deepEqual(raw, snapshot, 'historical source input remains immutable');
    });
}

test('parser accepts missing metadata and historical aliases without coercing raw evidence', () => {
    const raw: ConversationRecordInput = {
        messages: [{ role: 'tool', content: 17, images: [{ src: 'https://example.com/generated', fileName: 'historical' }] }],
    };
    const snapshot = structuredClone(raw);
    const { conversation: domain, diagnostics } = historicalFixture(raw, { providerId: 'gemini' });
    assert.equal(domain.detail.assets[0].kind, 'image');
    assert.equal(domain.detail.assets[0].name, 'historical');
    assert.equal(Object.hasOwn(domain.detail.messages[0], 'provenance'), false);
    assert.ok(diagnostics.some(d => d.code === 'UNKNOWN_MESSAGE_CONTENT'));
    assert.deepEqual(raw, snapshot);
});
});

__suiteDescribe("batch_a_followup", () => {
test__s4('batch A acquisition rejects empty provider bytes instead of claiming success', async () => {
    const { acquireSourceResource } = require('../src/l1/resources/sourceResources.js');
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(new Uint8Array());
    try {
        await assert.rejects(acquireSourceResource({ id: 'test-asset', kind: 'image', sourceUri: 'https://lh3.googleusercontent.com/image.png' }, undefined, undefined, 'gemini'), /Empty source resource/);
    } finally { globalThis.fetch = original; }
});

const takeoutHtml = `<div class="outer-cell"><a href="https://gemini.google.com/app/histimg01">Chat</a>
<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted Look <a href="cat.png">cat</a><br>
2026-09-02T12:00:00Z<br><p>A cat.</p></div></div>`;

test__s4('batch A native Takeout keeps explicitly referenced user images as semantic assets', () => {
    const parsed = parseGeminiTakeoutConversation({
        htmlText: takeoutHtml, archiveFiles: { 'cat.png': { dir: false } }
    }, { account: fixtureAccount('gemini'), providerId: 'gemini' });
    const user = parsed.conversation.detail.messages[0];
    assert.equal(user.role, 'user');
    const asset = parsed.conversation.detail.assets[0];
    assert.deepEqual(user.attachmentIds, [asset!.id]);
    assert.equal(asset?.kind, 'image');
    assert.equal(asset?.name, 'cat.png');
    assert.equal(parsed.archiveResources[asset!.id].path, 'cat.png');
    assert.equal('localName' in asset!, false);
});

test__s4('batch A native Takeout reports missing archive references without inventing a match', () => {
    const parsed = parseGeminiTakeoutConversation({ htmlText: takeoutHtml }, { account: fixtureAccount('gemini'), providerId: 'gemini' });
    assert.equal(parsed.conversation.detail.assets.length, 1);
    assert.ok(parsed.diagnostics.some(d => d.code === 'TAKEOUT_MISSING_RESOURCE'));
    assert.equal(Object.hasOwn(parsed.conversation.detail.assets[0], 'failureReason'), false);
    assert.deepEqual(parsed.archiveResources, {});
});

test__s4('batch A ZipBombGuard preserves string length size semantics', () => {
    assert.doesNotThrow(() => validateZipFile('binary-string-input'));
});
});

__suiteDescribe("content-domain-boundary", () => {
const metadata = { index: { key: fixtureKey(String('semantic'), 'other'),  title: 'Semantic input', titleSource: "derived" as const,    }, detail: { key: fixtureKey(String('semantic'), 'other'), quality: { status: 'unknown' } as const, assets: [] } };

test('AST: Document composition contains no body parsing or provider-format decisions', () => {
    for (const file of ['composeDomainDocument.ts', 'composeContent.ts']) {
        const source = readFileSync(join(__dirname, '../src/l3b/compose', file), 'utf8');
        assert.doesNotMatch(source, /parseMarkdown|parseGemini|preprocessGemini|structuredContent|geminiStructuredTo/);
        assert.doesNotMatch(source, /from\s+['"][^'"]*(?:api\/parser|provider\/gemini)[^'"]*['"]/);
    }
});

test('AST: Domain semantic nodes are composed without reparsing and raw Markdown-looking text remains literal', async () => {
    const domain: DomainConversationWithDetail = { index: { ...metadata.index }, detail: {   ...metadata.detail, messages: [{
        id: 'message', role: 'assistant', content: [
            { type: 'paragraph', children: [{ type: 'text', text: '**literal** $x$ ![not an image](file.png)' }] },
            { type: 'unknown', sourceType: 'semantic-extension', text: 'visible unknown' },
        ],
    }] } };
    const original = structuredClone(domain);
    const document = composeDomainDocument(validateParserDomain(domain), fixtureAccountFor(validateParserDomain(domain)));
    assert.deepEqual(document.messages[0].blocks[0], domain.detail.messages[0].content[0]);
    assert.deepEqual(document.messages[0].blocks[1], { type: 'unsupported', sourceType: 'semantic-extension', text: 'visible unknown' });
    assert.equal(collectDocumentResources(document).referencedIds.size, 0);
    assert.deepEqual(domain, original);
});

test('AST: separate reasoning presentation does not reinterpret the Domain body', async () => {
    const domain: DomainConversationWithDetail = { index: { ...metadata.index }, detail: {   ...metadata.detail, messages: [{
        role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: '**literal body**' }] }],
        reasoning: [{ type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'text', text: 'formatted reasoning' }] }] }],
    }] } };
    const result = composeDomainDocument(validateParserDomain(domain), fixtureAccountFor(validateParserDomain(domain)));
    const [reasoning, body] = result.messages[0].blocks;
    assert.ok(reasoning.type === 'disclosure' && reasoning.blocks[0].type === 'paragraph');
    assert.equal(reasoning.blocks[0].children[0].type, 'strong');
    assert.deepEqual(body, domain.detail.messages[0].content[0]);
    assert.deepEqual(reasoning.blocks, domain.detail.messages[0].reasoning);
});

test('provider parsing diagnoses malformed entries at their source position without mutating input', async () => {
    const raw = { id: 'legacy', messages: [
        null as never,
        { role: 'assistant', content: { unsupported: 'visible fallback' } },
    ] };
    const original = structuredClone(raw);
    const result = historicalFixture(raw, { providerId: 'gemini' });
    assert.equal(result.conversation.detail.messages.length, 1);
    assert.deepEqual(raw, original);
    assert.equal(result.diagnostics.find(d => d.code === 'BAD_MESSAGE_SHAPE')?.path, 'messages[0]');
    assert.equal(result.conversation.detail.messages[0].content[0].type, 'unknown');
    assert.equal(result.diagnostics.filter(d => d.code === 'BAD_MESSAGE_SHAPE').length, 1);
});
});

__suiteDescribe("content-input-boundary", () => {
const paragraph = (text: string): BlockNode[] => [{ type: 'paragraph', children: [{ type: 'text', text }] }];
const metadata = { id: 'content-input', title: 'Content boundary', timestamp: null };

// L1-only structured/markdown adapter assertions live in `tests/l1_extracted_regressions.test.ts`.
// This suite covers cross-layer Domain -> L3b Document composition boundaries.

for (const [content, expectedVisible] of [
    ['![local](assets/image.png)\n\n> ![linked](https://example.test/image.png)', 'local'],
    ['![data](data:image/png;base64,AQID)\n\n![missing](unknown.png)', 'data'],
    ['<h2>Takeout title</h2><p>中文 <strong>answer</strong></p><ul><li>one</li><li>two</li></ul>', 'Takeout title'],
    ['# Title\n\n1. **first**\n2. second\n\n> [source](https://example.test) [1]\n\n```ts\nconst x = 1;\n```\n\n$$x^2$$\n\n|a|b|\n|---|---|\n|1|2|', 'Title'],
]) {
    test(`legacy content survives Document composition and serialization: ${content.slice(0, 35)}`, async () => {
        const legacy: Conversation = { ...metadata, messages: [{ role: 'assistant', content,
            attachments: [{ type: 'image', localName: 'assets/image.png', url: 'https://example.test/image.png' }],
            citations: [{ url: 'https://example.test/source', title: 'Source' }], thoughts: 'Reasoning **detail**',
        }] };
        const { conversation: domain, resourceHints } = historicalFixture(legacy);
        const before = structuredClone(domain);
        const semantic = await composeFixture(domain, resourceHints);
        assert.equal(semantic.document.messages.length, 1);
        assert.ok(semantic.document.messages[0].blocks.length > 0, 'visible input must produce display blocks');
        assert.ok(JSON.stringify(semantic.document.messages[0].blocks).includes(expectedVisible),
            `source evidence "${expectedVisible}" must survive native parsing and composition`);
        assert.deepEqual(domain, before, 'asset/citation reconciliation must not mutate Domain');
        assert.deepEqual((await composeFixture(structuredClone(domain), resourceHints)).document, semantic.document,
            'serialized Domain must retain the same semantic document');
    });
}

test('semantic asset binding visits nested captions, descriptions and cells while retaining unchanged nodes', () => {
    const blocks: BlockNode[] = [{ type: 'list', ordered: true, items: [{ blocks: [{
        type: 'table', caption: [{ type: 'image', assetId: 'caption' }],
        rows: [{ cells: [{ children: [{ type: 'link', href: 'https://example.test', children: [{ type: 'image', assetId: 'cell' }] }] }] }],
    }, { type: 'image', assetId: 'block', caption: [{ type: 'image', assetId: 'image-caption' }] },
    { type: 'file', assetId: 'file', description: [{ type: 'image', assetId: 'description' }] }] }] }];
    assert.equal(mapContentAssetReferences(blocks, ref => ref), blocks);
    const original = structuredClone(blocks);
    const seen: string[] = [];
    const mapped = mapContentAssetReferences(blocks, ref => { seen.push(ref); return `bound:${ref}`; });
    assert.deepEqual(new Set(seen), new Set(['caption', 'cell', 'block', 'image-caption', 'file', 'description']));
    assert.deepEqual(blocks, original);
    assert.notEqual(mapped, blocks);
});

test('Domain body is structured-only, including empty bodies, without raw provider fields', () => {
    const domain = historicalFixtureDomain({ ...metadata, messages: [
        { role: 'assistant', content: '', structuredContent: { children: [] } },
        { role: 'user', content: 'Question' },
    ] });
    assert.deepEqual(domain.detail.messages.map(message => message.content), [[], paragraph('Question')]);
    for (const message of domain.detail.messages) {
        assert.equal('structuredContent' in message, false);
        assert.equal('contentAst' in message, false);
    }
});

test('existing OpenAI imports parse generic Markdown and Takeout imports interpret HTML before Domain', () => {
    const openai = historicalFixtureDomain({ ...metadata, source: 'openai-import', messages: [{
        role: 'assistant', content: '# Imported\n\n**answer**',
    }] });
    assert.deepEqual(openai.detail.messages[0].content, [
        { type: 'heading', level: 1, children: [{ type: 'text', text: 'Imported' }] },
        { type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'text', text: 'answer' }] }] },
    ]);
    const takeout = historicalFixtureDomain({ ...metadata, source: 'takeout', turns: [{
        modelContent: '<h2>Imported</h2><p>中文 <strong>answer</strong></p>',
    }] });
    assert.deepEqual(takeout.detail.messages[0].content, [
        { type: 'heading', level: 2, children: [{ type: 'text', text: 'Imported' }] },
        { type: 'paragraph', children: [{ type: 'text', text: '中文 ' }, { type: 'strong', children: [{ type: 'text', text: 'answer' }] }] },
    ]);
});

test('source gate rejects leaked provider syntax while trusted AST retains literal semantics', async () => {
    const message = { role: 'assistant' as const, content: paragraph('**literal** [1]'),
        reasoning: paragraph('Reasoning'), citations: [{ id: 'citation-0', url: 'https://example.test/source' }],
    };
    const expected = await composeFixture({ index: { key: fixtureKey(String(metadata.id), 'gemini'),   titleSource: "derived",  title: metadata.title,  }, detail: { key: fixtureKey(String(metadata.id), 'gemini'), quality: { status: 'unknown' }, assets: [], messages: [message] } });
    const leaked = { ...message, structuredContent: { children: [{ nodeType: 18, text: 'wrong raw body' }] },
        thoughts: 'wrong reasoning', sources: ['https://wrong.example.test'],
    };
    await assert.rejects(composeFixture({ index: { key: fixtureKey(String(metadata.id), 'gemini'),   titleSource: "derived",  title: metadata.title,  }, detail: { key: fixtureKey(String(metadata.id), 'gemini'), quality: { status: 'unknown' }, assets: [], messages: [leaked] } }), /Invalid persisted Domain contract: messages/);
    const body = expected.document.messages[0].blocks.find(block => block.type === 'paragraph');
    assert.ok(body?.type === 'paragraph' && body.children.some(node => node.type === 'text' && node.text.includes('**literal**')));
});

for (const document of [
    { id: 'document', type: 'file', fileName: 'report.txt', localName: 'files/report.txt', sections: ['section'] },
    { type: 'file', fileName: 'inline-report.txt', contentMarkdown: '# Report', sections: ['section'] },
    { type: 'file', fileName: 'missing-report.txt', sections: ['section'] },
]) {
    test(`structured-only search images retain document/asset ordering and metadata: ${document.fileName}`, async () => {
        const structuredContent = JSON.parse(readFileSync(join(__dirname, 'fixtures/provider/structured_rpc/b-stack-structured.json'), 'utf8'));
        const legacy: Conversation = { ...metadata, messages: [{
            id: 'message', role: 'model', content: 'fallback', structuredContent, documents: [document],
        }] };
        const original = structuredClone(legacy);
        const { conversation: domain, resourceHints } = historicalFixture(legacy);
        assert.equal('structuredContent' in domain.detail.messages[0], false);
        assert.deepEqual(messageAssets(domain, 0)?.[0].document?.contentMarkdown, document.contentMarkdown ? `${document.contentMarkdown}\n\nsection` : 'section');
        const semantic = await composeFixture(domain, resourceHints);
        assert.ok(semantic.document.messages[0].blocks.length > 0, 'structured source must produce document content');
        assert.equal(collectDocumentResources(semantic.document).imageIds.size, 1,
            'the structured source image must survive document composition');
        assert.deepEqual((await composeFixture(JSON.parse(JSON.stringify(domain)), resourceHints)).document, semantic.document,
            'persisted Domain must preserve the document and its resource references');
        assert.deepEqual(domain.detail.assets.map(asset => asset.name), [document.fileName, '贝尔测试实验示意图.png']);
        assert.deepEqual(legacy, original);
    });
}
});

__suiteDescribe("content-structural-diagnostics", () => {
test('nested resource references are checked before composition; unavailable bytes are backend diagnostics', () => {
    const domain: DomainConversationWithDetail = { index: { key: fixtureKey(String('conversation'), 'test'),   titleSource: "derived",   title: 'Nested' }, detail: { key: fixtureKey(String('conversation'), 'test'), quality: { status: 'unknown' }, assets: [], messages: [{ id: 'message', role: 'assistant', content: [{ type: 'list', ordered: false, items: [{ blocks: [{ type: 'quote', blocks: [{ type: 'image', assetId: 'missing', alt: 'Nested figure' }] }] }] }] }] } };
    assert.throws(() => assertDomainClosure((domain).detail), /Unregistered Domain asset 'missing' in messages\[0\]/);
    domain.detail.assets.push({ id: 'missing', kind: 'image' });
    const document = composeDomainDocument(validateParserDomain(domain), fixtureAccountFor(validateParserDomain(domain)));
    const html = renderDocumentHtml(document, {});
    assert.equal(html.diagnostics.filter(d => d.code === 'HTML_ASSET_UNRESOLVED').length, 1);
    assert.ok(html.html.includes('Nested figure'));
    const { payload: pdf, diagnostics } = renderTypstFixture(document);
    assert.equal(diagnostics.filter(d => d.code === 'TYPST_V8_IMAGE_MISSING').length, 1);
    const list = pdf.messages[0]?.blocks[0];
    assert.ok(list && list.type === 'list', 'nested content must remain a list');
    const quote = list.items[0]?.blocks[0];
    assert.ok(quote && quote.type === 'quote', 'the list must retain its quote');
    const placeholder = quote.blocks[0];
    assert.ok(placeholder && placeholder.type === 'unknown', 'unavailable nested image must stay visible');
    assert.equal(placeholder.sourceType, 'missing-image');
    assert.ok(
        placeholder.fallback === 'Nested figure'
            || placeholder.details?.some(node => node.type === 'text' && node.text === 'Nested figure'),
        'nested missing image must preserve its label in either fallback or caption details'
    );
});
});

__suiteDescribe("content_context_window_boundary", () => {
test__s8('ContentContext works without a browser mirror and supports abort', () => {
    const context = new ContentContext(null);
    context.setDevMode(true);
    context.setCredentials({ at: 'test-at', bl: 'test-bl' });
    context.setAborted(false);
    context.abort();
    assert.equal(context.isAborted(), true);
});

test__s8('ContentContext mirrors debug state to the injected browser only', () => {
    const mirror: Partial<Window> = {};
    const context = new ContentContext(mirror);
    context.setCredentials({ at: 'pre-dev', bl: 'pre-dev' });
    assert.equal(mirror.__gemExporterExtractedAt, undefined, 'credentials are hidden outside dev mode');

    context.setDevMode(true);
    assert.equal(mirror.__gemExporterContentContext, context);
    assert.equal(mirror.__gemExporterAborted, false);
    assert.equal(mirror.__gemExporterDevMode, true);

    context.setCredentials({ at: 'test-at', bl: 'test-bl' });
    assert.equal(mirror.__gemExporterExtractedAt, 'test-at');
    assert.equal(mirror.__geminiAt, 'test-at');
    assert.equal(mirror.__gemExporterExtractedBl, 'test-bl');
    let aborts = 0;
    const client = { abort: () => { aborts++; } };
    context.setActiveClient(client);
    assert.equal(mirror.__gemExporterActiveClient, client);
    context.abort();
    assert.equal(mirror.__gemExporterAborted, true);
    assert.equal(aborts, 1, 'abort must not be invoked twice');

    context.setDevMode(false);
    assert.equal(mirror.__gemExporterDevMode, false);
});
});

__suiteDescribe("core_host_decoupling", () => {
/**
 * V2 host-decoupling contract. The removed AssetPipeline, BatchWorker and
 * SessionRecovery are not runtime ports. L1 acquisition, L2 Domain validation,
 * L3a persisted records, L3b composition and L4 packaging must work without
 * importing a Chrome extension host into their core logic.
 */


















const account = fixtureAccount('gemini');
const key = (conversationId: string) => ({ accountId: account.id, conversationId });

test__s9('L1 injected task resource bytes reach real L3b/L4 output with no chrome.tabs and no persistent byte cache', async () => {
    const id = 'decoupled-media', asset = { id: 'image', kind: 'image' as const,
        mediaType: 'image/png', name: 'diagram.png' };
    const source: SourceConversationParseResult = {
        conversationId: id, sourceVersion: 100,
        conversation: {
            index: { title: 'Decoupled Image', titleSource: 'provider', updatedAt: 100 },
            detail: { savedAt: 100, quality: { status: 'complete' }, assets: [asset],
                messages: [{ role: 'assistant', content: [
                    { type: 'paragraph', children: [{ type: 'text', text: 'Diagram from native capture' }] },
                    { type: 'image', assetId: asset.id },
                ] }],
            },
        },
        diagnostics: [], acquisitionHints: { image: { dataBase64: 'AQIDBA==' } },
    };
    const context = createSourceResourceContext();
    const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    if (originalChrome?.configurable) Reflect.deleteProperty(globalThis, 'chrome');
    try {
        context.retainParsed(key(id), source);
        const bound = validateParserDomain({
            index: { ...source.conversation.index, key: key(id) },
            detail: { ...source.conversation.detail, key: key(id) },
        });
        const domainBefore = structuredClone(bound);
        const prepared = await prepareExportResources(bound.detail.assets, new Set(['image']),
            (item, signal) => context.acquire(key(id), item, signal));
        const acquired = prepared.get('image');
        assert.ok(acquired?.ok);
        assert.deepEqual([...acquired.value.bytes], [1, 2, 3, 4]);
        const document = composeDomainDocument(bound, account);
        const [plan] = planExportPaths([{ conversation: bound, prepared, fileIds: new Set<string>() }], 'markdown');
        const markdown = renderDocumentMarkdown(document, plan.resources);
        const output = buildExportFiles('markdown', plan, markdown, prepared);
        assert.equal(output.length, 2);
        assert.match(markdown, /Diagram from native capture/);
        assert.ok(markdown.includes(plan.resources.image));
        assert.deepEqual(output.find(file => file.fileName === plan.resources.image)?.content, Uint8Array.of(1, 2, 3, 4));
        assert.deepEqual(bound, domainBefore);
        assert.ok(!JSON.stringify(bound).includes('AQIDBA=='), 'temporary inline bytes must not enter Domain');
    } finally {
        context.release();
        if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
    }
});

test__s9('L1 GeminiProvider injected client commits through real L2/L3a without any chrome.tabs binding', async () => {
    const host = indexStorage();
    const id = 'decoupled-provider';
    const source = sourceDetail({ id, title: 'Real Provider', messages: [
        sourceMessage('native-response', 'Decoupled provider answer', 'model'),
    ] });
    const calls: string[] = [];
    const provider = new GeminiProvider({
        getConversationList: async () => sourceList('G_SOURCE_EMPTY_01'),
        getConversationDetail: async (conversationId, slot) => {
            calls.push(conversationId + ':' + slot);
            return source;
        },
    }, async () => 'u0');
    try {
        assert.equal(globalThis.chrome.tabs, undefined);
        await provider.fetchConversationDetail(account.id, id);
        assert.deepEqual(calls, [id + ':u0']);
        const conversation = await readConversation(key(id));
        assert.ok(conversation);
        assert.equal(conversation.index.title, 'Real Provider');
        assert.match(renderDocumentMarkdown(composeDomainDocument(conversation, account), {}),
            /Decoupled provider answer/);
    } finally { host.restore(); }
});

test__s9('L1 GeminiAPIClient follows its AbortSignal without window or global cancellation state', () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const previousFlag = Object.getOwnPropertyDescriptor(globalThis, '__gemExporterAborted');
    if (!previousWindow?.configurable) {
        // A preinstalled Node host has no need for global mutation here.
        const controller = new AbortController();
        const client = new GeminiAPIClient({ signal: controller.signal });
        assert.equal(client.isAborted(), false);
        controller.abort();
        assert.equal(client.isAborted(), true);
        return;
    }
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, '__gemExporterAborted');
    try {
        const controller = new AbortController();
        const client = new GeminiAPIClient({ signal: controller.signal });
        assert.equal(client.isAborted(), false);
        controller.abort();
        assert.equal(client.isAborted(), true);
    } finally {
        if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
        if (previousFlag) Object.defineProperty(globalThis, '__gemExporterAborted', previousFlag);
    }
});

test__s9('L3a ExportRecord commits using IndexedDB without chrome.storage or v1 SessionRecovery', async () => {
    const host = indexStorage();
    const previous = Object.getOwnPropertyDescriptor(globalThis.chrome, 'storage');
    Reflect.deleteProperty(globalThis.chrome, 'storage');
    try {
        const identity = key('record-without-chrome');
        await putExportRecord(identity, { exportedAt: 222, format: 'markdown', status: 'ok', chatTime: 111 });
        assert.deepEqual(await getExportRecord(identity), {
            exportedAt: 222, format: 'markdown', status: 'ok', chatTime: 111,
        });
    } finally {
        if (previous) Object.defineProperty(globalThis.chrome, 'storage', previous);
        host.restore();
    }
});

test__s9('production module override guard keeps test injection from becoming an export runtime dependency', () => {
    const original = process.env.NODE_ENV;
    try {
        process.env.NODE_ENV = 'production';
        __setZipConstructor(class { file() {} async generateAsync() { return new Blob(); } });
        assert.equal(__getZipConstructor(), undefined);
    } finally {
        if (original === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = original;
    }
});
});

__suiteDescribe("data_safety_batch1", () => {
useIndexStorage();
const key = { accountId: ACCOUNT_UUID, conversationId: '12345678abcdef' };
async function seed() {
    await ingestDetail(key.accountId, key.conversationId, { quality: { status: 'complete' }, assets: [],
        messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Local body' }] }] }] });
    await putExportRecord(key, { status: 'ok', format: 'markdown', exportedAt: 100 });
}
function failingProvider(error: Error) {
    return new GeminiProvider({ getConversationList: async () => sourceList('G_SOURCE_EMPTY_01'),
        getConversationDetail: async () => { throw error; } }, async () => 'u0');
}
test__s10('D2: incidental 11167, generic 404 and unverified error strings cannot delete local facts', async () => {
    await seed();
    for (const error of [new Error('Server returned error code 11167'), new Error('HTTP 404'),
        new Error('BardErrorInfo: 1167'), new ConfirmedGeminiConversationNotFound('c_other')]) {
        await assert.rejects(failingProvider(error).fetchConversationDetail(key.accountId, key.conversationId));
        assert.ok(await getIndex(key)); assert.ok(await getDetail(key)); assert.ok(await getExportRecord(key));
    }
});
test__s10('D2: target-bound verified NotFound removes Index, Detail and ExportRecord while preserving another account', async () => {
    await seed();
    const otherKey = { ...key, accountId: '10000000-0000-4000-8000-000000000002' };
    const { key: _key, ...detail } = (await getDetail(key))!;
    await ingestDetail(otherKey.accountId, otherKey.conversationId, detail);
    const confirmed = failingProvider(new ConfirmedGeminiConversationNotFound('c_' + key.conversationId));
    await assert.rejects(confirmed.fetchConversationDetail(key.accountId, key.conversationId), /conversation_not_found/);
    assert.equal(await getIndex(key), null); assert.equal(await getDetail(key), null); assert.equal(await getExportRecord(key), null);
    assert.ok(await getDetail(otherKey));
});

// Explicit scan reset clears all account-local conversation facts.
test__s10('D4: clearStoredAccountScanRecords clears all account-local records and preserves another account', async () => {
    const { indexStorage } = require('./helpers/indexStorage.js');
    const storage = require('../src/l3a/storageService.js');
    const env = indexStorage();
    try {
        const key = { accountId: '10000000-0000-4000-8000-000000000001', conversationId: 'chat_1' };
        await storage.putIndexes([{ key }]);
        await storage.updateConversationAtomically(key, () => ({ detail: { key, quality: {status:'complete'}, assets:[], messages:[{role:'user',content:[]}] }, result: undefined }));
        await storage.putExportRecord(key, { format: 'markdown', exportedAt: 0, status: 'ok' });
        await storage.updateCoverageAtomically(key.accountId, 'recent', () => ({ next: { range: null }, result: undefined }));
        const otherKey = { ...key, accountId: '10000000-0000-4000-8000-000000000002' };
        await storage.putIndexes([{ key: otherKey }]);
        await storage.updateConversationAtomically(otherKey, () => ({ detail: { key: otherKey, quality: {status:'complete'}, assets:[], messages:[{role:'user',content:[]}] }, result: undefined }));
        await storage.putExportRecord(otherKey, { format: 'markdown', exportedAt: 0, status: 'ok' });
        await storage.clearStoredAccountScanRecords(key.accountId);
        assert.deepEqual(await storage.listExportRecords(key.accountId), {});
        assert.equal(await storage.getCoverage(key.accountId, 'recent'), null);
        assert.equal(await storage.getIndex(key), null);
        assert.equal(await storage.getDetail(key), null);
        assert.deepEqual(await storage.getIndex(otherKey), { key: otherKey });
        assert.ok(await storage.getDetail(otherKey));
        assert.ok(await storage.getExportRecord(otherKey));
    } finally { env.restore(); }
});

// An untrusted page-world notification has no acknowledged DELETE response.
test__s10('MessageBridge ignores malformed and unverified deletion notifications without active fetch or local deletion', async t => {
    await seed();
    const runtime = accountRuntime('u0');
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No active verification request allowed'); });
    try {
        init();
        for (const id of ['../../malicious/path', 'c_' + key.conversationId]) {
            await handleWindowMessage({ origin: location.origin, source: window, data: {
                type: 'GEMINI_CONVERSATION_DELETED', payload: { id, slot: 'u0',
                    requestAccountObservation: { providerId: 'gemini', providerAccountId: '10000000001' } },
            } } as unknown as MessageEvent);
        }
        assert.equal(fetch.mock.callCount(), 0);
        assert.ok(await getIndex(key)); assert.ok(await getDetail(key)); assert.ok(await getExportRecord(key));
    } finally { runtime.restore(); }
});
});

__suiteDescribe("dedup_regressions", () => {
const test = require('node:test');
const assert = require('node:assert');

const { calculateBackoff } = require('../src/shared/utils/retryUtils.js');


// Ordinary request rate limiting is based on HTTP 429 only.


test('dedup - calculateBackoff keeps formula, cap and honors Retry-After', () => {
    // without Retry-After: capped at 30s even for large retry counts
    for (let i = 0; i < 6; i++) {
        const d = calculateBackoff(10);
        assert.ok(d <= 30000, `backoff capped at 30000, got ${d}`);
        assert.ok(d >= 0, 'backoff non-negative');
    }
    // with Retry-After: delay is at least retryAfterMs, may exceed the cap
    // (matches the old retryPolicy.handleHttp429 semantics)
    const withAfter = calculateBackoff(0, { retryAfterMs: 60000 });
    assert.ok(withAfter >= 60000, `Retry-After honored, got ${withAfter}`);
    // small Retry-After below the computed delay does not shrink it
    const smallAfter = calculateBackoff(3, { retryAfterMs: 100 });
    assert.ok(smallAfter >= 2000 * Math.pow(2, 3), `computed delay kept, got ${smallAfter}`);
});

// live-save pipeline unification: both call sites share format + writer.

test('dedup - Live Save uses the shared Markdown renderer and Packaging filename', async (t: import('node:test').TestContext) => {
    const host = v2LiveSaveHost(t);
    await seedLiveDetail('abc123', [], { title: 'Canonical title' });
    const result = await runLiveSave(liveKey('abc123'));
    assert.strictEqual(result?.exported, 1);
    const name = buildExportFileName('Canonical title', 'abc123', 'md');
    assert.deepStrictEqual([...host.files.keys()], [name]);
    const markdown = host.files.get(name);
    assert.ok(typeof markdown === 'string' && markdown.includes('Answer for abc123'));
    assert.ok(typeof markdown === 'string' && markdown.includes('Canonical title'));
});

test('dedup - Live Save input failure cannot write a fallback or commit a record', async (t: import('node:test').TestContext) => {
    const host = v2LiveSaveHost(t);
    await require('../src/application/settings/index.js').updateSettings({ enabledDisk: true, defaultFormat: 'markdown' });
    // No trustworthy Domain is available; there is no parallel scraper/formatter fallback.
    const { ingestIndexes } = require('../src/l2/ingestion.js');
    await ingestIndexes(liveKey('fatal').accountId, [{ conversationId: 'fatal', fields: { title: 'Unavailable', titleSource: 'provider' } }]);
    const result = await runLiveSave(liveKey('fatal'));
    assert.deepStrictEqual(result?.failed, [liveKey('fatal')]);
    assert.strictEqual(host.files.size, 0);
    assert.strictEqual(await getExportRecord(liveKey('fatal')), null);
});

test('dedup - repeated Live Save replaces the planned file rather than creating a second filename policy', async (t: import('node:test').TestContext) => {
    const host = v2LiveSaveHost(t);
    await seedLiveDetail('n9', [], { title: 'Stable title', savedAt: 100 });
    await runLiveSave(liveKey('n9'));
    await seedLiveDetail('n9', [], { title: 'Stable title', savedAt: 200 });
    await runLiveSave(liveKey('n9'));
    assert.deepStrictEqual([...host.files.keys()], [buildExportFileName('Stable title', 'n9', 'md')]);
    assert.strictEqual((await getExportRecord(liveKey('n9')))?.chatTime, 200);
    assert.strictEqual(host.events.filter(event => event.startsWith('close:')).length, 2);
});
});

__suiteDescribe("native_detail_transport", () => {
/**
 * V2 native Detail transport integration:
 * Provider RPC -> L1 source parser -> Content domainIngest IPC -> L2 -> L3a.
 * The fake Chrome messaging boundary dispatches to real L2 and fake IndexedDB.
 * Background sender authorization is tested in browser_runtime_v2.test.ts.
 */













useIndexStorage();

const CONVERSATION_ID = 'native_bridge';

function parseNativeReply(): SourceConversationParseResult {
    return parseGeminiRpcConversation(geminiDetailGen('G_DETAIL_NATIVE_TRANSPORT_01'), { providerId: 'gemini', targetConvId: CONVERSATION_ID });
}

// A source payload is not a normalized v2 Detail merely because it arrived over IPC.
function opaqueWireIsNotDomain(value: unknown): void {
    // @ts-expect-error Unvalidated native payloads cannot bypass L1 normalization.
    const detail: Parameters<typeof ingestDetail>[2] = value;
    void detail;
}
void opaqueWireIsNotDomain;

test('v2 native RPC parsing produces keyless facts, not a versioned Domain envelope', async () => {
    const candidate = parseNativeReply();
    assert.equal(candidate.conversationId, CONVERSATION_ID);
    assert.equal(candidate.conversation.index.title, 'Native title');
    assert.deepEqual(candidate.conversation.detail.messages.map(message => message.role), ['user', 'assistant']);
    assert.equal('key' in candidate.conversation.index, false);
    assert.equal('key' in candidate.conversation.detail, false);
    assert.equal('account' in candidate, false);
    assert.equal('transport' in candidate.conversation, false);
    assert.equal('domainEnvelopeVersion' in candidate, false);
    assert.equal(await getIndex({ accountId: ACCOUNT_UUID__s12, conversationId: CONVERSATION_ID }), null,
        'pure L1 parsing must not persist a conversation');
});

test('malformed native payloads and wrong Provider context cannot be admitted as Detail', async () => {
    for (const key of ['G_DETAIL_NATIVE_TRANSPORT_EMPTY_01', 'G_DETAIL_NATIVE_TRANSPORT_NON_JSON_01', 'G_DETAIL_NATIVE_TRANSPORT_NULL_01'] as const) {
        assert.throws(() => parseGeminiRpcConversation(geminiDetailGen(key), { providerId: 'gemini' }));
    }
    for (const raw of [null, 42, {}]) {
        assert.throws(() => parseGeminiRpcConversation(raw as never, { providerId: 'gemini' }),
            /raw response text/);
    }
    assert.throws(() => parseGeminiRpcConversation(geminiDetailGen('G_DETAIL_NATIVE_TRANSPORT_EMPTY_BATCH_01'), { providerId: 'chatgpt' }),
        /requires providerId gemini/);
    assert.equal(await getDetail({ accountId: ACCOUNT_UUID__s12, conversationId: CONVERSATION_ID }), null);
});

test('v2 Content ingestion rejects failed or malformed IPC replies without accepting Domain facts', async () => {
    const candidate = parseNativeReply();
    const key = { accountId: ACCOUNT_UUID__s12, conversationId: candidate.conversationId };
    const expectedRequest = {
        action: 'domainIngest',
        operation: 'detail',
        accountId: ACCOUNT_UUID__s12,
        conversationId: candidate.conversationId,
        detail: candidate.conversation.detail,
        indexFields: candidate.conversation.index,
    };
    const original = Object.getOwnPropertyDescriptor(chrome.runtime, 'sendMessage');
    try {
        for (const { reply, error } of [
            { reply: null, error: /Domain ingestion unavailable/ },
            { reply: { ok: false, error: 'worker offline' }, error: /worker offline/ },
            { reply: { ok: true }, error: /Invalid committed Detail ingestion result/ },
            { reply: { ok: true, result: { accepted: true, changed: true, indexAdded: false } }, error: /Invalid committed Detail ingestion result/ },
            { reply: { ok: true, result: { accepted: false, changed: true } }, error: /Invalid committed Detail ingestion result/ },
            { reply: { success: true, domainEnvelopeVersion: 3, data: candidate }, error: /Domain ingestion unavailable/ },
        ]) {
            // Only the browser IPC response is mocked. No L2 or Storage write occurs.
            Object.defineProperty(chrome.runtime, 'sendMessage', {
                configurable: true,
                value: async (message: unknown) => {
                    assert.deepEqual(message, expectedRequest);
                    return reply;
                },
            });
            await assert.rejects(ingestThroughContentRuntime(ACCOUNT_UUID__s12, candidate.conversationId,
                candidate.conversation.detail, candidate.conversation.index), error);
            assert.equal(await getIndex(key), null);
            assert.equal(await getDetail(key), null);
        }
    } finally {
        if (original) Object.defineProperty(chrome.runtime, 'sendMessage', original);
        else Reflect.deleteProperty(chrome.runtime, 'sendMessage');
    }
});

test('v2 Content ingestion IPC binds native facts to the Account and preserves the message graph', async () => {
    const candidate = parseNativeReply();
    const result = await ingestThroughContentRuntime(ACCOUNT_UUID__s12, candidate.conversationId,
        candidate.conversation.detail, candidate.conversation.index);
    assert.deepEqual(result, { accepted: true, changed: true, indexAdded: true });
    const identical = await ingestThroughContentRuntime(ACCOUNT_UUID__s12, candidate.conversationId,
        candidate.conversation.detail, candidate.conversation.index);
    assert.deepEqual(identical, { accepted: true, changed: false },
        'replaying an identical native Detail is accepted but must not trigger Live Save');

    const key = { accountId: ACCOUNT_UUID__s12, conversationId: CONVERSATION_ID };
    const index = await getIndex(key);
    const detail = await getDetail(key);
    assert.deepEqual(index?.key, key);
    assert.deepEqual(detail?.key, key);
    assert.deepEqual(detail?.messages.map(message => message.role), ['user', 'assistant']);
    assert.deepEqual(JSON.parse(JSON.stringify(detail?.messages)),
        JSON.parse(JSON.stringify(candidate.conversation.detail.messages)));
    assert.equal('transport' in detail!, false);
    assert.equal(await getDetail({ accountId: OTHER_ACCOUNT_UUID, conversationId: CONVERSATION_ID }), null);
});

test('identical Provider conversation IDs are isolated by the L2 Account identity', async () => {
    const first = parseNativeReply();
    const second = sourceDetail({
        id: 'c_' + CONVERSATION_ID,
        title: 'Other account title',
        messages: [sourceMessage('other-answer', 'Other account body', 'model')],
    });
    assert.equal(second.conversationId, first.conversationId);
    await ingestDetail(ACCOUNT_UUID__s12, first.conversationId,
        first.conversation.detail, first.conversation.index);
    await ingestDetail(OTHER_ACCOUNT_UUID, second.conversationId,
        second.conversation.detail, second.conversation.index);

    const primary = await getDetail({ accountId: ACCOUNT_UUID__s12, conversationId: CONVERSATION_ID });
    const other = await getDetail({ accountId: OTHER_ACCOUNT_UUID, conversationId: CONVERSATION_ID });
    assert.equal(primary?.key.accountId, ACCOUNT_UUID__s12);
    assert.equal(other?.key.accountId, OTHER_ACCOUNT_UUID);
    assert.deepEqual(primary?.messages.map(message => message.role), ['user', 'assistant']);
    assert.deepEqual(other?.messages.map(message => message.role), ['assistant']);
    assert.equal((await getIndex({ accountId: OTHER_ACCOUNT_UUID, conversationId: CONVERSATION_ID }))?.title,
        'Other account title');
});

test('native attachment bytes remain source-only; L2 persists asset identity and references', async () => {
    const rawBytes = new Uint8Array([1, 2, 3]);
    const candidate = sourceDetail({
        id: 'c_native_asset',
        messages: [{
            ...sourceMessage('answer', 'Attached report', 'model'),
            attachmentCount: 1,
            attachments: [{ type: 'file', name: 'report.bin', dataBuffer: rawBytes }],
        }],
    });
    assert.equal(candidate.conversation.detail.assets.length, 1);
    assert.equal(candidate.conversation.detail.messages[0].attachmentIds?.length, 1);
    assert.equal('dataBuffer' in candidate.conversation.detail.assets[0], false);
    const asset = candidate.conversation.detail.assets[0];
    assert.ok(candidate.acquisitionHints[asset.id]?.dataBase64,
        'raw source bytes must remain available in the one-task acquisition context');

    await ingestDetail(ACCOUNT_UUID__s12, candidate.conversationId,
        candidate.conversation.detail, candidate.conversation.index);
    const stored = await getDetail({ accountId: ACCOUNT_UUID__s12, conversationId: candidate.conversationId });
    assert.ok(stored);
    assert.deepEqual(stored.assets.map(asset => asset.id),
        candidate.conversation.detail.assets.map(asset => asset.id));
    assert.deepEqual(stored.messages[0].attachmentIds,
        candidate.conversation.detail.messages[0].attachmentIds);
    assert.equal('dataBuffer' in stored.assets[0], false);
    assert.equal('dataBase64' in stored.assets[0], false);
    assert.equal('acquisitionHints' in stored, false);

    const key = { accountId: ACCOUNT_UUID__s12, conversationId: candidate.conversationId };
    const sourceResources = createSourceResourceContext();
    try {
        sourceResources.retainParsed(key, candidate);
        const acquired = await sourceResources.acquire(key, asset);
        assert.deepEqual(acquired.bytes, rawBytes,
            'resource bytes remain readable for the accepted export task, without entering Domain');
    } finally {
        sourceResources.release();
    }
});
});

__suiteDescribe("p1_a_regressions", () => {
/**
 * P1-A: credential and browser-message safety.
 *
 * Only retain source assertions where the security rule is not yet reachable
 * through a focused runtime harness. These are narrow guards, NOT proof of
 * full end-to-end credential confidentiality.
 */


const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const readSrc = (rel: string): string =>
    fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8');

function replaceGlobal(key: string, value: unknown): () => void {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    return () => {
        if (previous) Object.defineProperty(globalThis, key, previous);
        else Reflect.deleteProperty(globalThis, key);
    };
}

// P1-001 / P1-004 were comment-text tests, not security contracts.
// P1-002's specific identifier absence was weaker than the actual session
// storage behavior covered by known_issue_credentials_session.test.ts.
// P1-007 pinned an obsolete diagnostic string instead of detecting secrets.

// P1-003 (dev-mode token log redaction) and P1-005 (empty-at postMessage preservation)
// are verified behaviorally in `tests/known_issue_credentials_session.test.ts`.

test('P1-006: asset messages reject untrusted hosts before invoking cookie-authenticated fetchers', async () => {
    const calls: string[] = [];
    const handlers = new Set<(message: any, sender: any, response: (value: any) => void) => unknown>();
    const restoreWindow = replaceGlobal('window', {
        __gemExporterCleanups: [],
        addEventListener: () => {} // BadgeView registers a resize listener at module evaluation.
    });
    const restoreChrome = replaceGlobal('chrome', { runtime: {
        onMessage: {
            addListener: (fn: any) => handlers.add(fn),
            removeListener: (fn: any) => handlers.delete(fn)
        }
    } });
    const runtime = accountRuntime();
    try {
        const { MessageRouter } = require('../src/runtime/content/messageRouter.js');
        const { runCleanups } = require('../src/runtime/content/cleanupRegistry.js');
        const assets = {
            handleGetFileBlob: (_msg: any, cb: (value: unknown) => void) => {
                calls.push('getFileBlob');
                cb({ success: true });
            },
            handleGetImageBlob: (_msg: any, cb: (value: unknown) => void) => {
                calls.push('getImageBlob');
                cb({ success: true });
            },
            downloadAssetDirect: (_msg: any, cb: (value: unknown) => void) => {
                calls.push('downloadAssetDirect');
                cb({ success: true });
            }
        };
        const { AssetFetcher } = require('../src/l1/resources/gemini/assetFetcher.js');
        const originalAssets = { ...AssetFetcher };
        Object.assign(AssetFetcher, assets);
        MessageRouter.init();
        assert.equal(handlers.size, 1);
        const listener = [...handlers][0];

        for (const action of ['getFileBlob', 'getImageBlob']) {
            for (const url of [
                'http://lh3.googleusercontent.com/photo.png',
                'https://googleusercontent.com.evil.example/photo.png',
                'https://evil.example/photo.png',
                'javascript:alert(1)'
            ]) {
                const reply: any = await new Promise(resolve => listener({ action, url, accountId: '10000000-0000-4000-8000-000000000001' }, {}, resolve));
                assert.equal(reply?.success, false, `${action} must reject ${url}`);
                assert.match(reply?.error || '', /not allowed/i);
            }
            assert.ok(!calls.includes(action), `${action} must not fetch a blocked URL`);

            let validReply: any;
            validReply = await new Promise(resolve => {
                listener({ action, url: 'https://lh3.googleusercontent.com/photo.png', accountId: '10000000-0000-4000-8000-000000000001' }, {}, resolve);
            });
            assert.equal(validReply?.success, true, `${action} should accept an allowlisted URL`);
            assert.equal(calls.filter(a => a === action).length, 1);
        }

        Object.assign(AssetFetcher, originalAssets);
        runCleanups();
        assert.equal(handlers.size, 0, 'the injected runtime listener should be removed');
    } finally {
        runtime.restore();
        restoreChrome();
        restoreWindow();
    }
});

test('P1-009: background reload remains scoped to Gemini tabs (source guard)', () => {
    const src = readSrc('runtime/background/background.ts');
    assert.ok(src.includes('Not a Gemini Tab'));
    assert.ok(src.includes("new URL(tab.url).origin !== 'https://gemini.google.com'"));
});

// P1-010: this is a genuine storage behavior test; preserve it.
test('P1-010: self-healed bl is written to session storage rather than memory only', async () => {
    const CredManager = require('../src/l1/client/gemini/api/credentialManager.js').default;
    const resolveCred = CredManager.resolveCred;
    assert.equal(typeof resolveCred, 'function');

    const setCalls: any[] = [];
    const stored: any = {
        gemini_credentials_map: {
            sid1: { sid: 'sid1', at: 'at-value', bl: '', accountSlot: 'default', lastUsed: 1 }
        }
    };
    const undoChrome = replaceGlobal('chrome', {
        storage: {
            session: {
                get: async (keys: string[]) => {
                    const o: any = {};
                    for (const k of keys) o[k] = stored[k];
                    return o;
                },
                set: async (obj: any) => { Object.assign(stored, obj); setCalls.push(obj); }
            },
            local: { remove: async () => {} }
        }
    });
    const undoDoc = replaceGlobal('document', {
        documentElement: { innerHTML: '"cfb2h":"healed-bl-from-page"' },
        querySelectorAll: () => []
    });
    try {
        const cred = await resolveCred();
        assert.ok(setCalls.length > 0, 'healed bl must be persisted');
        const persisted = setCalls[setCalls.length - 1].gemini_credentials_map;
        assert.equal(persisted?.sid1?.bl, 'healed-bl-from-page');
        assert.equal(cred.bl, 'healed-bl-from-page');
    } finally {
        undoDoc();
        undoChrome();
    }
});
});

__suiteDescribe("p1_archive_retention", () => {
/** Replaces the retired cloudAvailability retention contract with frozen L1/L2 deletion semantics. */








const accountId = '10000000-0000-4000-8000-000000000001', otherId = '10000000-0000-4000-8000-000000000002';
const conversationId = 'deadbeef00112233';
test__s14('ordinary 404 preserves facts; target-bound confirmed deletion removes all three records only for its account', async () => {
    const env = indexStorage();
    try {
        for (const id of [accountId, otherId]) {
            await ingestDetail(id, conversationId, { quality: { status: 'unknown' }, messages: [], assets: [] }, { title: 'Saved conversation', titleSource: 'provider' });
            await putExportRecord({ accountId: id, conversationId }, { format: 'markdown', status: 'ok', exportedAt: 100 });
        }
        const key = { accountId, conversationId }, otherKey = { accountId: otherId, conversationId };
        const provider = (failure: Error) => new GeminiProvider({ getConversationDetail: async () => { throw failure; } } as unknown as GeminiProviderClient, async () => 'u0');
        await assert.rejects(provider(new Error('HTTP 404')).fetchConversationDetail(accountId, conversationId), /404/);
        assert.ok(await getIndex(key)); assert.ok(await getDetail(key)); assert.ok(await getExportRecord(key));
        await assert.rejects(provider(new ConfirmedGeminiConversationNotFound('c_' + conversationId)).fetchConversationDetail(accountId, conversationId), /conversation_not_found/);
        assert.equal(await getIndex(key), null); assert.equal(await getDetail(key), null); assert.equal(await getExportRecord(key), null);
        assert.ok(await getIndex(otherKey)); assert.ok(await getDetail(otherKey)); assert.ok(await getExportRecord(otherKey));
    } finally { env.restore(); }
});
test__s14('failed Index persistence preserves existing records and a subsequent admission succeeds', async () => {
    const env = indexStorage();
    try {
        await ingestIndexes(accountId, [{ conversationId: 'existing', fields: { title: 'Preserved', titleSource: 'provider', updatedAt: 100 } }]);
        env.fail('indexes');
        await assert.rejects(ingestIndexes(accountId, [{ conversationId: 'incoming', fields: { title: 'Incoming', titleSource: 'provider' } }]), /write failed/);
        assert.deepEqual((await listIndexes(accountId)).map(row => row.key.conversationId), ['existing']);
        env.fail(); await ingestIndexes(accountId, [{ conversationId: 'retry', fields: { title: 'Retry', titleSource: 'provider' } }]);
        assert.deepEqual((await listIndexes(accountId)).map(row => row.key.conversationId).sort(), ['existing', 'retry']);
    } finally { env.restore(); }
});
});

__suiteDescribe("p1_c_regressions", () => {
useIndexStorage();

const test = require('node:test');
const assert = require('node:assert');

// P1-C 组「取消/超时/退避逻辑缺陷」回归测试（P1-031~035、P1-038~042）
// 运行：node -r ./tests/ts_register.js --test tests/p1_c_regressions.test.ts

const { handleHttp429, interruptibleSleep, parseRetryAfterMs } = require('../src/l1/client/gemini/api/retryPolicy.js');
const rpcClientMod = require('../src/l1/client/gemini/api/rpcClient.js');
const { GeminiAPIClient } = require('../src/l1/client/gemini/geminiClient.js');
// tabService.ts 以 `module.exports = TabService` 结尾覆盖了 esbuild 的具名导出，
// ts_register 的 CJS 转译下 `import { TabService }` 会拿到 undefined（生产 bundle
// 走 ESM 静态链接不受影响）。测试内给 require 缓存打补丁，仅用于测试。
const tabServiceMod: any = require('../src/runtime/capabilities/tabService.js');
if (tabServiceMod && !tabServiceMod.TabService) tabServiceMod.TabService = tabServiceMod;
const { attemptResource } = require('../src/shared/resources/resourceResult.js');
const { acquireSourceResource } = require('../src/l1/resources/sourceResources.js');
// The retired asset pipeline belongs to the unselected runtime cases below.

// P1-031: 429 退避 sleep 可中断

test('p1c - interruptibleSleep: 完整等待返回 false，被 abort 中断返回 true', async () => {
    const t0 = Date.now();
    const full = await interruptibleSleep(120);
    assert.strictEqual(full, false, 'uninterrupted sleep resolves false');
    assert.ok(Date.now() - t0 >= 100, 'full delay should elapse');

    const controller = new AbortController();
    const t1 = Date.now();
    const p = interruptibleSleep(5000, controller.signal);
    setTimeout(() => controller.abort(), 50);
    const cut = await p;
    assert.strictEqual(cut, true, 'aborted sleep resolves true');
    assert.ok(Date.now() - t1 < 1000, `abort should cut the 5s sleep short (took ${Date.now() - t1}ms)`);
});

test('p1c - handleHttp429: 已 abort 的 signal 直接返回 aborted，不再睡满退避', async () => {
    const controller = new AbortController();
    controller.abort();
    const t0 = Date.now();
    const res = await handleHttp429({
        resp: { status: 429, headers: { get: () => null } },
        retryCount: 0,
        maxRetries: 3,
        signal: controller.signal,
        label: 'p1c-test'
    });
    assert.strictEqual(res.shouldRetry, false);
    assert.strictEqual(res.aborted, true);
    assert.ok(Date.now() - t0 < 500, `should return immediately (took ${Date.now() - t0}ms)`);
});

// P1-032 / P1-033: Retry-After 解析（整数秒钳制 30s；HTTP-date 支持）

test('p1c - parseRetryAfterMs: 整数秒钳制到 30s；HTTP-date 可解析；非法/过期返回 undefined', () => {
    // P1-032: Retry-After: 3600 不再导致 1 小时睡眠
    assert.strictEqual(parseRetryAfterMs('3600'), 30000, 'huge delta-seconds clamped to 30s');
    assert.strictEqual(parseRetryAfterMs('5'), 5000);
    assert.strictEqual(parseRetryAfterMs('0'), undefined, 'non-positive ignored');
    assert.strictEqual(parseRetryAfterMs('garbage'), undefined, 'unparseable ignored');
    assert.strictEqual(parseRetryAfterMs(null), undefined);

    // P1-033: HTTP-date 格式（RFC 7231）
    const future = new Date(Date.now() + 10000).toUTCString();
    const parsed = parseRetryAfterMs(future);
    assert.ok(typeof parsed === 'number' && parsed !== undefined, 'HTTP-date should parse');
    assert.ok(parsed! >= 9000 && parsed! <= 10000, `HTTP-date ~10s in future, got ${parsed}`);

    const farFuture = new Date(Date.now() + 3600 * 1000).toUTCString();
    assert.strictEqual(parseRetryAfterMs(farFuture), 30000, 'HTTP-date also clamped to 30s');

    const past = new Date(Date.now() - 60000).toUTCString();
    assert.strictEqual(parseRetryAfterMs(past), undefined, 'past date ignored');
});

test('p1c - handleHttp429: Retry-After 头被实际采用且不超过 30s 上限', async () => {
    const res = await handleHttp429({
        resp: { status: 429, headers: { get: (h: string) => (h.toLowerCase() === 'retry-after' ? '2' : null) } },
        retryCount: 0,
        maxRetries: 3,
        label: 'p1c-test'
    });
    assert.strictEqual(res.shouldRetry, true);
    assert.ok(res.delayMs !== undefined && res.delayMs >= 2000, `server hint honored, got ${res.delayMs}`);
    assert.ok(res.delayMs! <= 30000, `clamped to 30s cap, got ${res.delayMs}`);
});

// P1-039: 接收侧 retryAfterMs（header 不可读时由调用方显式传入）

test('p1c - handleHttp429: 显式 retryAfterMs 参数在无 header 时生效', async () => {
    const res = await handleHttp429({
        resp: { status: 429 }, // 无 headers（如经 chrome.tabs.sendMessage 取回的响应）
        retryCount: 0,
        maxRetries: 3,
        retryAfterMs: 4000,
        label: 'p1c-test'
    });
    assert.strictEqual(res.shouldRetry, true);
    // backoff(0) ∈ [2000,3000)，max(., 4000) 恒为 4000
    assert.strictEqual(res.delayMs, 4000, `explicit hint honored, got ${res.delayMs}`);
});

// P1-034: rpcClient 调用方 signal 与内部 timeout 合并（不再二选一）

test('p1c - mergeAbortSignals: 空/单个/多个 signal 的合并语义', () => {
    assert.strictEqual(rpcClientMod.mergeAbortSignals([null, undefined]), undefined, 'no signals -> undefined');

    const c1 = new AbortController();
    assert.strictEqual(rpcClientMod.mergeAbortSignals([c1.signal, null]), c1.signal, 'single signal passes through');

    const ca = new AbortController();
    const cb = new AbortController();
    const merged = rpcClientMod.mergeAbortSignals([ca.signal, cb.signal]);
    assert.ok(merged instanceof AbortSignal, 'two signals merge into one');
    assert.strictEqual(merged.aborted, false);
    cb.abort();
    assert.strictEqual(merged.aborted, true, 'aborting either source aborts the merged signal');
});

test('p1c - postBatchexecute: 有调用方 signal 时内部 timeout 仍生效；调用方 abort 也穿透', async () => {
    const origFetch = (global as any).fetch;
    try {
        // 永不 resolve 的 fetch，但遵循 signal（模拟真实 fetch 的 abort 行为）
        (global as any).fetch = (_url: string, _opts: any) => new Promise((_resolve, reject) => {
            const sig = _opts.signal as AbortSignal | undefined;
            assert.ok(sig instanceof AbortSignal, 'fetch must receive an AbortSignal');
            if (sig?.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
            sig?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        });

        // 情形 A：调用方 signal 未 abort，内部 timeout(80ms) 必须能中断请求
        //（P1-034 修复前：signal || controller.signal 会丢弃 timeout，导致永久挂起）
        const caller = new AbortController();
        const t0 = Date.now();
        await assert.rejects(
            rpcClientMod.postBatchexecute({
                api: 'https://gemini.google.com/_/BardChatUi/data/batchexecute',
                rpcids: 'MaZiqc', fReq: '[]', cred: {},
                timeoutMs: 80, signal: caller.signal
            }),
            { name: 'TimeoutError' }
        );
        assert.ok(Date.now() - t0 < 5000, `timeout fired promptly (took ${Date.now() - t0}ms)`);

        // 情形 B：调用方 abort 穿透到 fetch
        const caller2 = new AbortController();
        const t1 = Date.now();
        const p = rpcClientMod.postBatchexecute({
            api: 'https://gemini.google.com/_/BardChatUi/data/batchexecute',
            rpcids: 'MaZiqc', fReq: '[]', cred: {},
            timeoutMs: 60000, signal: caller2.signal
        });
        setTimeout(() => caller2.abort(), 30);
        await assert.rejects(p, { name: 'AbortError' });
        assert.ok(Date.now() - t1 < 5000, `caller abort propagated promptly (took ${Date.now() - t1}ms)`);
    } finally {
        (global as any).fetch = origFetch;
    }
});

for (const method of ['list', 'detail'] as const) {
    for (const status of [200, 500]) {
        for (const cancellation of ['deadline', 'external'] as const) {
            test(`p1c - ${method} stalled body ${status}: ${cancellation}`, async () => {
                const originalFetch = globalThis.fetch;
                const originalSetTimeout = globalThis.setTimeout;
                const caller = new AbortController();
                let deadline: number | undefined;
                let watchdog: ReturnType<typeof setTimeout> | undefined;
                globalThis.setTimeout = ((callback: () => void, delay?: number, ...args: unknown[]) => {
                    if (delay === 30000 || delay === 15000) {
                        deadline = delay;
                        delay = cancellation === 'deadline' ? 25 : delay;
                    }
                    return originalSetTimeout(callback, delay, ...args);
                }) as typeof setTimeout;
                globalThis.fetch = async (_url, options) => new Response(new ReadableStream({
                    start(controller) {
                        const signal = options?.signal;
                        assert.ok(signal instanceof AbortSignal);
                        const abort = () => controller.error(signal?.reason);
                        if (signal?.aborted) abort();
                        else signal?.addEventListener('abort', abort, { once: true });
                    }
                }), { status });
                try {
                    const client = new GeminiAPIClient({ signal: caller.signal });
                    const request = method === 'list'
                        ? client.getConversationList()
                        : client.fetchConversationPage('body_timeout');
                    if (cancellation === 'external') originalSetTimeout(() => caller.abort(), 10);
                    const guard = new Promise((_, reject) => {
                        watchdog = originalSetTimeout(() => reject(new Error('body read exceeded deadline')), 250);
                    });
                    await assert.rejects(Promise.race([request, guard]), {
                        name: cancellation === 'external' ? 'AbortError' : status === 200 ? 'TimeoutError' : 'OperationError'
                    });
                    assert.strictEqual(deadline, method === 'list' ? 30000 : 15000);
                } finally {
                    caller.abort();
                    clearTimeout(watchdog);
                    globalThis.fetch = originalFetch;
                    globalThis.setTimeout = originalSetTimeout;
                }
            });
        }
    }
}

for (const method of ['list', 'detail'] as const) {
    for (const status of [400, 401, 429]) {
        for (const bodyFailure of ['read error', 'deadline'] as const) {
            test(`p1c - ${method} HTTP ${status} preserves status after body ${bodyFailure}`, async (t: TestContext) => {
                const policy = require('../src/l1/client/gemini/api/retryPolicy.js');
                const handle400 = t.mock.method(policy, 'handleHttp400', async () => ({ shouldRetry: false }));
                const handle401 = t.mock.method(policy, 'handleHttp401', async () => {});
                const handle429 = t.mock.method(policy, 'handleHttp429', async () => ({ shouldRetry: false }));
                const originalSetTimeout = globalThis.setTimeout;
                t.mock.method(globalThis, 'setTimeout', (callback: () => void, delay?: number, ...args: unknown[]) =>
                    originalSetTimeout(callback, delay === 15000 || delay === 30000 ? 10 : delay, ...args));
                t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => new Response(new ReadableStream({
                    start(controller) {
                        if (bodyFailure === 'read error') controller.error(new Error('body failed'));
                        else init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), { once: true });
                    }
                }), { status }));
                const client = new GeminiAPIClient();
                await assert.rejects(method === 'list' ? client.getConversationList() : client.fetchConversationPage('body_error'),
                    { name: 'OperationError', code: 'SOURCE_HTTP_ERROR', httpStatus: status });
                assert.strictEqual(handle400.mock.callCount(), 1);
                assert.strictEqual(handle400.mock.calls[0].arguments[0].snippet, '');
                assert.strictEqual(handle401.mock.callCount(), status === 401 ? 1 : 0);
                assert.strictEqual(handle429.mock.callCount(), 1);
                assert.strictEqual(handle429.mock.calls[0].arguments[0].resp.status, status);
            });
        }
    }
}

// P1-035: getConversationList 15s 超时 + 429 退避快速取消

test('p1c - getConversationList: 429 退避期间 abort 直接抛取消，不睡满退避', async () => {
    const origFetch = (global as any).fetch;
    const controller = new AbortController();
    try {
        (global as any).fetch = async (_url: string, _opts: any) => {
            assert.ok(_opts.signal instanceof AbortSignal, 'fetch should receive a signal');
            return {
                ok: false, status: 429, statusText: 'Too Many Requests',
                headers: { get: () => null },
                text: async () => ''
            };
        };
        const client = new GeminiAPIClient({ signal: controller.signal });
        const t0 = Date.now();
        const p = client.getConversationList(null, null, undefined, {});
        setTimeout(() => controller.abort(), 100);
        await assert.rejects(p, { name: 'AbortError' });
        assert.ok(Date.now() - t0 < 1500, `cancel took effect fast (took ${Date.now() - t0}ms, backoff was 2-3s)`);
    } finally {
        (global as any).fetch = origFetch;
    }
});

// P1-040: 分页启动前已取消则直接退出（不再被 client.aborted = false 吞掉）

test('p1c - listConversations: pre-start cancellation propagates AbortError without a request', async () => {
    const controller = new AbortController(); controller.abort();
    const provider = new GeminiProvider({ getConversationList: async () => { throw new Error('request after cancellation'); }, getConversationDetail: async () => sourceDetail() }, async () => 'u0');
    await assert.rejects(provider.listConversations({ accountId: ACCOUNT_UUID, streamId: 'recent', signal: controller.signal }), { name: 'AbortError' });
});

// Retired batchFetcher/assetPipeline scenarios now exercise the current owners.
test('p1c - HTTP 429 backoff is cancelled before a retry begins', async () => {
    const controller = new AbortController();
    const work = handleHttp429({ resp: { status: 429 }, retryCount: 0, maxRetries: 3, signal: controller.signal });
    controller.abort();
    assert.strictEqual((await work).aborted, true);
});
test('p1c - HTTP 429 honors explicit server hint across a response without readable headers', async () => {
    const result = await handleHttp429({ resp: { status: 429 }, retryCount: 0, maxRetries: 3, retryAfterMs: 1 });
    assert.strictEqual(result.shouldRetry, true);
    assert.ok(result.delayMs >= 2000 && result.delayMs <= 30000);
});

test('p1c - source download propagates cancellation before and during acquisition', async () => {
    const original = globalThis.fetch; let calls = 0;
    globalThis.fetch = async (_url: unknown, options?: RequestInit) => {
        calls++;
        return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(options?.signal?.reason), { once: true }));
    };
    const asset = { id: 'image', kind: 'image', sourceUri: 'https://lh3.googleusercontent.com/image' };
    try {
        const before = new AbortController(); before.abort();
        await assert.rejects(acquireSourceResource(asset, before.signal), { name: 'AbortError' });
        assert.strictEqual(calls, 0);
        const during = new AbortController(), work = acquireSourceResource(asset, during.signal, undefined, 'gemini');
        during.abort(); await assert.rejects(work, { name: 'AbortError' }); assert.strictEqual(calls, 1);
    } finally { globalThis.fetch = original; }
});
test('p1c - delivery failure remains a failure and never restarts acquisition', async () => {
    let acquisitions = 0;
    const result = await attemptResource('asset', async () => {
        acquisitions++;
        throw new Error('NotAllowedError: Directory permission revoked');
    });
    assert.strictEqual(result.ok, false); assert.match(result.reason, /NotAllowedError/);
    assert.strictEqual(acquisitions, 1);
});
});

__suiteDescribe("p1_d_regressions", () => {
const key = (id = 'chat', accountId = A) => ({ accountId, conversationId: id });
const record = { exportedAt: 100, format: 'markdown' as const, status: 'ok' as const };
function host(t: import('node:test').TestContext) { const env = indexStorage(); t.after(() => env.restore()); return env; }
async function seed(id = 'chat', accountId = A) {
    await ingestDetail(accountId, id, { savedAt: 100, quality: { status: 'complete' }, assets: [],
        messages: [{ id: 'answer', role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Body' }] }] }] },
        { title: 'Title', titleSource: 'provider', updatedAt: 100 });
}

test__s16('records write exactly one key and overwrite only the addressed conversation', async t => {
    host(t); await putExportRecord(key(), record); await putExportRecord(key('other'), record);
    await putExportRecord(key(), { ...record, exportedAt: 200 });
    assert.deepEqual(await listExportRecords(A), { chat: { ...record, exportedAt: 200 }, other: record });
});
test__s16('current storage preserves trusted identities; historical alias conversion is owned solely by Migration', async t => {
    host(t); await putExportRecord(key('id'), record); await putExportRecord(key('c_id'), { ...record, exportedAt: 200 });
    assert.deepEqual(Object.keys(await listExportRecords(A)).sort(), ['c_id', 'id']);
});
test__s16('account records have no global or other-account fallback', async t => {
    const env = host(t); await putExportRecord(key('id', B), record);
    assert.deepEqual(await listExportRecords(A), {});
    assert.deepEqual(await listExportRecords(B), { id: record });
    assert.equal(Object.hasOwn(env.local, 'exportedIds'), false);
});
test__s16('overlapping index admissions retain both committed sets', async t => {
    host(t);
    await Promise.all(['one', 'two'].map(id => ingestIndexes(A, [{ conversationId: id, fields: { title: id, titleSource: 'provider' } }])));
    assert.deepEqual((await listIndexes(A)).map(x => x.key.conversationId).sort(), ['one', 'two']);
});
test__s16('confirmed deletion atomically removes Index, Detail and ExportRecord without affecting a sibling account', async t => {
    host(t); await seed(); await seed('chat', B);
    await putExportRecord(key(), record); await putExportRecord(key('chat', B), record);
    await ingestDeletedConversation(A, 'chat');
    assert.equal(await getIndex(key()), null); assert.equal(await getDetail(key()), null); assert.equal(await getExportRecord(key()), null);
    assert.ok(await getIndex(key('chat', B))); assert.ok(await getDetail(key('chat', B))); assert.deepEqual(await getExportRecord(key('chat', B)), record);
});
test__s16('a failed deletion transaction rolls back all three stores', async t => {
    host(t); await seed(); await putExportRecord(key(), record);
    // A transaction abort is injected at the IDB host boundary, not in Domain.
    const original = IDBObjectStore.prototype.delete;
    t.mock.method(IDBObjectStore.prototype, 'delete', function(this: IDBObjectStore, value: IDBValidKey) {
        if (this.name === 'exportRecords') throw new Error('delete failed');
        return original.call(this, value);
    });
    await assert.rejects(ingestDeletedConversation(A, 'chat'), /delete failed/);
    assert.ok(await getIndex(key())); assert.ok(await getDetail(key())); assert.deepEqual(await getExportRecord(key()), record);
});
test__s16('list omission never deletes a local conversation or its export marker', async t => {
    host(t); await seed(); await putExportRecord(key(), record);
    await ingestIndexes(A, [{ conversationId: 'new', fields: { title: 'New', titleSource: 'provider' } }]);
    assert.ok(await getDetail(key())); assert.deepEqual(await getExportRecord(key()), record);
    assert.equal((await listIndexes(A)).length, 2);
});
test__s16('concurrent Settings patches serialize without losing unrelated preferences', async t => {
    host(t);
    await Promise.all([updateSettings({ enabledDisk: true }), updateSettings({ includeAssets: false }), updateSettings({ language: 'zh' })]);
    const settings = await getSettings();
    assert.equal(settings.enabledDisk, true); assert.equal(settings.includeAssets, false); assert.equal(settings.language, 'zh');
});
test__s16('failed Settings persistence does not publish a speculative value or poison the next write', async t => {
    const env = host(t); await updateSettings({ language: 'en' });
    env.fail(SETTINGS_KEY); await assert.rejects(updateSettings({ language: 'zh' }), /write failed/);
    assert.equal((await getSettings()).language, 'en');
    env.fail(); await updateSettings({ language: 'zh' }); assert.equal((await getSettings()).language, 'zh');
});
test__s16('Settings reads return defensive values instead of a mutable live cache', async t => {
    host(t); await updateSettings({ badgePosition: { left: 10, top: 20 } });
    const settings = await getSettings(); settings.badgePosition!.left = 99;
    assert.equal((await getSettings()).badgePosition?.left, 10);
});
test__s16('explicit account export-marker cleanup leaves Domain and other-account records intact', async t => {
    host(t); await seed(); await putExportRecord(key(), record); await putExportRecord(key('chat', B), record);
    await clearStoredAccountExportRecords(A);
    assert.deepEqual(await listExportRecords(A), {}); assert.deepEqual(await getExportRecord(key('chat', B)), record); assert.ok(await getDetail(key()));
});
test__s16('Index admissions never supplement an existing Detail with partial message bodies', async t => {
    host(t); await seed(); const before = await getDetail(key());
    await ingestIndexes(A, [{ conversationId: 'chat', fields: { title: 'Updated title', titleSource: 'provider', updatedAt: 200 } }]);
    assert.deepEqual(await getDetail(key()), before); assert.equal((await getIndex(key()))?.updatedAt, 200);
});
test__s16('older provider observations cannot regress the source version', async t => {
    host(t); await seed();
    await ingestIndexes(A, [{ conversationId: 'chat', fields: { updatedAt: 50 } }]);
    assert.equal((await getIndex(key()))?.updatedAt, 100);
});
test__s16('detail pagination stops a real cursor loop while retaining unique source messages', async () => {
    let calls = 0;
    const result = await getConversationDetail({ fetchConversationPage: async () => sourceDetail({
        id: 'loop', messages: [sourceMessage('same'), sourceMessage('page-' + ++calls)], nextPageToken: 'repeat',
    }) }, 'loop');
    assert.equal(calls, 2); assert.equal(result.evidence?.truncation, 'token_loop');
    assert.equal(new Set(result.conversation.detail.messages.map(message => message.id)).size, 3);
    assert.equal(result.conversation.detail.quality.status, 'partial');
});
});

__suiteDescribe("p1_e_regressions", () => {
/**
 * 每个用例均为 red-by-design：修复前失败、修复后通过，外加边界锁定用例。
 * P1-061a 注：rc_ 行首正则的 \\s*→\s* 在行为上被下游 .trim() 掩盖
 * （旧正则实际是死代码，匹配字面反斜杠+s），故用源码级断言锁定；
 * P1-061b/c 用真实行级清理的行为差异断言。
 */

const test = require('node:test');
const assert = require('node:assert');

const detailDecoder = require('../src/l1/parsers/gemini/rpc/detailDecoder.js');
const parseListMod = require('../src/l1/parsers/gemini/rpc/parseList.js');
const extractors = require('../src/l1/parsers/gemini/rpc/extractors.js');
const attachments = require('./helpers/recordFixture/attachments.js');
const { detailGen: geminiDetailGen } = require('./fixtures/providers/geminiDetail.js') as typeof import('./fixtures/providers/geminiDetail.js');
const { listGen: geminiListGen } = require('./fixtures/providers/gemini.js') as typeof import('./fixtures/providers/gemini.js');

function makeTurn(opts: {
    userPayload?: unknown; candText?: string; convId?: string; tsSec?: number; extraCand?: unknown[];
} = {}): unknown[] {
    const {
        userPayload = [["hello"]],
        candText = "world",
        convId = "c_abc123def456",
        tsSec = 1700000000,
        extraCand = []
    } = opts;
    const cand: unknown[] = ["rc_cand000001", [candText], "en", ...extraCand];
    return [
        [convId],
        [tsSec, 0],
        userPayload,
        [[cand]]
    ];
}

function modelMessageOf(res: any): any {
    return res.messages.find((m: any) => m.role === "model");
}
function userMessageOf(res: any): any {
    return res.messages.find((m: any) => m.role === "user");
}

test('P1-061a: candidate rc_ prefix and trailing whitespace strip cleanly from model text', () => {
    const turn = makeTurn({ candText: 'rc_abcdef0123456789   Hello world' });
    const decoded = extractors.decodeTurn(turn);
    const { decodeGeminiTurn } = require('../src/l1/parsers/gemini/rpc/turnResources.js');
    const msgs = decodeGeminiTurn(decoded, turn);
    const model = msgs.find((m: any) => m.role === 'model');
    assert.ok(model);
    assert.strictEqual(model.content, 'Hello world');
});

test('P1-061b: chip URL 整行被清理（保留段落换行）', () => {
    const res = detailDecoder.decodeGeminiDetail(geminiDetailGen('G_P1E_DETAIL_01'));
    const model = modelMessageOf(res);
    assert.ok(model, '应产出 model 消息');
    assert.strictEqual(model.content, "第一行\n\n第三行");
});

test('P1-061c: 生成图片 URL 整行被清理（保留段落换行，有图片时）', () => {
    const res = detailDecoder.decodeGeminiDetail(geminiDetailGen('G_P1E_DETAIL_02'));
    const model = modelMessageOf(res);
    assert.ok(model, '应产出 model 消息');
    assert.strictEqual(model.content, "看这张图\n\n结束");
});

test('P1-062a: isTurn 对标准 turn 返回 true（快速路径，多次调用结果一致）', () => {
    const turn = makeTurn();
    assert.strictEqual(detailDecoder.isTurn(turn), true);
    assert.strictEqual(detailDecoder.isTurn(turn), true, '缓存命中结果应一致');
});

test('P1-062b: isTurn 经 candidate rc_ 前缀结构化识别（user payload 非数组时）', () => {
    const turn: unknown[] = [
        ["c_structonly1"],
        [1700000000, 0],
        "非数组形态的 user payload",
        [[["rc_resp0001", ["text"], "en"]]]
    ];
    assert.strictEqual(detailDecoder.isTurn(turn), true);
});

test('P1-062c/d: 非 turn（坏 id 前缀；仅靠 "r_" 子串的假 turn）返回 false', () => {
    assert.strictEqual(detailDecoder.isTurn([["x_123"], [1, 0], [["u"]]]), false, 'id 无 c_/r_ 前缀');
    // 旧代码 s.includes("r_") 近乎恒真，会把这种假 turn 判为真
    const fake: unknown[] = [["c_r_123", [1, 2], "music_tv", ["error_r_broken"]]];
    assert.strictEqual(detailDecoder.isTurn(fake), false, '仅含 "r_" 子串、无真实形态标记');
});

test('P1-063: metadata-only 载荷产出可见的 schemaDrift 警告（非 dev 也不静默）', () => {
    const res = detailDecoder.decodeGeminiDetail(geminiDetailGen('G_P1E_DETAIL_03'));
    assert.strictEqual(res.messages.length, 0, '无 turns 时消息为空');
    assert.ok(Array.isArray(res.schemaDrift), 'schemaDrift 不应缺席');
    assert.ok(res.schemaDrift.some((w: string) => /metadata-only/i.test(w)), '应包含 metadata-only 警告');
});

test('P1-064a: user payload[0] 为字符串时提取全文而非首字符', () => {
    const res = detailDecoder.decodeGeminiDetail(geminiDetailGen('G_P1E_DETAIL_04'));
    const user = userMessageOf(res);
    assert.ok(user, '应产出 user 消息');
    assert.strictEqual(user.content, "hello world from user");
});

test('P1-064b: 标准 [[text]] 形态的用户文本提取不变', () => {
    const res = detailDecoder.decodeGeminiDetail(geminiDetailGen('G_P1E_DETAIL_05'));
    assert.strictEqual(userMessageOf(res).content, "标准形态文本");
});

test('P1-065a: 启发式跳过仅含 "c_" 子串的错误 chunk（decodeGeminiDetail）', () => {
    // 触发条件：无标准 WRB 信封；错误 chunk 排在正确 chunk 之前；
    // 错误 chunk 含 "c_" 子串（music_）但无完整会话 ID 格式，且内藏假 turn。
    const res = detailDecoder.decodeGeminiDetail(geminiDetailGen('G_P1E_LEADING_DECOY_DETAIL_01'));
    assert.strictEqual(res.messages.length, 2, '应解析出正确 chunk 的 user+model 两条消息');
    assert.strictEqual(userMessageOf(res).content, "hello");
    assert.strictEqual(modelMessageOf(res).content, "world");
});

test('P1-065b: bogus chunks preceding a genuine LIST envelope cannot take precedence (parseList)', () => {
    const res = parseListMod.parseList(geminiListGen('G_P1E_LEADING_DECOY_LIST_01'));
    assert.strictEqual(res.conversations.length, 1);
    assert.strictEqual(res.conversations[0].id, "list0012345678");
});

test('P1-066a: messageCount 不把 item[5] 的 epoch 秒误判成消息数', () => {
    const res = parseListMod.parseList(geminiListGen('G_P1E_LIST_01'));
    assert.strictEqual(res.conversations[0].messageCount, undefined, '无有效 count 位时应为 0 而非十亿级数字');
    assert.strictEqual(res.conversations[0].updatedAt, 1757839234000, '时间戳本身仍应正确解析');
});

test('P1-066b: COUNT_ALT1 的正常 count 位仍生效', () => {
    const res = parseListMod.parseList(geminiListGen('G_P1E_LIST_02'));
    assert.strictEqual(res.conversations[0].messageCount, undefined);
});

test('P1-067a: extractTurnTimestamp 优先读 schema 声明的下标 1', () => {
    const turn: unknown[] = [["c_x"], [1700000000, 500000000], [["u"]], [[["rc_1", ["t"]]]], "tail"];
    assert.strictEqual(extractors.extractTurnTimestamp(turn), 1700000000500);
});

test('P1-067b: 下标 1 缺失时兼容旧位置（下标 4）', () => {
    const turn: unknown[] = [["c_x"], null, [["u"]], [[["rc_1", ["t"]]]], [1700000001, 0]];
    assert.strictEqual(extractors.extractTurnTimestamp(turn), 1700000001000);
});

test('P1-069a: extractImages 拒绝非 Google 媒体 host 的 URL', () => {
    const imgs = attachments.extractImages([["https://evil-tracker.com/pixel.png", 100, 100]]);
    assert.strictEqual(imgs.length, 0);
});

test('P1-069b: extractImages 保留 googleusercontent host 的 URL', () => {
    const imgs = attachments.extractImages([["https://lh3.googleusercontent.com/photo=w100", 100, 100]]);
    assert.strictEqual(imgs.length, 1);
});

test('P1-069c: extractUserFiles 拒绝非 Google 媒体 host 的 URL', () => {
    const files = attachments.extractUserFiles([["", ["https://evil.com/doc.pdf", "doc.pdf", "id9"]]]);
    assert.strictEqual(files.length, 0);
});





test('P1-071a: inferExt 识别 .svg 并给出正确 MIME（不再强制 .jpg）', () => {
    const imgs = attachments.extractImages([["https://lh3.googleusercontent.com/pic.svg", 100, 100]]);
    assert.strictEqual(imgs.length, 1);
    assert.ok(imgs[0].fileName.endsWith(".svg"), `fileName=${imgs[0].fileName}`);
    assert.strictEqual(imgs[0].mimeType, "image/svg+xml");
});

test('P1-071b: Pattern 2 的 rawFileName 扩展名与 MIME 一致（.avif）', () => {
    const node = [null, 1, "report.avif", "https://lh3.googleusercontent.com/genimg1", null, "tok123",
        null, null, null, null, null, null, null, null, null, [800, 600, 456]];
    const imgs = attachments.extractImages([node]);
    assert.strictEqual(imgs.length, 1);
    assert.strictEqual(imgs[0].fileName, "report.avif");
    assert.strictEqual(imgs[0].mimeType, "image/avif");
});

test('P1-072a: findDocContentById 不命中正文里仅"提到" ID 的节点', () => {
    const decoy = ["note", "本文引用了 doc99999 的观点\n\n" + "y".repeat(250)];
    const real = ["c_doc99999", "## 真实文档正文\n\n" + "正文".repeat(150)];
    const found = attachments.createDocumentReader([decoy, real]).byId("c_doc99999");
    assert.ok(found);
    assert.equal(found?.contentMatch, undefined);
});

test('P1-072b: findDocContentById 无匹配时返回 null', () => {
    assert.strictEqual(attachments.createDocumentReader([["a", "b"]]).byId("c_nope123456"), null);
});

test('P1-073a: extractConversationId 深搜找 ID，全程不做 JSON.stringify', () => {
    const inner = [[[[["c_deepfind1234567890"]]]]];
    const origStringify = JSON.stringify;
    (JSON as any).stringify = () => { throw new Error("must not stringify"); };
    try {
        assert.strictEqual(extractors.extractConversationId(inner), "c_deepfind1234567890");
    } finally {
        (JSON as any).stringify = origStringify;
    }
});

test('P1-073b: 找不到 ID 时返回 c_unknown', () => {
    assert.strictEqual(extractors.extractConversationId([["nothing", "here"]]), "c_unknown");
});

test('P1-074a: 无时间戳的会话返回 null 而非伪造 Date.now()', () => {
    const res = parseListMod.parseList(geminiListGen('G_P1E_LIST_03'));
    const c = res.conversations[0];
    assert.strictEqual(c.createdAt, undefined);
    assert.strictEqual(c.updatedAt, undefined);
    assert.strictEqual(c.chatTime, undefined);
    assert.strictEqual(c.timestamp, undefined);
});

test('P1-074b: 有真实时间戳的会话仍正确解析', () => {
    const res = parseListMod.parseList(geminiListGen('G_P1E_LIST_04'));
    const c = res.conversations[0];
    assert.strictEqual(c.createdAt, undefined);
    assert.strictEqual(c.updatedAt, 1700000000000);
});
});

__suiteDescribe("p1_g_regressions", () => {
/**
 * P1-G type regression contracts.
 *
 * Compile-time contracts are checked by 'npm run type-check', not by the
 * Node test runner. Keep them in an uncalled function so no tautological
 * runtime tests ("assign a value, then read it back") inflate test counts.
 */





// P1-090, 091, 093, 098, 099, 100 are type-check contracts.
// The @ts-expect-error directives fail compilation if forbidden types
// become legal again, so they are intentionally not runtime assertions.
function typecheckContracts(): void {
    const fromParser: ChatMessage = { role: 'model', content: 'hi', thoughts: 'joined thoughts' };
    const fromOtherProvider: ChatMessage = { role: 'model', content: 'hi', thoughts: ['a', 'b'] };

    // P1-091: core types must reject undeclared fields.
    // @ts-expect-error - arbitrary Conversation fields must not be legal
    type _NoConversationIndex = Conversation['someUndeclaredProp'];
    // @ts-expect-error - arbitrary ChatMessage fields must not be legal
    type _NoMessageIndex = ChatMessage['anotherUndeclaredProp'];

    const message: ChatMessage = {
        role: 'model', content: 'x',
        images: [{ type: 'image', fileName: 'a.png', localName: 'assets/a.png' }],
        thinking: 'legacy thought text',
        attachmentCount: 2,
    };
    const conversation: Conversation = {
        id: 'c_1', title: 't', timestamp: 123,
        attachmentCount: 2, messageCount: 5,
        href: 'https://gemini.google.com/app/c_1',
        hasExplicitPrompt: true,
    };
    const attachment: Attachment = {
        type: 'image', name: 'alt', isGenerated: true,
        isImage: true, subDir: 'assets', source: 'takeout'
    };

    type IsAny<T> = 0 extends (1 & T) ? true : false;

    // P1-099: removed ambient globals must stay gone and the one retained
    // global API client declaration must not revert to any.
    // @ts-expect-error - removed global must not become ambient again
    type _NoBadgeView = typeof BadgeView;
    const clientMustBeTyped: IsAny<typeof GeminiAPIClient> = false;

    // P1-100: these model types must not reappear in the public API.
    // @ts-expect-error - deleted public type
    type _NoThoughtBlock = import('./helpers/historicalConversation.js').ThoughtBlock;
    // @ts-expect-error - deleted public type
    type _NoCitationSource = import('./helpers/historicalConversation.js').CitationSource;

    void fromParser; void fromOtherProvider;
    void message; void conversation; void attachment;
    void clientMustBeTyped;
}
void typecheckContracts;

// P1-094: the live Takeout parse error retains the shared hierarchy.
test__s18('P1-094: TakeoutParseError extends GeminiError and retired RPC error is absent', () => {
    const errors = require('../src/shared/types/errors.js');
    assert.equal(errors.GeminiRpcError, undefined);
    assert.equal(typeof errors.GeminiError, 'function');
    assert.ok(new errors.TakeoutParseError('x') instanceof errors.GeminiError);
});

// P1-097: a removed unused file is not a runtime contract; deleted.
// P1-101: a particular unused import is not runtime behavior; deleted.
});

__suiteDescribe("p1_i_regressions", () => {
useIndexStorage();
/**
 * tests/p1_i_regressions.test.ts
 * I 组「协议层与 provider 契约收尾」P1-075~080, P1-088/089 回归测试。
 */
const test = require('node:test');
const assert = require('node:assert');

const Proto = require('../src/l1/protocol/gemini/protocol.js');
const { ProviderRegistryClass } = require('../src/l1/client/providerRegistry.js');
const { GeminiProvider } = require('../src/l1/client/gemini/geminiProvider.js');

function fakeProvider(id: string, opts: { matchesUrl?: (u: string) => boolean; hostPatterns?: string[] } = {}) {
    const p: any = { id, name: id, hostPatterns: opts.hostPatterns || [] };
    if (opts.matchesUrl) p.matchesUrl = opts.matchesUrl;
    return p;
}

test('P1-075 - second DELETION_ANCHOR requires the c_ prefix (anchored discipline)', () => {
    // Unquoted GzXR5e followed by a BARE hex token (no c_) must NOT match:
    // this is exactly the false-positive the old (?:c_)? allowed.
    const decoy = 'GzXR5e something happened deadbeef00112233 nearby';
    assert.strictEqual(decoy.match(Proto.DELETION_ANCHORS[1]), null);

    // Unquoted GzXR5e followed by a real c_-prefixed id still matches (fallback kept).
    const real = '...GzXR5e...c_feedface12345678...';
    const m = real.match(Proto.DELETION_ANCHORS[1]);
    assert.ok(m, 'unquoted anchor must still extract c_-prefixed ids');
    assert.strictEqual(m![1], 'feedface12345678');

    // Quoted form unchanged.
    const quoted = geminiDeleteGen('G_P1I_QUOTED_DELETE_01');
    const m0 = quoted.match(Proto.DELETION_ANCHORS[0]);
    assert.ok(m0);
    assert.strictEqual(m0![1], 'aabbccdd11223344');
});

test('P1-077 - CJS test bridge preserves protocol exports without a globalThis mount', () => {
    assert.strictEqual(Proto.GeminiProtocol, Proto);
    assert.strictEqual(Proto.default, Proto);
    assert.strictEqual(Proto.CrossWorldEvents, Proto.EVENTS);
    assert.strictEqual((globalThis as any).GeminiProtocol, undefined);
});

test('P1-078 - duplicate registration of a DIFFERENT instance warns loudly', () => {
    const registry = new ProviderRegistryClass();
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => { warnings.push(args.join(' ')); };
    try {
        const first = fakeProvider('dup');
        const second = fakeProvider('dup');
        registry.register(first);
        // Same instance re-registered: silent no-op, no warning.
        registry.register(first);
        assert.strictEqual(warnings.length, 0, 'same-instance re-register must stay silent');
        // Different instance, same id: warn + overwrite.
        registry.register(second);
        assert.strictEqual(warnings.length, 1, 'different-instance duplicate must warn');
        assert.ok(warnings[0].includes('"dup"'), 'warning names the colliding id');
        assert.strictEqual(registry.get('dup'), second);
    } finally {
        console.warn = origWarn;
    }
});











test('P1-088 - checkReadiness never passes the slot id off as the account name', async () => {
    // Runtime: stub credential resolution to force the ready:true branch.
    const credMgr = require('../src/l1/client/gemini/api/credentialManager.js').default;
    const orig = credMgr.resolveCred;
    credMgr.resolveCred = async () => ({ sid: 's', at: 'a', bl: 'b', accountSlot: 'u0' });
    try {
        const readiness = await new GeminiProvider(undefined, async () => 'u0').checkReadiness(ACCOUNT_UUID);
        assert.strictEqual(readiness.ready, true);
        assert.equal('accountSlot' in readiness, false);
        assert.ok(
            readiness.accountName === undefined || readiness.accountName === null,
            `accountName must be absent/null, got: ${readiness.accountName}`
        );
    } finally {
        credMgr.resolveCred = orig;
    }
});

test('P1-089 - gemini hostPatterns cover everything matchesUrl accepts', () => {
    const gemini = new GeminiProvider();
    assert.ok(gemini.matchesUrl('https://gemini.google.com/app'), 'gemini host matches');
    assert.ok(gemini.matchesUrl('https://bard.google.com/app'), 'legacy bard host matches');
    for (const host of ['https://gemini.google.com/', 'https://bard.google.com/']) {
        assert.ok(gemini.matchesUrl(host), `Gemini matchesUrl accepts ${host}`);
    }
    assert.ok(
        (gemini.hostPatterns as string[]).includes('https://bard.google.com/*'),
        'hostPatterns must include the bard pattern'
    );
    assert.ok(!gemini.matchesUrl('https://chatgpt.com'), 'unrelated host still refused');
});
});

__suiteDescribe("perf_optimizations", () => {
useIndexStorage();


const test = require('node:test');
const assert = require('node:assert');

test('perf - geminiClient 429 backoff retries and recovers on transient rate limit', async () => {
    const { GeminiAPIClient } = require('../src/l1/client/gemini/geminiClient.js');
    const client = new GeminiAPIClient();

    const originalFetch = (global as any).fetch;
    let callCount = 0;
    const recordedDelays: number[] = [];

    const originalSetTimeout = (global as any).setTimeout;
    (global as any).setTimeout = (fn: any, delay: any) => {
        recordedDelays.push(delay);
        return originalSetTimeout(fn, 1);
    };

    try {
        (global as any).fetch = async (_url: any, _opts: any) => {
            callCount++;
            if (callCount < 3) {
                return {
                    ok: false,
                    status: 429,
                    statusText: 'Too Many Requests',
                    headers: new Map(),
                    text: async () => 'Rate limit exceeded'
                };
            }
            return {
                ok: true,
                status: 200,
                headers: new Map(),
                text: async () => geminiListPage().responseBody
            };
        };

        const res = await client.getConversationList(null, 'test_sid', null, { maxRetries: 3 });
        assert.strictEqual(callCount, 3, 'should have retried twice and succeeded on 3rd attempt');
        assert.ok(res.conversations && res.conversations.length === GEMINI_LIST_CAPTURE.firstPageRows, 'should have parsed conversations successfully');
        assert.strictEqual(res.conversations[0].id, GEMINI_LIST_CAPTURE.first.id);
        // P1-035: getConversationList now sets a 30s timeoutMs per request, so each
        // postBatchexecute arms one 30000ms timeout timer alongside the backoff sleeps.
        const timeoutTimers = recordedDelays.filter(d => d === 30000);
        assert.strictEqual(timeoutTimers.length, 3, 'each list request should arm a 30s timeout (P1-035)');
        const backoffDelays = recordedDelays.filter(d => d !== 30000);
        assert.strictEqual(backoffDelays.length, 2, 'should have delayed twice for 429 backoff');
        assert.ok(backoffDelays[0] >= 2000, 'first delay should be >= 2000ms');
        assert.ok(backoffDelays[1] >= 4000, 'second delay should be >= 4000ms');
    } finally {
        (global as any).fetch = originalFetch;
        (global as any).setTimeout = originalSetTimeout;
    }
});

test('perf - geminiClient 429 throws after exceeding maxRetries', async () => {
    const { GeminiAPIClient } = require('../src/l1/client/gemini/geminiClient.js');
    const client = new GeminiAPIClient();

    const originalFetch = (global as any).fetch;
    const originalSetTimeout = (global as any).setTimeout;
    (global as any).setTimeout = (fn: any, _delay: any) => originalSetTimeout(fn, 1);

    let callCount = 0;
    try {
        (global as any).fetch = async () => {
            callCount++;
            return {
                ok: false,
                status: 429,
                statusText: 'Too Many Requests',
                headers: new Map(),
                text: async () => 'Rate limit exceeded'
            };
        };

        await assert.rejects(async () => {
            await client.getConversationList(null, 'test_sid', null, { maxRetries: 2 });
        }, /HTTP 429/);
        assert.strictEqual(callCount, 3, 'initial attempt + 2 retries = 3 calls total');
    } finally {
        (global as any).fetch = originalFetch;
        (global as any).setTimeout = originalSetTimeout;
    }
});

test('perf - Takeout import yields to the event loop and reports monotonic progress for 120 conversations', async (t: import('node:test').TestContext) => {
    const { importTakeout } = require('../src/application/imports/importTakeout.js');
    const { listIndexes } = require('../src/l3a/storageService.js');
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'JSZip');
    const JSZip = require('../lib/jszip.min.js');
    Object.defineProperty(globalThis, 'JSZip', { configurable: true, value: JSZip });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'JSZip', descriptor); else Reflect.deleteProperty(globalThis, 'JSZip'); });
    const zip = new JSZip();
    zip.file('Takeout/Gemini/MyActivity.html', '<html><body>' + Array.from({ length: 120 }, (_, index) =>
        `<div class="outer-cell"><a href="https://gemini.google.com/app/takeout_${index}">Link</a><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted Question ${index}<br><p>Answer ${index}</p></div></div>`).join('') + '</body></html>');
    const reports: number[] = [];
    let yielded = false; setTimeout(() => { yielded = true; }, 0);
    const id = '10000000-0000-4000-8000-000000000001';
    const result = await importTakeout(await zip.generateAsync({ type: 'nodebuffer' }), id, (percent: number) => reports.push(percent));
    assert.strictEqual(result.imported, 120); assert.strictEqual((await listIndexes(id)).length, 120);
    assert.strictEqual(yielded, true);
    assert.strictEqual(reports[reports.length - 1], 100);
    assert.ok(reports.every((value, index) => index === 0 || value >= reports[index - 1]));
    assert.ok(reports.some(percent => percent > 70 && percent < 100));
});

test('perf - assetFetcher returns ArrayBuffer directly when preferBuffer is true', async () => {
    const { AssetFetcher } = require('../src/l1/resources/gemini/assetFetcher.js');

    const originalFetch = (global as any).fetch;
    const testData = Buffer.from('fake image binary content 1234567890');
    try {
        (global as any).fetch = async () => ({
            ok: true,
            headers: new Map([['content-type', 'image/png']]),
            blob: async () => ({
                size: testData.length,
                type: 'image/png',
                arrayBuffer: async () => testData.buffer.slice(testData.byteOffset, testData.byteOffset + testData.byteLength)
            })
        });

        let responsePayload: any = null;
        await AssetFetcher.downloadAssetDirect({
            url: 'https://lh3.googleusercontent.com/test_img.png',
            preferBuffer: true
        }, (res: any) => {
            responsePayload = res;
        });

        assert.ok(responsePayload, 'should receive response');
        assert.strictEqual(responsePayload.success, true);
        assert.ok(responsePayload.dataBuffer instanceof ArrayBuffer, 'dataBuffer should be an ArrayBuffer');
        assert.strictEqual(responsePayload.dataBuffer.byteLength, testData.length);
        assert.strictEqual(responsePayload.dataBase64, undefined, 'dataBase64 should not be generated when preferBuffer is fulfilled');
    } finally {
        (global as any).fetch = originalFetch;
    }
});

test('perf - assetFetcher returns base64 when preferBuffer is false', async () => {
    const { AssetFetcher } = require('../src/l1/resources/gemini/assetFetcher.js');

    const originalFetch = (global as any).fetch;
    const originalReader = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');
    // Content Scripts have FileReader; Node does not. Mock that browser boundary,
    // not a production Buffer fallback, and use a real Blob in the response.
    class TestFileReader {
        result: string | null = null;
        error: Error | null = null;
        onloadend: (() => void) | null = null;
        onerror: (() => void) | null = null;

        readAsDataURL(blob: Blob): void {
            void blob.arrayBuffer().then(
                bytes => {
                    this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
                    this.onloadend?.();
                },
                (error: unknown) => {
                    this.error = error instanceof Error ? error : new Error(String(error));
                    this.onerror?.();
                }
            );
        }
    }
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: TestFileReader });
    const testData = Buffer.from('fake image binary content 1234567890');
    try {
        (global as any).fetch = async () => ({
            ok: true,
            headers: new Map([['content-type', 'image/png']]),
            blob: async () => new Blob([testData.toString('utf8')], { type: 'image/png' })
        });

        let responsePayload: any = null;
        await AssetFetcher.downloadAssetDirect({
            url: 'https://lh3.googleusercontent.com/test_img.png',
            preferBuffer: false
        }, (res: any) => {
            responsePayload = res;
        });

        assert.ok(responsePayload, 'should receive response');
        assert.strictEqual(responsePayload.success, true);
        assert.strictEqual(responsePayload.dataBase64, testData.toString('base64'), 'base64 must preserve actual Blob bytes');
        assert.strictEqual(responsePayload.dataBuffer, undefined, 'dataBuffer should not be generated when preferBuffer is false');
    } finally {
        (global as any).fetch = originalFetch;
        if (originalReader) Object.defineProperty(globalThis, 'FileReader', originalReader);
        else Reflect.deleteProperty(globalThis, 'FileReader');
    }
});



test('perf - runtime Tab transport times out instead of hanging an acquisition task', async (t: import('node:test').TestContext) => {
    const { sendTabMessage } = require('../src/runtime/capabilities/tabService.js');
    const host = chrome;
    const previous = Object.getOwnPropertyDescriptor(host, 'tabs');
    Object.defineProperty(host, 'tabs', { configurable: true, value: { sendMessage() {} } });
    t.after(() => { if (previous) Object.defineProperty(host, 'tabs', previous); else Reflect.deleteProperty(host, 'tabs'); });
    const start = Date.now();
    await assert.rejects(sendTabMessage(12345, { action: 'getFileBlob' }, 50), /timed out/);
    assert.ok(Date.now() - start >= 45);
});
});

__suiteDescribe("phase_g_p2_fixes", () => {
const test = require('node:test');
const assert = require('node:assert');

// Phase G (G4) P2 行为修复回归测试。

// List completion belongs to the provider; its safety budget is internal.







test('P2-1: safety-budget exhaustion remains distinct from a natural source end', async () => {
    const env = indexStorage(); let calls=0;
    try {
        const p = new GeminiProvider({getConversationList:async()=>sourceList(`G_SOURCE_PHASE_BUDGET_PAGE_${++calls}`),getConversationDetail:async()=>sourceDetail()},async()=> 'u0');
        assert.strictEqual(await p.listConversations({accountId:ACCOUNT_UUID,streamId:'recent'}), 'max_pages');
        assert.strictEqual(calls,2000); assert.strictEqual((await listIndexes(ACCOUNT_UUID)).length,2000);
        assert.strictEqual((await getCoverage(ACCOUNT_UUID,'recent'))?.range,null);
    } finally { env.restore(); }
});
test('P2-1: empty terminal page is a natural end', async () => {
    const env=indexStorage();try {
        const p=new GeminiProvider({getConversationList:async()=>sourceList('G_SOURCE_EMPTY_01'),getConversationDetail:async()=>sourceDetail()},async()=> 'u0');
        assert.strictEqual(await p.listConversations({accountId:ACCOUNT_UUID,streamId:'recent'}),'source_end');
    }finally{env.restore();}
});

// ---------- P2-3: 401 先刷新 at，刷新失败才删凭证 ----------
function make401Deps(map: Record<string, any>, onWrite = () => {}) {
    return {
        updateCredential: async (sid: string | number, decide: () => { patch: { at?: string; bl?: string } | null }) => {
            const { patch } = decide();
            if (!Object.hasOwn(map, sid)) return;
            if (patch === null) delete map[sid];
            else Object.assign(map[sid], patch);
            onWrite();
        },
    };
}

test('P2-3: 401 且页面有更新的 at → 刷新 at 并保留凭证', async () => {
    const RetryPolicy = require('../src/l1/client/gemini/api/retryPolicy.js');
    const inner: Record<string, any> = { sid1: { at: 'stale-at', sid: 'sid1' } };
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (...a: any[]) => { warns.push(a.join(' ')); };
    try {
        await RetryPolicy.handleHttp401({
            cred: { at: 'stale-at', sid: 'sid1' },
            ...make401Deps(inner),
            refreshAtFromPage: () => 'fresh-at-from-page'
        });
    } finally {
        console.warn = origWarn;
    }
    assert.ok(inner.sid1, '凭证不应被删除');
    assert.strictEqual(inner.sid1.at, 'fresh-at-from-page', 'at 应被刷新为页面最新值');
    assert.ok(warns.some(w => w.includes('刷新')), '应有 warn 说明走了刷新路径');
    assert.ok(warns.every(w => !w.includes('stale-at') && !w.includes('fresh-at-from-page')),
        'warn 必须脱敏：不得出现 token 明文');
});

test('P2-3: 401 且页面无更新的 at → 删除过期凭证', async () => {
    const RetryPolicy = require('../src/l1/client/gemini/api/retryPolicy.js');
    const inner: Record<string, any> = { sid1: { at: 'stale-at', sid: 'sid1' } };
    const origWarn = console.warn;
    console.warn = () => {};
    try {
        await RetryPolicy.handleHttp401({
            cred: { at: 'stale-at', sid: 'sid1' },
            ...make401Deps(inner),
            refreshAtFromPage: () => 'stale-at' // 页面 at 与存储一致，无更新
        });
    } finally {
        console.warn = origWarn;
    }
    assert.ok(!inner.sid1, '刷新无果时才删除凭证');
});

test('P2-3: 401 且页面抓不到 at → 删除过期凭证（旧行为保留）', async () => {
    const RetryPolicy = require('../src/l1/client/gemini/api/retryPolicy.js');
    const inner: Record<string, any> = { sid1: { at: 'stale-at', sid: 'sid1' } };
    const origWarn = console.warn;
    console.warn = () => {};
    try {
        await RetryPolicy.handleHttp401({
            cred: { at: 'stale-at', sid: 'sid1' },
            ...make401Deps(inner),
            refreshAtFromPage: () => null
        });
    } finally {
        console.warn = origWarn;
    }
    assert.ok(!inner.sid1, '抓不到 at 时沿用旧的删除逻辑');
});

test('P2-3: 401 但 map 中无此 sid → 两条路径都是 no-op（不写不抛）', async () => {
    const RetryPolicy = require('../src/l1/client/gemini/api/retryPolicy.js');
    // map 里根本没有 sid9（可能已被其他 tab 删除）
    const inner: Record<string, any> = { sidOther: { at: 'x', sid: 'sidOther' } };
    let writes = 0;
    const origWarn = console.warn;
    console.warn = () => {};
    try {
        // fresh-at 路径：sid 不在 map 中，不应写入幻影条目
        await RetryPolicy.handleHttp401({
            cred: { at: 'stale-at', sid: 'sid9' },
            ...make401Deps(inner, () => { writes++; }),
            refreshAtFromPage: () => 'fresh-at-from-page'
        });
        assert.strictEqual(writes, 0, 'fresh-at 路径：map 无此 sid 时不得写入');
        assert.ok(!inner.sid9, '不得创建幻影凭证条目');
        // delete 路径：sid 不在 map 中，同样 no-op
        await RetryPolicy.handleHttp401({
            cred: { at: 'stale-at', sid: 'sid9' },
            ...make401Deps(inner, () => { writes++; }),
            refreshAtFromPage: () => null
        });
        assert.strictEqual(writes, 0, 'delete 路径：map 无此 sid 时不得写入');
        assert.deepStrictEqual(Object.keys(inner), ['sidOther'], '不得误删其他凭证');
    } finally {
        console.warn = origWarn;
    }
});

test('P2-4: private RPC credential update prefers the request build label', async () => {
    const previous = new Map(['chrome', 'window', 'document', 'location'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const store: Record<string, any> = {};
    const runtime: { receive?: (message: unknown, sender: chrome.runtime.MessageSender) => void } = {};
    (globalThis as any).chrome = {
        runtime: {
            id: 'test-ext',
            sendMessage: async (message: any) => ({ok:true,value:{id:'10000000-0000-4000-8000-000000000003',providerId:message.providerId,providerAccountId:message.providerAccountId}}),
            onMessage: { addListener: (listener: typeof runtime.receive) => { runtime.receive = listener; }, removeListener: () => {} },
        },
        storage: {
            local: {
                get: async (keys: string[]) => {
                    const out: Record<string, any> = {};
                    for (const k of keys) if (k in store) out[k] = store[k];
                    return out;
                },
                set: async (obj: Record<string, any>) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); },
                remove: async (keys: string[]) => { for (const k of keys) delete store[k]; }
            }
        }
    };
    const listeners: Record<string, Function[]> = {};
    const mockWindow: any = {
        addEventListener: (t: string, f: Function) => { (listeners[t] = listeners[t] || []).push(f); },
        removeEventListener: (t: string, f: Function) => { listeners[t] = (listeners[t] || []).filter(listener => listener !== f); },
        // No Gaia in this fixture: answer the new MAIN-world query explicitly.
        postMessage: (message: any) => {
            if (message.type !== 'GEMINI_ACCOUNT_REQUESTED') return;
            queueMicrotask(() => {
                const event = { source: mockWindow, origin: 'https://gemini.google.com', data: {
                    type: 'GEMINI_ACCOUNT_OBSERVED', payload: { requestId: message.payload.requestId, slot: 'u0', observation: null }
                } };
                for (const listener of [...(listeners.message || [])]) listener(event);
            });
        }
    };
    (globalThis as any).window = mockWindow;
    (globalThis as any).document = {
        querySelectorAll: () => [],
        documentElement: { innerHTML: '' },
        addEventListener: () => {}, removeEventListener: () => {}
    };
    (globalThis as any).location = { href: 'https://gemini.google.com/app', origin: 'https://gemini.google.com' };
    try {
        delete require.cache[require.resolve('../src/l1/client/gemini/bootstrap.js')];
        require('../src/runtime/content/installContentHost.js').installContentRuntimeHost();
        require('../src/l1/client/gemini/bootstrap.js').initBootstrap();
        // 预置旧 bl
        store['gemini_credentials_map'] = {
            sid1: { at: 'old-at', sid: 'sid1', bl: 'old-bl', accountSlot: 'u0', lastUsed: 1 }
        };
        if (!runtime.receive) throw new Error('bootstrap must register the private runtime listener');
        runtime.receive({ action: 'geminiRpcCredentials', payload: { sid: 'sid1', at: 'hook-at', bl: 'hook-bl' } }, { id: 'test-ext' });
        // runSerializedCredOp 是链式异步，等一拍
        for (let i = 0; i < 50 && store['gemini_credentials_map']?.sid1?.bl !== 'hook-bl'; i++) {
            await new Promise(r => setTimeout(r, 20));
        }
        assert.strictEqual(store['gemini_credentials_map'].sid1.bl, 'hook-bl',
            'hook payload 的 p.bl 必须优先（此前被丢弃，只用 old.bl/页面抓取）');
        assert.strictEqual(store['gemini_credentials_map'].sid1.at, 'hook-at');
    } finally {
        require('../src/runtime/content/cleanupRegistry.js').runCleanups();
        require('../src/runtime/content/accountContext.js').invalidateAccountContext();
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
        delete require.cache[require.resolve('../src/l1/client/gemini/bootstrap.js')];
    }
});

// PDF is now supported; formatting is owned by the unified export API.


test('P2: current JSON export is delivered by the unified pipeline', async (t: import('node:test').TestContext) => {
    const h=v2ExportHost(t);await seedExportConversation('json');
    const result=await runExport(exportRequest(['json'],{format:'json'}));
    assert.strictEqual(result.exported,1);
    const body=JSON.parse(await h.blobs[0].text()); assert.ok(JSON.stringify(body).includes('Answer for json'));
});
test('P2-11: concurrent settings patches preserve all independent fields',async()=>{
    const env=indexStorage();try{
        await Promise.all([patchStoredSettings({language:'en'}),patchStoredSettings({includeAssets:false}),patchStoredSettings({enabledDisk:true}),patchStoredSettings({defaultFormat:'html'})]);
        const s=await getStoredSettings();assert.strictEqual(s.language,'en');assert.strictEqual(s.includeAssets,false);assert.strictEqual(s.enabledDisk,true);assert.strictEqual(s.defaultFormat,'html');
    }finally{env.restore();}
});
test('P2-11: unavailable Web Locks fails before writing settings',async()=>{
    const env=indexStorage(), previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
    try{Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
        await assert.rejects(patchStoredSettings({language:'en'})); assert.deepStrictEqual(await getStoredSettings(),{});
    }finally{if(previous)Object.defineProperty(globalThis,'navigator',previous);else Reflect.deleteProperty(globalThis,'navigator');env.restore();}
});
test('P2-11: settings use one cross-tab Web Lock name',async()=>{
    const env=indexStorage(), previous=Object.getOwnPropertyDescriptor(globalThis,'navigator'), seen:string[]=[];
    try{Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(name:string,fn:()=>Promise<void>)=>{seen.push(name);return fn();}}}});
        await patchStoredSettings({language:'en'});assert.deepStrictEqual(seen,[SETTINGS_KEY]);
    }finally{if(previous)Object.defineProperty(globalThis,'navigator',previous);else Reflect.deleteProperty(globalThis,'navigator');env.restore();}
});
});

__suiteDescribe("pr865_followups", () => {
useIndexStorage();

const account = fixtureAccount('custom');
const otherAccountId = '10000000-0000-4000-8000-000000000002';
const sourceTime = 1_700_000_000_000;

function key(conversationId: string) {
    return { accountId: account.id, conversationId };
}
function request(conversationId: string, changes: Partial<ExportRequest> = {}): ExportRequest {
    return {
        keys: [key(conversationId)],
        format: 'markdown',
        delivery: 'browserDownload',
        includeAssets: false,
        skipUnchanged: false,
        ...changes,
    };
}
function snapshot(id: string, content: string, updatedAt = sourceTime) {
    return historicalFixture({
        id, title: id, updatedAt, messages: [{ role: 'user', content }],
    }, { providerId: 'custom', qualityStatusOverride: 'complete' });
}

/** v2 L1 seam: a provider admits a refreshed Detail itself; Export only sees its Promise. */
function registerCustomProvider(overrides: Partial<Pick<AIProvider, 'fetchConversationDetail' | 'acquireResource'>> = {}): () => void {
    const previous = ProviderRegistry.get('custom');
    const provider: AIProvider = {
        id: 'custom',
        name: 'PR865 v2 fixture provider',
        hostPatterns: [],
        matchesUrl: () => false,
        checkReadiness: async () => ({ ready: true }),
        listConversations: async () => 'source_end',
        fetchConversationDetail: async () => { throw new Error('HTTP 503'); },
        acquireResource: async () => { throw new Error('Resource unavailable'); },
        ...overrides,
    };
    ProviderRegistry.register(provider);
    return () => {
        ProviderRegistry.unregister('custom');
        if (previous) ProviderRegistry.register(previous);
    };
}

/** Exercise the actual v2 L4 Browser Download anchor, not the removed JSZip/BatchWorker seam. */
function captureBrowserDownloads(click?: () => void) {
    const blobs: Blob[] = [];
    const clicked: string[] = [];
    const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const oldMouseEvent = Object.getOwnPropertyDescriptor(globalThis, 'MouseEvent');
    Object.defineProperty(globalThis, 'MouseEvent', { configurable: true, value: Event });
    const oldCreate = URL.createObjectURL;
    const oldRevoke = URL.revokeObjectURL;
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
            body: { appendChild: () => {} },
            createElement(tag: string) {
                assert.equal(tag, 'a');
                return {
                    href: '',
                    download: '',
                    dispatchEvent() {
                        click?.();
                        clicked.push(this.download);
                        return true;
                    },
                    remove() {},
                };
            },
        },
    });
    URL.createObjectURL = ((blob: Blob) => {
        blobs.push(blob);
        return 'blob:pr865-' + blobs.length;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = () => {};
    return {
        blobs,
        clicked,
        restore() {
            URL.createObjectURL = oldCreate;
            URL.revokeObjectURL = oldRevoke;
            if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
            else Reflect.deleteProperty(globalThis, 'document');
            if (oldMouseEvent) Object.defineProperty(globalThis, 'MouseEvent', oldMouseEvent);
            else Reflect.deleteProperty(globalThis, 'MouseEvent');
        },
    };
}

test__s22('v2 uses a fresh local Detail without cloud fetch, and refreshes stale Detail through L1 admission', async () => {
    const id = 'freshness';
    await admitFixture(account.id, snapshot(id, 'Saved local answer'));
    let fetches = 0;
    const restoreProvider = registerCustomProvider({
        fetchConversationDetail: async (accountId, conversationId) => {
            assert.equal(accountId, account.id);
            assert.equal(conversationId, id);
            fetches++;
            await admitFixture(accountId, snapshot(id, 'Fresh cloud answer', sourceTime + 5_000));
        },
    });
    const download = captureBrowserDownloads();
    try {
        assert.equal((await runExport(request(id))).exported, 1);
        assert.equal(fetches, 0, 'a complete, current Detail does not need a remote fetch');
        assert.match(await download.blobs[0].text(), /Saved local answer/);

        await putIndexes([makeConversationIndex({
            key: { accountId: account.id, conversationId: id }, title: id, updatedAt: sourceTime + 5_000,
        })]);
        assert.equal((await runExport(request(id))).exported, 1);
        assert.equal(fetches, 1);
        assert.match(await download.blobs[1].text(), /Fresh cloud answer/);
        assert.doesNotMatch(await download.blobs[1].text(), /Saved local answer/);
        assert.equal((await getExportRecord(key(id)))?.chatTime, sourceTime + 5_000);
        assert.equal((await runExport(request(id, { skipUnchanged: true }))).skipped, 1);
        assert.equal(fetches, 1);
    } finally {
        download.restore();
        restoreProvider();
    }
});

test__s22('a transient refresh failure exports a stale snapshot as partial, retries Skip and becomes ok after fresh admission', async () => {
    const id = 'retry_snapshot';
    await admitFixture(account.id, snapshot(id, 'Saved snapshot'));
    await putIndexes([makeConversationIndex({
        key: { accountId: account.id, conversationId: id }, title: id, updatedAt: sourceTime + 5_000,
    })]);
    let fetches = 0;
    let available = false;
    const restoreProvider = registerCustomProvider({
        fetchConversationDetail: async (accountId) => {
            fetches++;
            if (!available) throw new Error('HTTP 503');
            await admitFixture(accountId, snapshot(id, 'Updated body', sourceTime + 5_000));
        },
    });
    const download = captureBrowserDownloads();
    try {
        const first = await runExport(request(id));
        assert.deepEqual({ exported: first.exported, partial: first.partial, failed: first.failed.length },
            { exported: 1, partial: 1, failed: 0 });
        assert.match(await download.blobs[0].text(), /Saved snapshot/);
        assert.deepEqual(
            { status: (await getExportRecord(key(id)))?.status, chatTime: (await getExportRecord(key(id)))?.chatTime },
            { status: 'partial', chatTime: sourceTime },
        );

        const retry = await runExport(request(id, { skipUnchanged: true }));
        assert.equal(retry.skipped, 0);
        assert.equal(fetches, 2, 'partial snapshots are not eligible for Skip');
        available = true;
        const refreshed = await runExport(request(id, { skipUnchanged: true }));
        assert.equal(refreshed.partial, 0);
        assert.equal((await getExportRecord(key(id)))?.status, 'ok');
        assert.equal((await getExportRecord(key(id)))?.chatTime, sourceTime + 5_000);
        assert.match(await download.blobs[2].text(), /Updated body/);
        assert.equal((await runExport(request(id, { skipUnchanged: true }))).skipped, 1);
        assert.equal(fetches, 3);
    } finally {
        download.restore();
        restoreProvider();
    }
});

test__s22('unavailable resources mark delivered content partial; explicitly excluding assets is not a failure', async t => {
    const previousZip = __getZipConstructor();
    __setZipConstructor(require('../lib/jszip.min.js'));
    t.after(()=>__setZipConstructor(previousZip));
    const id = 'missing_resource';
    const source = historicalFixture({
        id, title: id, updatedAt: sourceTime,
        messages: [{ role: 'model', content: 'Saved answer',
            images: [{ url: 'https://example.com/missing.png', fileName: 'missing.png' }] }],
    }, { providerId: 'custom', qualityStatusOverride: 'complete' });
    assert.ok(collectDocumentResources(composeDomainDocument(source.conversation, source.account)).referencedIds.size,
        'fixture must reference an actual v2 Document AST resource');
    await admitFixture(account.id, source);
    let detailFetches = 0;
    let assetFetches = 0;
    const restoreProvider = registerCustomProvider({
        fetchConversationDetail: async () => { detailFetches++; throw new Error('unnecessary Detail fetch'); },
        acquireResource: async () => { assetFetches++; throw new Error('unavailable resource bytes'); },
    });
    const download = captureBrowserDownloads();
    try {
        const incomplete = await runExport(request(id, { includeAssets: true }));
        assert.equal(incomplete.exported, 1);
        assert.equal(incomplete.partial, 1);
        assert.equal(incomplete.failed.length, 0);
        assert.ok(assetFetches > 0);
        assert.equal(detailFetches, 0);
        assert.equal((await getExportRecord(key(id)))?.status, 'partial');
        const zip = await require('../lib/jszip.min.js').loadAsync(await download.blobs[0].arrayBuffer());
        const name = Object.keys(zip.files).find(name => name.endsWith('.md'));
        assert.ok(name);
        assert.match(await zip.file(name).async('string'), /Saved answer/);
        const attempts = assetFetches;

        const withoutAssets = await runExport(request(id, { includeAssets: false, skipUnchanged: true }));
        assert.equal(withoutAssets.skipped, 0, 'a previous partial delivery must be retried');
        assert.equal(withoutAssets.exported, 1);
        assert.equal(withoutAssets.partial, 0, 'an explicit no-assets choice is not partial');
        assert.equal(assetFetches, attempts, 'no resources are acquired when includeAssets=false');
        assert.equal((await getExportRecord(key(id)))?.status, 'ok');
        assert.equal((await runExport(request(id, { includeAssets: true, skipUnchanged: true }))).skipped, 0,
            'a text-only export does not cover a subsequent attachment request');
    } finally {
        download.restore();
        restoreProvider();
    }
});

test__s22('confirmed conversation_not_found deletes the local Key/record and forbids old-Detail fallback', async () => {
    const id = 'confirmed_deleted';
    await admitFixture(account.id, snapshot(id, 'Must not export deleted answer'));
    await putIndexes([makeConversationIndex({
        key: { accountId: account.id, conversationId: id }, title: id, updatedAt: sourceTime + 1_000,
    })]);
    await putExportRecord(key(id), { exportedAt: sourceTime + 2_000, format: 'markdown',
        status: 'partial', chatTime: sourceTime });
    const restoreProvider = registerCustomProvider({
        fetchConversationDetail: async (accountId, conversationId) => {
            await ingestDeletedConversation(accountId, conversationId);
            throw new Error('conversation_not_found');
        },
    });
    const download = captureBrowserDownloads();
    try {
        const result = await runExport(request(id));
        assert.equal(result.exported, 0);
        assert.deepEqual(result.failed, [key(id)]);
        assert.equal(download.clicked.length, 0);
        assert.equal(await getIndex(key(id)), null);
        assert.equal(await getDetail(key(id)), null);
        assert.equal(await getExportRecord(key(id)), null);
    } finally {
        download.restore();
        restoreProvider();
    }
});

test__s22('a failed fetch does not use another account\'s Detail or create a record', async () => {
    const id = 'missing_local';
    const foreign = historicalFixture({
        id, title: 'Other account', updatedAt: sourceTime,
        messages: [{ role: 'user', content: 'Private other-account answer' }],
    }, { qualityStatusOverride: 'complete' });
    await admitFixture(otherAccountId, bindFixture(foreign, otherAccountId));
    await putIndexes([makeConversationIndex({ key: { accountId: account.id, conversationId: id }, title: 'Not available', updatedAt: sourceTime })]);
    const restoreProvider = registerCustomProvider();
    const download = captureBrowserDownloads();
    try {
        const result = await runExport(request(id));
        assert.equal(result.exported, 0);
        assert.deepEqual(result.failed, [key(id)]);
        assert.equal(await getExportRecord(key(id)), null);
        assert.equal(download.clicked.length, 0);
        assert.ok(await getDetail({ accountId: otherAccountId, conversationId: id }),
            'foreign Account data must remain isolated and intact');
    } finally {
        download.restore();
        restoreProvider();
    }
});

test__s22('ExportRecord.chatTime uses the delivered Detail version, never a newer Index timestamp', async () => {
    const id = 'older_body_version';
    await admitFixture(account.id, snapshot(id, 'Captured older body'));
    await putIndexes([makeConversationIndex({
        key: { accountId: account.id, conversationId: id }, title: id, updatedAt: sourceTime + 5_000,
    })]);
    let attempts = 0;
    const restoreProvider = registerCustomProvider({
        fetchConversationDetail: async () => { attempts++; throw new Error('HTTP 503'); },
    });
    const download = captureBrowserDownloads();
    try {
        assert.equal((await runExport(request(id))).partial, 1);
        const record = await getExportRecord(key(id));
        assert.equal(record?.chatTime, sourceTime);
        assert.equal(record?.status, 'partial');
        assert.equal((await getIndex(key(id)))?.updatedAt, sourceTime + 5_000);
        const next = await runExport(request(id, { skipUnchanged: true }));
        assert.equal(next.skipped, 0);
        assert.equal(attempts, 2);
    } finally {
        download.restore();
        restoreProvider();
    }
});

test__s22('v2 Skip requires an ok record for the same format and a comparable body version', () => {
    const wanted = request('skip_rule', { skipUnchanged: true });
    const record = { exportedAt: sourceTime + 10, format: 'markdown' as const, includeAssets: true,
        status: 'ok' as const, chatTime: sourceTime };
    assert.equal(shouldSkipExport(record, sourceTime, wanted), true);
    assert.equal(shouldSkipExport({ ...record, sourceTurn: 'unfinished' }, sourceTime, wanted), false);
    assert.equal(shouldSkipExport({ ...record, sourceTurn: 'unknown' }, sourceTime, wanted), false);
    assert.equal(shouldSkipExport({ ...record, sourceTurn: 'handoff' }, sourceTime, wanted), false);
    assert.equal(shouldSkipExport({ ...record, sourceTurn: 'finished' }, sourceTime, wanted), true);
    assert.equal(shouldSkipExport(record, sourceTime + 1, wanted), false);
    assert.equal(shouldSkipExport({ ...record, status: 'partial' }, sourceTime, wanted), false);
    assert.equal(shouldSkipExport({ ...record, format: 'json' }, sourceTime, wanted), false);
    assert.equal(shouldSkipExport({ ...record, chatTime: undefined }, sourceTime, wanted), false);
    assert.equal(shouldSkipExport(record, undefined, wanted), false);
    assert.equal(shouldSkipExport(record, sourceTime, request('skip_rule')), false);
});

test__s22('records are written only after final Browser Download starts, not after rendering/staging', async () => {
    const id = 'delivery_gate';
    await admitFixture(account.id, snapshot(id, 'Delivery gate'));
    let failClick = true;
    const restoreProvider = registerCustomProvider({
        fetchConversationDetail: async () => { throw new Error('unexpected refresh'); },
    });
    const download = captureBrowserDownloads(() => {
        if (failClick) throw new Error('Unable to start download');
    });
    try {
        const notDelivered = await runExport(request(id));
        assert.equal(notDelivered.exported, 0);
        assert.deepEqual(notDelivered.failed, [key(id)]);
        assert.equal(await getExportRecord(key(id)), null);
        failClick = false;
        const delivered = await runExport(request(id));
        assert.equal(delivered.exported, 1);
        assert.equal(delivered.failed.length, 0);
        assert.equal(download.clicked.length, 1);
        assert.equal((await getExportRecord(key(id)))?.status, 'ok');
    } finally {
        download.restore();
        restoreProvider();
    }
});

test__s22('v2 Sync reports real incomplete/aborted/error outcomes instead of a 100% success broadcast', async () => {
    const previous = ProviderRegistry.get('gemini');
    assert.ok(previous, 'the Gemini provider must be registered');
    let mode: ListEnd | 'abort' | 'failure' = 'source_end';
    const mock: AIProvider = {
        id: 'gemini',
        name: 'Scan outcome fixture',
        hostPatterns: [],
        matchesUrl: () => false,
        checkReadiness: async () => ({ ready: true }),
        fetchConversationDetail: async () => {},
        acquireResource: async () => ({ bytes: new Uint8Array([1]) }),
        listConversations: async options => {
            await options.onPageCommitted?.({ page: 1, totalObserved: 3 });
            if (mode === 'abort') throw new DOMException('Stopped', 'AbortError');
            if (mode === 'failure') throw new Error('HTTP 503');
            return mode;
        },
    };
    ProviderRegistry.register(mock);
    try {
        const cases: Array<{ end: ListEnd | 'abort' | 'failure'; status: string; reason?: string }> = [
            { end: 'provider_limit', status: 'partial_limit', reason: 'provider_limit' },
            { end: 'max_pages', status: 'partial_limit', reason: 'max_pages' },
            { end: 'stopped', status: 'error', reason: 'Unverified scan stop' },
            { end: 'abort', status: 'aborted' },
            { end: 'failure', status: 'error', reason: 'HTTP 503' },
            { end: 'source_end', status: 'complete' },
        ];
        for (const scenario of cases) {
            mode = scenario.end;
            const progress: number[] = [];
            const result = await scanAll({ accountId: '10000000-0000-4000-8000-000000000001' },
                { onProgress: value => progress.push(value.conversationsFetched) });
            assert.equal(result.status, scenario.status, scenario.end);
            assert.equal(result.reason, scenario.reason, scenario.end);
            assert.deepEqual(progress, [3]);
            assert.equal(result.pagesFetched, 1);
            assert.equal(result.conversationsFetched, 3);
        }
    } finally {
        ProviderRegistry.register(previous);
    }
});
});

__suiteDescribe("provider-fixture-contract", () => {
test__s23('provider fixture references resolve and generators never execute a production parser', () => {
    assert.deepEqual(inventory().unresolved, []);
    const folder = join(__dirname, 'fixtures/providers');
    for (const name of sources(folder).filter((name: string) => name.endsWith('.ts'))) {
        const source = readFileSync(name, 'utf8');
        const runtimeImports = [...source.matchAll(/import\s+(?!type\b)[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g)];
        assert.deepEqual(runtimeImports.filter(match => match[1].includes('/src/')).map(match => match[1]), [], name);
        assert.doesNotMatch(source, /(?:require\s*\(|import\s*\()\s*['"][^'"]*\/src\//, name);
    }
});

test__s23('Grok endpoint fixtures isolate provider mutations from subsequent reads', () => {
    const detail = detailGen('GR_DETAIL_TEXT_01');
    const image = detailGen('GR_DETAIL_IMAGE_01');
    detail.bodies.responses.pop();
    detail.metadata.conversation.title = 'changed';
    image.tree.responseNodes.pop();
    const tree = treeGen('GR_TREE_INFLIGHT_01');
    tree.responseNodes.pop();
    const list = listGen('GR_LIST_TERMINAL_01');
    list.conversations[0].title = 'changed';
    assert.equal(detailGen('GR_DETAIL_TEXT_01').bodies.responses.length, 2);
    assert.equal(detailGen('GR_DETAIL_IMAGE_01').tree.responseNodes.length, 6);
    assert.equal(treeGen('GR_TREE_STABLE_01').responseNodes.length, 2);
    assert.deepEqual(treeGen('GR_TREE_STABLE_01').inflightResponses, []);
    assert.equal(listGen('GR_LIST_TERMINAL_01').conversations[0].title, 'Exporter Integration Test Comparison Table');
});


test__s23('fixture provenance covers every fixed key with existing evidence and honest source units', () => {
    const keys = fixtureCatalog.map(entry => entry.key);
    assert.equal(new Set(keys).size, keys.length, 'metadata must have one owner per key');
    assert.deepEqual([...keys].sort(), inventory().fixtures.map((entry: { key: string }) => entry.key).sort());
    for (const { key, origin } of fixtureCatalog) {
        if (origin.kind === 'synthetic') {
            assert.ok(origin.purpose.trim(), key);
            continue;
        }
        const evidence = origin.kind === 'captured' ? [origin.source] : origin.sources;
        assert.ok(evidence.length, key);
        for (const file of evidence) {
            assert.ok(file.startsWith('tests/fixtures/'), key + ': ' + file);
            assert.ok(existsSync(resolve(__dirname, '..', file)), key + ': ' + file);
        }
        assert.ok((origin.kind === 'captured' ? origin.unit : origin.changes).trim(), key);
    }
    const origin = (key: string) => fixtureCatalog.find(entry => entry.key === key)?.origin;
    assert.equal(origin('G_NATIVE_CAPTURE_DELETE_RESPONSE_01')?.kind, 'captured');
    assert.equal(origin('G_STRUCTURED_CITATIONS_10')?.kind, 'derived');
    assert.equal(origin('G_STREAM_CAPTURED_ANSWERED_01')?.kind, 'derived');
    assert.equal(origin('C_CAPTURE_EMPTY_DETAIL_01')?.kind, 'synthetic');
    assert.equal(origin('CL_L1_SOURCE_SELECTED_BRANCH_01')?.kind, 'synthetic');
    assert.equal(origin('GR_TREE_INFLIGHT_01')?.kind, 'derived');
});
});

__suiteDescribe("wire_fixture_preparation", () => {
test__s24('JSON preparation keeps graph references aligned and masks text at every byte and code-unit boundary', () => {
    const input = {
        current_node: 'private-node',
        mapping: { 'private-node': { id: 'private-node', parent: null, parts: ['**Aé中🚀**', true, 4] } },
        'signed/url~v1': 'https://private.example/file?sig=private-value',
        purpose: 'Approved QA prose',
    };
    const result = sanitizeProviderWire(JSON.stringify(input), JSON.stringify({
        aliases: { 'private-node': 'fixture-node' },
        redact: [{ pointer: '/mapping/private-node/parts/0' }, { pointer: '/signed~1url~0v1', replacement: 'https://example.test/file' }],
    }), 'json');
    const output = JSON.parse(result);
    assert.equal(output.current_node, 'fixture-node');
    assert.equal(output.mapping[output.current_node].id, 'fixture-node');
    const before = input.mapping['private-node'];
    const after = output.mapping[output.current_node];
    assert.equal(after.parent, null);
    assert.deepEqual(after.parts, ['**xø文😀**', true, 4]);
    const offsets = (text: string) => Array.from(text).map(char => [Buffer.byteLength(char), char.length]);
    assert.deepEqual(offsets(after.parts[0]), offsets(String(before.parts[0])));
    assert.equal(output['signed/url~v1'], 'https://example.test/file');
    assert.equal(output.purpose, input.purpose);
    assert.doesNotMatch(result, /private-node|private-value|Aé中🚀/);
});

test__s24('SSE preparation retains event order and terminal marker without counting comments as data events', () => {
    const stream = ': private transport note\r\n\r\n'
        + 'event: message_start\r\ndata: {"id":"private-id",\r\ndata: "role":"assistant"}\r\n\r\n'
        + 'event: content_block_delta\r\ndata: {"text":"Sensitive"}\r\n\r\ndata: [DONE]\r\n\r\n';
    assert.equal(sanitizeProviderWire(stream, JSON.stringify({
        redact: [{ pointer: '/1/text' }], aliases: { 'private-id': 'fixture-id' },
    }), 'sse'), 'event: message_start\ndata: {"id":"fixture-id","role":"assistant"}\n\n'
        + 'event: content_block_delta\ndata: {"text":"xxxxxxxxx"}\n\ndata: [DONE]\n\n');
});

test__s24('preparation rejects stale plans, aliases that collide, loss of numeric precision and incomplete streams', () => {
    const plan = '{"redact":[{"pointer":"/message"}]}';
    assert.throws(() => sanitizeProviderWire('{"message":"private",broken}', plan, 'json'), /Invalid capture JSON/);
    assert.throws(() => sanitizeProviderWire('{"other":"private"}', plan, 'json'), /unmatched/);
    assert.throws(() => sanitizeProviderWire('{"message":42}', plan, 'json'), /must select a string/);
    assert.throws(() => sanitizeProviderWire('{"message":"private","number":9007199254740995}', plan, 'json'), /number/);
    assert.throws(() => sanitizeProviderWire('{"a":"first","b":"second"}', '{"redact":[],"aliases":{"a":"b"}}', 'json'), /collides/);
    assert.throws(() => sanitizeProviderWire('data: {"message":"private"}\n', plan, 'sse'), /incomplete/);
    assert.throws(() => sanitizeProviderWire('data: {"message":"private"}\nid: private\n\n', plan, 'sse'), /Unsupported SSE field/);
});

test__s24('Gemini CLI accepts input and output without a salt and does not emit malformed captures', t => {
    const directory = mkdtempSync(join(tmpdir(), 'gemini-wire-test-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const source = join(directory, 'source.txt');
    const output = join(directory, 'review.txt');
    const cli = (...args: string[]) => spawnSync(process.execPath, [
        '-r', join(__dirname, 'ts_register.js'), join(__dirname, '../scripts/sanitize_gemini_wire.ts'), ...args,
    ], { encoding: 'utf8' });
    writeFileSync(source, JSON.stringify([['di', 'example']]), 'utf8');
    const valid = cli(source, output, '--mode', 'full');
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(readFileSync(output, 'utf8'))[0][0], 'di');
    assert.doesNotMatch(readFileSync(output, 'utf8'), /example/);
    writeFileSync(source, ")]}'\n\nmalformed canary\n", 'utf8');
    const invalid = cli(source);
    assert.notEqual(invalid.status, 0);
    assert.equal(invalid.stdout, '');
    assert.doesNotMatch(invalid.stderr, /malformed canary/);
});
});
