import { describe as __suiteDescribe } from 'node:test';
import { fixtureKey } from "./helpers/domainFixture.js";
import { fixtureAccountFor } from "./helpers/domainFixture.js";
import { validateParserDomain } from "../src/l2/runtimeValidation.js";
import { historicalFixture } from "./helpers/nativeFixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTitle } from "../src/l2/titleAuthority.js";
import { titleAuthorityRank } from "../src/l2/titleAuthority.js";
import { assertDomainClosure } from "../src/l2/closure.js";
import { composeDomainDocument } from "../src/l3b/compose/composeDomainDocument.js";
import { renderDocumentHtml } from "../src/l4/format/html/renderHtml.js";
import { renderDocumentMarkdown } from "../src/l4/format/markdown/renderMarkdown.js";
import { renderDocumentTypst } from "./helpers/renderTypstFixture.js";
import { normalizeArchiveResourceName } from "../src/shared/utils/archivePath.js";
import { type DomainConversationWithDetail } from "../src/l2/conversation.js";
import { restoreDomainSnapshot } from "../src/l2/runtimeValidation.js";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { useIndexStorage } from "./helpers/indexStorage.js";
import { admitFixture } from "./helpers/admitFixture.js";
import { fixtureAccount } from "./helpers/domainFixture.js";
import test__s2 from "node:test";
import { TITLE_AUTHORITY_RANK } from "../src/l2/titleAuthority.js";
import { closeDomainResources } from "../src/l1/parsers/shared/resources/domainResourceAdapter.js";
import { storageIdentity } from "./helpers/admitFixture.js";
import { readFixture } from "./helpers/admitFixture.js";
import { acquireSourceResource } from "../src/l1/resources/sourceResources.js";
import { attemptResource } from "../src/shared/resources/resourceResult.js";
import { putExportRecord } from "../src/l3a/storageService.js";
import { ingestDetail } from "../src/l2/ingestion.js";
import { readConversation } from "../src/l2/readConversation.js";
import { contentComposer } from "../src/l3b/compose/composeContent.js";
import { makeConversationIndex } from "./helpers/conversationIndexFixture.js";
import { historicalFixtureDomain } from "./helpers/nativeFixture.js";
import { type HistoricalConversation as Conversation } from "./helpers/historicalConversation.js";
import { composeFixture } from "./helpers/documentFixture.js";
import { type DocumentAst } from "../src/l3b/ast/ast.js";
import { type DisplayBlock } from "../src/l3b/ast/ast.js";
import { type DomainAsset } from "../src/l2/conversationDetail.js";
import test__s6 from "node:test";
import { planExportPaths } from "../src/l4/packaging/index.js";
import { type PreparedResources } from "../src/shared/resources/resourceResult.js";
import { normalizeTimestamp } from "../src/l1/parsers/shared/time.js";
import { mergeConversationPages } from "../src/l1/parsers/gemini/rpc/mergePages.js";
import { collectDocumentResources } from "../src/l3b/ast/resourceReferences.js";
import { messageAssets } from "./helpers/domainAssets.js";
import { resolveSourceAttachmentGroups } from "../src/l1/parsers/shared/resources/resolveResources.js";
import { type SourceAttachmentLists } from "../src/l1/parsers/shared/resources/resolveResources.js";
import { structuredBodyAttachments } from "./helpers/recordFixture/contentAdapter.js";
import * as equal from "../src/l2/domainEquality.js";
import { type DomainConversationDetail } from "../src/l2/conversationDetail.js";
import { type DomainConversationIndex } from "../src/l2/conversationIndex.js";
import { type BlockNode } from "../src/l2/content/blocks.js";
import { ACCOUNT_UUID } from "./helpers/accountIds.js";
import { readAccount } from "../src/l2/accountRegistry.js";
import { readAccountParameters } from "../src/l2/accountRegistry.js";
import { readAccountRegistry } from "../src/l2/accountRegistry.js";
import { conversationKey } from "../src/l2/conversationKey.js";
import { readConversationKey } from "../src/l2/conversationKey.js";
import { mergeConversationIndex } from "../src/l2/conversationIndex.js";
import { restoreConversationIndex } from "../src/l2/conversationIndex.js";

__suiteDescribe("domain-contract", () => {
/** Domain/composer contracts, including the shared title authority rules. */










function domain(): DomainConversationWithDetail {
    return { index: { key: fixtureKey(String('contract'), 'test'),   titleSource: "derived",   title: 'Contract' }, detail: { key: fixtureKey(String('contract'), 'test'), quality: { status: 'unknown' }, assets: [], messages: [{ id: 'm', role: 'assistant', content: [{ type: 'unknown', sourceType: 'widget', text: 'Visible fallback' }] }] } };
}
test('Domain closure rejects missing provider identity and duplicate resource identities', () => {
    const value = domain();
    assert.throws(() => composeDomainDocument(validateParserDomain(value), { ...fixtureAccountFor(value), providerId: '' }), /account/i); value.detail.assets = [{ id: 'same', kind: 'image' }, { id: 'same', kind: 'image' }];
    assert.throws(() => assertDomainClosure((value).detail), /Duplicate.*asset identity/);
});
test('AST: composer gives every message a unique positional ID without changing authored identities', () => {
    const value = domain();
    value.detail.messages = [undefined, 'msg-0', 'same', 'same', '', '   '].map((id, index) => ({
        ...(id !== undefined ? { id } : {}), role: 'assistant',
        content: [{ type: 'paragraph', children: [{ type: 'text', text: `Message ${index}` }] }],
        citations: [{ id: 'citation', url: `https://example.test/${index}` }],
    }));
    const original = structuredClone(value);
    const document = composeDomainDocument(validateParserDomain(value), fixtureAccountFor(validateParserDomain(value)));
    assert.equal(document.messages.length, value.detail.messages.length);
    assert.ok(document.messages.every(message => !('id' in message)));
    assert.deepEqual(document.messages.flatMap(message => message.sources?.map(item => item.number) ?? []), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(value, original);
});
test('unknown content and message order survive a JSON round trip across all backends', () => {
    const value = domain(); value.detail.messages.push({ id: 'second', role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Second message' }] }] });
    const document = composeDomainDocument(validateParserDomain(value), fixtureAccountFor(validateParserDomain(value)));
    assert.deepEqual(composeDomainDocument(JSON.parse(JSON.stringify(value)), fixtureAccountFor(JSON.parse(JSON.stringify(value)))), document);
    for (const output of [renderDocumentHtml(document, {}).html, renderDocumentMarkdown(document, {}), JSON.stringify(renderDocumentTypst(document, {}))]) {
        assert.ok(output.includes('Visible fallback'));
        assert.ok(output.indexOf('Visible fallback') < output.indexOf('Second message'));
    }
});
test('HTML and Markdown sanitize hostile link protocols without rejecting visible labels', () => {
    for (const href of ['javascript:alert(1)', 'vbscript:evil', 'data:text/html,evil']) {
        const value = domain(); value.detail.messages[0].content = [{ type: 'paragraph', children: [{ type: 'link', href, children: [{ type: 'text', text: 'Safe label' }] }] }];
        const document = composeDomainDocument(validateParserDomain(value), fixtureAccountFor(validateParserDomain(value)));
        for (const output of [renderDocumentHtml(document, {}).html, renderDocumentMarkdown(document, {})]) {
            assert.ok(output.includes('Safe label'));
            assert.ok(!output.includes(href));
        }
    }
});
test('archive preparation rejects traversal and absolute destinations', () => {
    for (const path of ['../x.png', 'assets/../x.png', '/absolute.png', 'C:/x.png', 'assets/%2e%2e/x.png', '//host/x.png']) assert.throws(() => normalizeArchiveResourceName(path));
});
test('unknown provider bodies have a bounded deterministic fallback, and raw input stays intact', () => {
    const raw = { id: 'unknown-content', messages: [{ role: 'widget', content: { message: 'x'.repeat(5000) } }] };
    const original = structuredClone(raw);
    const parsed = historicalFixture(raw, { providerId: 'gemini' });
    const content = parsed.conversation.detail.messages[0].content[0];
    assert.equal(content.type, 'unknown');
    if (content.type === 'unknown') { assert.ok(content.text.length <= 2001); assert.ok(content.text.endsWith('…')); assert.ok(content.sourceType); }
    assert.deepEqual(raw, original);
    assert.ok(parsed.diagnostics.some(d => d.code === 'UNKNOWN_MESSAGE_CONTENT'));
});

// ---------------------------------------------------------- title authority
test('stronger title evidence wins across source tiers even when weaker evidence is newer', () => {
    const cases: { label: string; candidates: Parameters<typeof resolveTitle>[0]; value: string; source: string }[] = [
        { label: 'sniff cannot downgrade rpc', candidates: [{ value: 'RPC title', source: "provider" }, { value: 'Sniff title', source: "derived" }], value: 'RPC title', source: 'provider' },
        { label: 'rpc can upgrade takeout', candidates: [{ value: 'Takeout title', source: "derived" }, { value: 'RPC title', source: "provider" }], value: 'RPC title', source: 'provider' },
        { label: 'newer sniff cannot replace older rpc', candidates: [
            { value: 'Older RPC', source: "provider", observedAt: '2026-01-01T00:00:00Z' },
            { value: 'Newer sniff', source: "derived", observedAt: '2026-06-01T00:00:00Z' },
        ], value: 'Older RPC', source: 'provider' },
        { label: 'user title outranks derived title', candidates: [{ value: 'Derived', source: 'derived' }, { value: 'My title', source: 'user' }], value: 'My title', source: 'user' },
    ];
    for (const { label, candidates, value, source } of cases) {
        const winner = resolveTitle(candidates);
        assert.equal(winner?.value, value, label);
        assert.equal(winner?.source, source, label);
    }
});

test('same-tier titles use admission order independently of observation times', () => {
    const earlier = '2026-01-01T00:00:00Z';
    const later = '2026-02-01T00:00:00Z';
    const cases: { label: string; candidates: Parameters<typeof resolveTitle>[0]; winner: string }[] = [
        { label: 'newer replaces older', candidates: [{ value: 'old', source: "provider", observedAt: earlier }, { value: 'new', source: "provider", observedAt: later }], winner: 'new' },
        { label: 'older cannot replace newer', candidates: [{ value: 'new', source: "provider", observedAt: later }, { value: 'old', source: "provider", observedAt: earlier }], winner: 'old' },
        { label: 'dated beats undated', candidates: [{ value: 'undated', source: "provider" }, { value: 'dated', source: "provider", observedAt: later }], winner: 'dated' },
        { label: 'undated cannot beat dated', candidates: [{ value: 'dated', source: "provider", observedAt: later }, { value: 'undated', source: "provider" }], winner: 'undated' },
        { label: 'last arrival wins when both undated', candidates: [{ value: 'first', source: "provider" }, { value: 'last', source: "provider" }], winner: 'last' },
        { label: 'last arrival wins on equal timestamps', candidates: [{ value: 'first', source: "provider", observedAt: later }, { value: 'last', source: "provider", observedAt: later }], winner: 'last' },
    ];
    for (const { label, candidates, winner } of cases) {
        assert.equal(resolveTitle(candidates)?.value, winner, label);
    }
});

test('empty title candidates and unsafe inherited source names never become authority', () => {
    assert.equal(resolveTitle([]), undefined);
    assert.equal(resolveTitle([{ value: '   ', source: "provider" }]), undefined);
    for (const source of ['unknown', '__proto__', 'constructor', 'toString']) {
        assert.equal(titleAuthorityRank(source), 0, source);
    }
});
});

__suiteDescribe("domain-json-contract", () => {
/** Runtime closure and JSON portability of actual Domain and Document AST fixtures. */









test('each Domain fixture is closed and JSON round-trip preserves every backend output', () => {
    const dir = join(__dirname, 'fixtures', 'document-domain');
    const files = readdirSync(dir).filter(file => file.endsWith('.json'));
    assert.ok(files.length > 0, 'the document-domain fixture suite must not be empty');
    for (const file of files) {
        const fixture: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'));
        const domain = restoreDomainSnapshot(fixture);
        assertDomainClosure((domain).detail);
        const before = JSON.stringify(domain);
        const document = composeDomainDocument(domain, fixtureAccountFor(domain));
        const roundTrip = composeDomainDocument(restoreDomainSnapshot(JSON.parse(before)), fixtureAccountFor(restoreDomainSnapshot(JSON.parse(before))));
        assert.deepEqual(roundTrip, document, file);
        const backends = [renderDocumentHtml, renderDocumentMarkdown, renderDocumentTypst];
        for (const backend of backends) assert.deepEqual(backend(document, {}), backend(roundTrip, {}), file);
        assert.equal(JSON.stringify(domain), before);
        const json = JSON.stringify(document);
        for (const field of ['conversation', 'assets', 'reasoning', 'storageRef', 'sourceRef', 'initiallyCollapsed', 'pdfLayout', 'measurementText', 'frontMatter', 'theme', 'modelLabel']) assert.ok(!json.includes(`"${field}":`), `${file}: ${field}`);
    }
});
test('provider-only state and malformed title data cannot become document context', () => {
    const raw = { id: 'state', title: { text: 'not a title' }, theme: 'dark', messages: [{ role: 'model', content: 'Authored content', initiallyCollapsed: false }] };
    const original = structuredClone(raw);
    const { conversation } = historicalFixture(raw as never, { providerId: 'gemini' });
    assert.equal(typeof conversation.index.title, 'undefined');
    const document = composeDomainDocument(conversation, fixtureAccountFor(conversation));
    assert.ok(!JSON.stringify(document).includes('initiallyCollapsed'));
    assert.ok(!JSON.stringify(document).includes('not a title'));
    assert.deepEqual(raw, original);
});
});

__suiteDescribe("domain_contract_final", () => {
useIndexStorage();













const base = (): DomainConversationWithDetail => ({ index: { key: fixtureKey(String('final-contract'), 'custom'),   titleSource: "derived",   title: 'Final' }, detail: { key: fixtureKey(String('final-contract'), 'custom'), quality: { status: 'unknown' }, assets: [], messages: [] } });

test__s2('current schema rejects deleted fields and empty resource objects at the existing snapshot boundary', () => {
    for (const invalid of [
        { index: { ...base().index }, detail: {   ...base().detail, messages: [{ role: 'unknown', content: [], provenance: { rawRole: 'tool' } }] } },
        { index: { ...base().index }, detail: {   ...base().detail, messages: [{ role: 'unknown', content: [], rawRole: 'tool' }] } },
        { index: { ...base().index }, detail: {   ...base().detail, assets: [{ id: 'a', kind: 'image', failureReason: 'HTTP 404' }] } },
        { index: { ...base().index }, detail: {   ...base().detail, messages: [{ role: 'assistant', content: [], citations: [{ id: 'c', number: 4 }] }] } },
        { index: { ...base().index }, detail: {   ...base().detail, assets: [{ id: 'a', kind: 'image', generation: {} }] } },
        { index: { ...base().index }, detail: {   ...base().detail, assets: [{ id: 'a', kind: 'file', document: {} }] } },
        { index: { ...base().index, titleSource: 'future-provider-tier' }, detail: {   ...base().detail } },
    ]) assert.throws(() => restoreDomainSnapshot(invalid), /Invalid (?:persisted Domain contract|conversation index)/);
    for (const titleSource of Object.keys(TITLE_AUTHORITY_RANK)) assert.equal(restoreDomainSnapshot({ index: { ...base().index, ...(titleSource === 'default' ? { title: '' } : {}), titleSource }, detail: {   ...base().detail } }).index.titleSource, titleSource);
});

test__s2('partial resource identities remain valid and parsers omit absent generation/document information', () => {
    for (const generation of [{ providerRequestId: 'request' }, { time: 0 }, { prompt: '' }, { generationOrdinal: 0 }, { imageCount: 0 }, { imageOrdinal: 0 }]) {
        const source = { index: { ...base().index }, detail: {   ...base().detail, assets: [{ id: 'a', kind: 'image', generation }] } };
        assert.deepEqual(restoreDomainSnapshot(source).detail.assets[0].generation, generation);
    }
    for (const document of [{ id: 'report' }, { contentMarkdown: '' }]) {
        assert.deepEqual(restoreDomainSnapshot({ index: { ...base().index }, detail: {   ...base().detail, assets: [{ id: 'a', kind: 'file', document }] } }).detail.assets[0].document, document);
    }
    const result = closeDomainResources('custom', [], [{ input: { attachments: [{ type: 'file', url: 'opaque:file', id: undefined, contentMarkdown: undefined, hasFabricatedText: undefined }] } }]);
    assert.equal(Object.hasOwn(result.assets[0], 'generation'), false);
    assert.equal(Object.hasOwn(result.assets[0], 'document'), false);
    validateParserDomain({ index: { ...base().index }, detail: {   ...base().detail, assets: result.assets } });
    const generated = closeDomainResources('custom', [], [{ input: { attachments: [{ type: 'image', generation: { chatId: 'c', generationOrdinal: 0, providerRequestId: undefined, prompt: undefined, time: undefined } }] } }]);
    assert.deepEqual(generated.assets[0].generation, { generationOrdinal: 0 });
    assert.deepEqual(restoreDomainSnapshot({ index: { ...base().index }, detail: {   ...base().detail, assets: generated.assets } }).detail.assets, generated.assets);
});

test__s2('restored Domain detects heuristic reports and unavailable images without persisted acquisition failures', async () => {

    try {
        const conversation = validateParserDomain({ index: { ...base().index }, detail: {   ...base().detail, quality: { status: 'partial' }, assets: [
            { id: 'report', kind: 'file', document: { id: 'original-report', contentMarkdown: '# Deep Research\n\nComplete retained body' } },
            { id: 'image', kind: 'image', sourceUri: 'Takeout/missing.png', generation: { imageOrdinal: 0 } },
        ], messages: [{ role: 'assistant', content: [{ type: 'image', assetId: 'image' }], attachmentIds: ['report'] }] } });
        await admitFixture(fixtureAccount('custom').id, { account: fixtureAccount('custom'), conversation, acquisitionHints: {}, resourceHints: {}, diagnostics: [] });
        const stored = await readFixture(storageIdentity('custom', fixtureAccount('custom').id, conversation.index.key.conversationId));
        assert.ok(stored);
        const restored = stored;
        assert.equal(restored.evidence, undefined);
        assert.deepEqual(restored.conversation.detail.quality, { status: 'partial' });
        assert.equal(restored.conversation.detail.assets[0].document?.contentMarkdown, conversation.detail.assets[0].document?.contentMarkdown);
        assert.equal('generation' in (restored.conversation.detail.messages[0] ?? {}), false);
        const image = restored.conversation.detail.assets.find(asset => asset.id === 'image')!;
        const result = await attemptResource(image.id, () => acquireSourceResource(image));
        assert.equal(result.ok, false);
        if (result.ok) throw new Error('expected a resource failure');
        assert.equal(result.resourceId, 'image');
        assert.equal(result.code, 'RESOURCE_LOCATOR_UNAVAILABLE');
        assert.equal(result.issue?.code, 'RESOURCE_LOCATOR_UNAVAILABLE');
        assert.equal(Object.hasOwn(restored.conversation.detail.assets[1], 'failureReason'), false);
    } finally { /* useIndexStorage owns the IndexedDB lifetime. */ }
});
});

__suiteDescribe("domain_downstream_boundaries", () => {
useIndexStorage();









const index = makeConversationIndex({ key: fixtureKey('review123'), title: 'Review fixture', titleSource: 'provider', updatedAt: 1700000000000 });

test('malformed delivery history cannot contaminate the independently validated Domain snapshot', async () => {
    await ingestDetail(index.key.accountId, index.key.conversationId, { quality: { status: 'complete' }, assets: [], messages: [] },
        { title: index.title, titleSource: index.titleSource, updatedAt: index.updatedAt });
    const original = await readConversation(index.key);
    for (const record of [null, [], 1, { chatTime: { toString: null } }, { messageCount: 'many' }, { status: {} }, { hasFailedAssets: 'yes' }, { chatTime: Infinity }]) {
        await putExportRecord(index.key, record as never);
        assert.deepEqual(await readConversation(index.key), original);
    }
});

test('validated tables compose across header rowspans without changing Domain data', () => {
    const input = validateParserDomain({ index, detail: { key: index.key, quality: { status: 'complete' }, assets: [], messages: [{ role: 'assistant', content: [{ type: 'table', headerRows: [{ cells: [{ children: [], rowSpan: 2 }] }], rows: [{ cells: [{ children: [], colSpan: 2 }] }, { cells: [] }] }] }] } });
    const original = JSON.stringify(input);
    const blocks = contentComposer(new Map(), id => ({ id, label: id }))(input.detail.messages[0].content);
    assert.equal(JSON.stringify(input), original);
    const table = blocks[0];
    assert.equal(table.type, 'table');
    if (table.type !== 'table') throw new Error('Expected table');
    assert.deepEqual(table.columnAlignments, ['default', 'default', 'default']);
    assert.equal(table.rows[0][0].column, 1);
    assert.equal(table.rows[0][0].colSpan, 2);
    assert.deepEqual(table.rows[1], []);
});
});

__suiteDescribe("domain_provider_parity", () => {
async function assertDomainDocument(conversation: Conversation, expected: DocumentAst): Promise<void> {
    const { conversation: domain, resourceHints } = historicalFixture(conversation);
    const result = await composeFixture(domain, resourceHints);
    assert.deepEqual(result.document, expected);
}

const paragraph = (text: string): DisplayBlock => ({ type: 'paragraph', children: [{ type: 'text', text }] });
const reasoning = (text: string): DisplayBlock => ({
    type: 'disclosure', kind: 'reasoning', title: 'Thinking Process', blocks: [paragraph(text)],
});
const expectedMetadata = { id: 'd2-conversation', provider: 'gemini' };

const metadata = {
    id: 'd2-conversation',
    title: 'Document parity',
    timestamp: 1_700_000_000_000,
};

test('Domain composition preserves provider parsing for an RPC conversation', async () => {
    const conversation: Conversation = {
        ...metadata,
        updatedAt: 1_700_000_001_000,
        url: 'https://gemini.google.com/app/d2-conversation',
        messages: [
            { id: 'user-1', role: 'user', content: 'Question', timestamp: 1_700_000_000_000 },
            { id: 'model-1', role: 'model', content: 'Answer', timestamp: 1_700_000_001_000 },
        ],
    };
    await assertDomainDocument(conversation, {
        title: 'Document parity',
        metadata: { ...expectedMetadata, updatedAt: 1_700_000_001_000 },
        messages: [
            { role: 'user', timestamp: 1_700_000_000_000, blocks: [paragraph('Question')] },
            { role: 'assistant', timestamp: 1_700_000_001_000, blocks: [paragraph('Answer')] },
        ],
    });
});

test('Domain composition preserves provider parsing for attachments and generated media', async () => {
    const conversation: Conversation = {
        ...metadata,
        messages: [{
            role: 'model', content: 'Generated image',
            attachments: [{
                type: 'image', isGenerated: true, url: 'https://example.test/generated.png',
                generation: {
                    chatId: metadata.id, providerRequestId: 'request-42', time: null,
                    prompt: 'A blue bird', generationOrdinal: 1, imageCount: 1, imageOrdinal: 0,
                },
            }],
        }],
    };
    await assertDomainDocument(conversation, {
        title: 'Document parity', metadata: expectedMetadata,
        messages: [{ role: 'assistant', blocks: [
            paragraph('Generated image'),
            { type: 'image', resourceId: 'resource-307c26709cfd66cc', alt: 'Image' },
        ] }],
    });
});

test('Domain composition preserves provider parsing for citations and documents', async () => {
    const conversation: Conversation = {
        ...metadata,
        messages: [{
            role: 'assistant', content: 'Research [1]', thoughts: 'Considering sources',
            citations: [{ url: 'https://example.test/source', title: 'Source' }],
            documents: [{
                type: 'doc', id: 'doc-1', title: 'Research report',
                url: 'https://example.test/report', contentMarkdown: '# Findings', sections: ['Findings'],
                links: [{ title: 'Source', url: 'https://example.test/source' }],
            }],
        }],
    };
    await assertDomainDocument(conversation, {
        title: 'Document parity', metadata: expectedMetadata,
        messages: [{ role: 'assistant', blocks: [
            reasoning('Considering sources'),
            { type: 'paragraph', children: [
                { type: 'text', text: 'Research ' },
                { type: 'citation', id: 'citation-0', label: '[1]', href: 'https://example.test/source' },
            ] },
            { type: 'file', resourceId: 'resource-51a850dd7c9aaa21', label: 'Research report', kind: 'file', byteLength: 10 },
        ], sources: [{ id: 'citation-0', label: 'Source', href: 'https://example.test/source', number: 1 }] }],
    });
});

test('Domain composition preserves provider parsing after flattening turns-only input', async () => {
    const conversation: Conversation = {
        ...metadata,
        source: 'takeout',
        turns: [
            { timestamp: 1_700_000_000_000, userContent: 'Question', modelContent: 'Answer', thoughts: ['Reasoning'] },
            { messages: [{ role: 'user', content: 'Follow-up', timestamp: null }, { role: 'model', content: 'Follow-up answer' }] },
        ],
    };
    const domain = historicalFixtureDomain(conversation);
    assert.equal('turns' in domain, false);
    assert.deepEqual(domain.detail.messages.map((message) => message.role), ['user', 'assistant', 'user', 'assistant']);
    await assertDomainDocument(conversation, {
        title: 'Document parity', metadata: expectedMetadata,
        messages: [
            { role: 'user', timestamp: 1_700_000_000_000, blocks: [paragraph('Question')] },
            { role: 'assistant', timestamp: 1_700_000_000_000, blocks: [reasoning('Reasoning'), paragraph('Answer')] },
            { role: 'user', blocks: [paragraph('Follow-up')] },
            { role: 'assistant', blocks: [paragraph('Follow-up answer')] },
        ],
    });
});
});

__suiteDescribe("domain_resource_metadata_contract", () => {
const base = (assets: DomainAsset[] = []): DomainConversationWithDetail => ({ index: { key: fixtureKey(String('chat'), 'custom'),   titleSource: "derived",   title: 'Resources' }, detail: { key: fixtureKey(String('chat'), 'custom'), quality: { status: 'unknown' }, assets, messages: [] } });
test('source metadata stays outside Domain and canonical report body retains authored sections and links', () => {
    const result = closeDomainResources('custom', [], [{ input: { attachments: [{ type: 'file', id: 'report', url: 'https://example.test/report', createdAt: 1, chipUrl: 'https://example.test/chip', width: 100, height: 80, source: 'source', sections: ['# Report', 'Evidence'], links: [{ title: 'Reference', url: 'https://example.test/reference' }], candidates: ['https://example.test/download'] }] } }]);
    const asset = result.assets[0];
    assert.equal(asset.sourceUri, 'https://example.test/report');
    for (const key of ['origin', 'dimensions', 'source', 'generated']) assert.equal(Object.hasOwn(asset, key), false);
    assert.ok(asset.document?.contentMarkdown?.includes('# Report'));
    assert.ok(asset.document?.contentMarkdown?.includes('[Reference](https://example.test/reference)'));
    for (const key of ['createdAt', 'chipUrl', 'sections', 'links', 'candidates']) assert.equal(Object.hasOwn(asset.document ?? {}, key), false);
    assert.deepEqual(result.acquisitionHints[asset.id].candidates, ['https://example.test/download']);
    validateParserDomain(base([asset]));
});
test('new schema rejects every removed asset and generation field', () => {
    const valid: DomainAsset = { id: 'asset', kind: 'image', sourceUri: 'original', generation: { providerRequestId: 'request', time: 123, generationOrdinal: 0 } };
    for (const [key, value] of Object.entries({ source: { uri: 'old' }, origin: 'rpc', dimensions: { width: 1 }, generated: true })) {
        assert.throws(() => validateParserDomain(base([{ ...valid, [key]: value }])));
    }
    for (const key of ['chatId', 'turnId']) assert.throws(() => validateParserDomain(base([{ ...valid, generation: { providerRequestId: 'request', [key]: 'old' } }])));
    for (const key of ['createdAt', 'chipUrl', 'sections', 'links', 'candidates']) assert.throws(() => validateParserDomain(base([{ ...valid, document: { contentMarkdown: 'body', [key]: 'old' } }])));
    assert.throws(() => validateParserDomain(base([{ ...valid, generation: { time: null as never } }])));
});


test('canonical report body keeps independent sections and links', () => {
    const result = closeDomainResources('custom', [], [{ input: { attachments: [{ type: 'file', contentMarkdown: '# Canonical', sections: ['# Canonical', 'Unique section'], links: [{ title: 'Evidence', url: 'https://example.test/evidence' }] }] } }]);
    assert.equal(result.assets[0].document?.contentMarkdown, '# Canonical\n\nUnique section\n\n[Evidence](https://example.test/evidence)');
});

test('L2 never admits ephemeral signed resource locators or invalid byte counts', () => {
    for (const sourceUri of [
        '', 'data:image/png;base64,AQID', 'blob:https://example.test/a',
        'https://example.test/image?X-Amz-Date=20261019T120000Z&X-Amz-Signature=abc',
        'https://example.test/image?X-Goog-Credential=abc&X-Goog-Signature=abc',
        'https://example.test/file?Expires=123&Signature=abc&Key-Pair-Id=key',
        'https://example.test/image?token=temporary',
        'archive/images/photo.png?token=temporary',
    ]) assert.throws(() => validateParserDomain(base([{ id: 'image', kind: 'image', sourceUri }])), TypeError, sourceUri);
    for (const byteLength of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
        assert.throws(() => validateParserDomain(base([{ id: 'image', kind: 'image', byteLength }])), TypeError);
    validateParserDomain(base([{ id: 'image', kind: 'image', sourceUri: 'https://example.test/image?id=stable', byteLength: 0 }]));
    validateParserDomain(base([{ id: 'image', kind: 'image', sourceUri: 'provider-stable-resource-id' }]));
    validateParserDomain(base([{ id: 'image', kind: 'image', sourceUri: 'archive/photo.png' }]));
});
});

__suiteDescribe("domain_resource_sources", () => {
const base = { id: 'resource-sources', title: '', timestamp: null };

test__s6('renaming source archive paths cannot change Domain identity or Packaging destinations', async () => {
    const input: Conversation = { ...base, messages: [{ role: 'model', content: '![caption](old/photo.png)', attachments: [{
        type: 'image', name: 'Authored photo', url: 'https://example.test/photo', localName: 'old/photo.png',
        isGenerated: true, generation: { chatId: base.id, generationOrdinal: 1, imageOrdinal: 0 },
    }] }] };
    const before = structuredClone(input);
    const renamed = structuredClone(input);
    renamed.messages![0].content = '![caption](new/photo.webp)';
    renamed.messages![0].attachments![0].localName = 'new/photo.webp';
    const first = historicalFixture(input), second = historicalFixture(renamed);
    assert.deepEqual(first.conversation, second.conversation);
    assert.deepEqual(input, before);
    const asset = first.conversation.detail.assets[0];
    assert.deepEqual(asset.sourceUri, 'https://example.test/photo');
    assert.equal(asset.name, 'Authored photo');
    const prepared: PreparedResources = new Map([[asset.id, { ok: true, resourceId: asset.id, value: { bytes: new Uint8Array([1]), mediaType: 'image/png' } }]]);
    const firstPlan = planExportPaths([{ conversation: first.conversation, prepared, fileIds: new Set<string>() }], 'markdown')[0];
    const secondPlan = planExportPaths([{ conversation: second.conversation, prepared, fileIds: new Set<string>() }], 'markdown')[0];
    assert.deepEqual(firstPlan, secondPlan);
    assert.ok(firstPlan.resources[asset.id].endsWith('Authored photo.png'));
    assert.ok(!JSON.stringify(firstPlan).includes('old/photo'));
    const restored = JSON.parse(JSON.stringify(first.conversation));
    assert.deepEqual(restored, first.conversation);
    assert.deepEqual(planExportPaths([{ conversation: restored, prepared, fileIds: new Set<string>() }], 'markdown')[0], firstPlan);
});

test__s6('same export destination cannot collapse resources from different sources', () => {
    const { conversation } = historicalFixture({ ...base, messages: [{ role: 'user', content: '', attachments: [
        { type: 'image', url: 'https://example.test/one', localName: 'assets/same.png' },
        { type: 'image', url: 'https://example.test/two', localName: 'assets/same.png' },
    ] }] });
    assert.equal(conversation.detail.assets.length, 2);
    assert.notEqual(conversation.detail.assets[0].id, conversation.detail.assets[1].id);
});

test__s6('one source remains one resource across renamed legacy destinations', () => {
    const { conversation } = historicalFixture({ ...base, messages: [
        { role: 'user', content: '![one](one.png)', attachments: [{ type: 'image', url: 'https://example.test/shared', localName: 'one.png' }] },
        { role: 'model', content: '![two](two.png)', images: [{ type: 'image', url: 'https://example.test/shared', localName: 'two.png' }] },
    ] });
    assert.equal(conversation.detail.assets.length, 1);
    assert.deepEqual(conversation.detail.messages[0].attachmentIds, conversation.detail.messages[1].attachmentIds);
    assert.ok(conversation.detail.messages.every(message => JSON.stringify(message.content).includes(conversation.detail.assets[0].id)));
});

test__s6('destination-only resources retain distinct occurrence identities without path/name/kind leakage', () => {
    const input: Conversation = { ...base, messages: [{ role: 'user', content: '', attachments: [
        { type: 'file', localName: 'old/report.pdf' }, { type: 'file', localName: 'old/report.pdf' },
    ] }] };
    const renamed = structuredClone(input);
    renamed.messages![0].attachments!.forEach(item => { item.localName = 'new/image.png'; });
    const first = historicalFixture(input).conversation;
    assert.deepEqual(first, historicalFixture(renamed).conversation);
    assert.equal(first.detail.assets.length, 2);
    assert.ok(first.detail.assets.every(asset => asset.kind === 'file' && !asset.sourceUri && !asset.name));
});

test__s6('ambiguous export aliases remain unresolved instead of becoming acquisition sources', () => {
    const { conversation } = historicalFixture({ ...base, messages: [{
        role: 'user', content: '![caption](same.png)', attachments: [
            { type: 'image', url: 'https://example.test/one', localName: 'same.png' },
            { type: 'image', url: 'https://example.test/two', localName: 'same.png' },
        ],
    }] });
    assert.equal(conversation.detail.assets.length, 3);
    assert.equal(conversation.detail.assets[2].sourceUri, undefined);
});
});

__suiteDescribe("domain_timestamp_contract", () => {
const exportDomainMarkdown = (domain: Parameters<typeof composeDomainDocument>[0], account: Parameters<typeof composeDomainDocument>[1]) => renderDocumentMarkdown(composeDomainDocument(domain, account), {});

const base = (): DomainConversationWithDetail => ({ index: { key: fixtureKey(String('chat'), 'custom'),   titleSource: "derived",   title: 'Times' }, detail: { key: fixtureKey(String('chat'), 'custom'), quality: { status: 'unknown' }, assets: [], messages: [] } });
test('conversation times are independent finite epoch milliseconds and unknown facts are absent', () => {
    assert.equal(normalizeTimestamp(0), 0);
    assert.equal(normalizeTimestamp(null), undefined);
    assert.equal(normalizeTimestamp('1700000000123'), 1700000000123);
    assert.equal(normalizeTimestamp('2026-10-06T00:00:00Z'), Date.parse('2026-10-06T00:00:00Z'));
    for (const invalid of [0.5, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1])
        assert.equal(normalizeTimestamp(invalid), undefined);
    for (const invalid of [null, NaN, Infinity, '', 'bad-date', true, {}]) {
        assert.equal(normalizeTimestamp(invalid), undefined);
        if (invalid !== undefined) assert.throws(() => validateParserDomain({ index: { ...base().index, createdAt: invalid as never }, detail: {   ...base().detail } }));
    }
    assert.deepEqual(restoreDomainSnapshot(base()), base());
});
test('current snapshots reject historical aliases and representations', () => {
    for (const key of ['updatedAt', 'timestamp', 'chatTime', 'lastSeen', 'href', 'titles', 'provenance']) {
        assert.throws(() => restoreDomainSnapshot({ index: { ...base().index }, detail: {   ...base().detail }, [key]: key === 'timestamp' ? null : 'old' }));
    }
    const old = { index: { ...base().index, createdAt: '2026-10-06T00:00:00Z', updatedAt: null }, detail: {   ...base().detail, completeness: { status: 'partial', reason: 'Selected' } }, timestamp: 123, href: 'https://example.test/chat' };
    assert.throws(() => restoreDomainSnapshot(old));
});
test('message dates do not fabricate conversation creation or update facts during pagination', () => {
    const conversation = validateParserDomain({ index: { ...base().index }, detail: {   ...base().detail, messages: [{ role: 'user', timestamp: 1700000000000, content: [] }] } });
    const { key: _indexKey, ...index } = conversation.index;
    const { key: _detailKey, ...detail } = conversation.detail;
    const merged = mergeConversationPages([{ conversationId: conversation.index.key.conversationId, conversation: { index, detail }, acquisitionHints: {}, diagnostics: [] }]);
    assert.equal(merged.conversation.index.createdAt, undefined);
    assert.equal(merged.sourceVersion, undefined);
    assert.equal(merged.conversation.detail.messages[0].timestamp, 1700000000000);
});
test('Markdown preserves independently known creation/update facts and omits unknown times', async () => {
    const dated = validateParserDomain({ index: { ...base().index, createdAt: 0 }, detail: {   ...base().detail } });
    const markdown = await exportDomainMarkdown({ ...dated, index: { ...dated.index, updatedAt: 1000 } }, fixtureAccountFor({ ...dated, index: { ...dated.index, updatedAt: 1000 } }));
    assert.ok(markdown.includes('1970-01-01T00:00:00.000Z'));
    assert.ok(markdown.includes('1970-01-01T00:00:01.000Z'));
    const undated = await exportDomainMarkdown(validateParserDomain(base()), fixtureAccountFor(validateParserDomain(base())));
    assert.equal(undated.includes('date:'), false);
    assert.equal(undated.includes('updated:'), false);
});

test('L2 admission protects the L3b Unix-ms contract from fractional and unsafe source times', () => {
    for (const value of [0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, 8640000000000001, -8640000000000001]) {
        for (const field of ['createdAt', 'updatedAt', 'activityAt']) {
            assert.throws(() => validateParserDomain({ ...base(), index: { ...base().index, [field]: value } }), TypeError);
        }
        assert.throws(() => validateParserDomain({ ...base(), detail: { ...base().detail,
            messages: [{ role: 'assistant', timestamp: value, content: [] }] } }), TypeError);
        assert.throws(() => validateParserDomain({ ...base(), detail: { ...base().detail, savedAt: value } }), TypeError);
        assert.throws(() => restoreDomainSnapshot({ ...base(), detail: { ...base().detail, savedAt: value } }), TypeError);
        assert.throws(() => validateParserDomain({ ...base(), detail: { ...base().detail,
            assets: [{ id: 'image', kind: 'image', generation: { time: value } }] } }), TypeError);
    }
    const admitted = validateParserDomain({ ...base(), index: { ...base().index, createdAt: 0 },
        detail: { ...base().detail, messages: [{ role: 'assistant', timestamp: 0, content: [] }] } });
    const document = require('../src/l3b/compose/composeDomainDocument.js').composeDomainDocument(admitted, fixtureAccountFor(admitted));
    assert.equal(document.metadata.createdAt, 0); assert.equal(document.messages[0].timestamp, 0);
});

test('L2 admits both inclusive Date boundaries', () => {
    for (const value of [-8640000000000000, 8640000000000000]) {
        const domain = { index: { ...base().index, createdAt: value, updatedAt: value, activityAt: value },
            detail: { ...base().detail, savedAt: value,
                messages: [{ role: 'assistant' as const, timestamp: value, content: [] }],
                assets: [{ id: 'image', kind: 'image' as const, generation: { time: value } }] } };
        assert.deepEqual(validateParserDomain(domain), domain);
        assert.deepEqual(restoreDomainSnapshot(domain), domain);
    }
});
});

__suiteDescribe("domain_attachment_cleanup", () => {
const normalizeSourceAttachments = (input: SourceAttachmentLists) => resolveSourceAttachmentGroups([{ input }]).attachments;



const metadata = { id: 'resources', title: 'Resources', timestamp: null };
const generation = { chatId: metadata.id, providerRequestId: 'abcdef0123456789', time: 1700000000123,
    prompt: 'Draw a lake', generationOrdinal: 2, imageCount: 1, imageOrdinal: 0, turnId: 'turn-2' };

async function assertRoundTrip(input: Conversation): Promise<DomainConversationWithDetail> {
    const original = structuredClone(input);
    const { conversation: domain, resourceHints } = historicalFixture(input);
    const serialized: DomainConversationWithDetail = JSON.parse(JSON.stringify(domain));
    const [raw, semantic, restored] = await Promise.all([
        composeFixture(historicalFixture(input, { providerId: 'gemini' }).conversation, resourceHints), composeFixture(domain, resourceHints), composeFixture(serialized, resourceHints),
    ]);
    assert.deepEqual(semantic.document, raw.document);
    assert.deepEqual(restored.document, semantic.document);
    assert.deepEqual(input, original);
    for (const message of domain.detail.messages) {
        assert.equal('images' in message, false);
        assert.equal('documents' in message, false);
    }
    return domain;
}

test('all legacy resource paths produce one Domain resource, with document and generated metadata intact', async () => {
    const structuredContent = JSON.parse(readFileSync(join(__dirname, 'fixtures/provider/structured_rpc/b-stack-structured.json'), 'utf8'));
    const [image] = structuredBodyAttachments({ structuredContent });
    assert.ok(image.sourceUrl);
    const document = { type: 'file', id: 'report-id', title: 'Report', createdAt: null,
        localName: 'files/report.md', url: 'https://example.test/report', chipUrl: 'https://example.test/chip',
        contentMarkdown: '# Report', sections: ['Intro'], links: [{ title: 'Source', url: 'https://example.test/source' }],
        candidates: ['https://example.test/report', 'https://example.test/preview'], hasFabricatedText: false };
    const input: Conversation = { ...metadata, messages: [{ role: 'assistant', content: 'fallback', structuredContent,
        attachments: [{ type: 'file', localName: document.localName, url: document.url }, { ...image, isGenerated: true, generation }],
        images: [{ type: 'image', url: image.sourceUrl, providerRequestId: generation.providerRequestId, imageOrdinal: 0 }],
        documents: [document, structuredClone(document)],
    }] };
    const domain = await assertRoundTrip(input);
    const resources = messageAssets(domain, 0)!;
    assert.equal(resources.length, 2);
    assert.equal(resources[0].name, 'Report');
    assert.deepEqual(resources[0].sourceUri, document.url);
    assert.deepEqual(resources[0].document, {
        id: document.id, contentMarkdown: '# Report\n\nIntro\n\n[Source](https://example.test/source)',
    });
    assert.deepEqual(resources[1].generation, Object.fromEntries(Object.entries(generation).filter(([key]) => key !== 'chatId' && key !== 'turnId')));
    assert.equal(Reflect.get(resources[1], 'generated'), undefined);
    assert.equal('sourceEvidence' in resources[1], false);
    assert.equal('token' in resources[1], false);
    assert.notEqual(Reflect.get(resources[0].document ?? {}, 'sections'), document.sections);
    assert.notEqual(resources[1].generation, generation);
});

test('missing and inline documents deduplicate by values, never shared object identity', async () => {
    for (const contentMarkdown of [undefined, '# Inline report']) {
        const document = { type: 'file', fileName: 'report.md', sections: ['Intro'], contentMarkdown };
        const input: Conversation = { ...metadata, messages: [{ role: 'assistant', content: '',
            attachments: [structuredClone(document)], documents: [structuredClone(document)] }] };
        const domain = await assertRoundTrip(input);
        assert.equal(messageAssets(domain, 0)?.length, 1);
        assert.deepEqual(messageAssets(domain, 0)?.[0].document?.contentMarkdown, contentMarkdown ? `${contentMarkdown}\n\nIntro` : 'Intro');
    }
});

test('document IDs reconcile metadata without any downloadable reference', async () => {
    const document = { type: 'file', id: 'report', title: 'Report' };
    const domain = await assertRoundTrip({ ...metadata, messages: [{ role: 'assistant', content: '',
        attachments: [document],
        documents: [{ type: 'doc', id: 'report', sections: ['Intro'], links: [], createdAt: 1700000000123 }],
    }] });
    assert.equal(messageAssets(domain, 0)?.length, 1);
    assert.equal(messageAssets(domain, 0)?.[0].document?.id, 'report');
    assert.equal(messageAssets(domain, 0)?.[0].document?.contentMarkdown, 'Intro');
});

test('merging document aliases preserves repeated metadata entries and supplements missing values', () => {
    const link = { title: 'Source', url: 'https://example.test/source' };
    const source = { attachments: [{ type: 'file', id: 'report', sections: ['Intro', 'Intro'], links: [link, link] }],
        documents: [{ type: 'doc', id: 'report', sections: ['Intro', 'Intro', 'Conclusion'], links: [link, link],
            candidates: ['https://example.test/report', 'https://example.test/report'] }] };
    const original = structuredClone(source);
    const [resource] = normalizeSourceAttachments(source);
    assert.deepEqual(resource.sections, ['Intro', 'Intro', 'Conclusion']);
    assert.deepEqual(resource.links, [link, link]);
    assert.deepEqual(resource.candidates, ['https://example.test/report', 'https://example.test/report']);
    resource.links![0].title = 'Changed';
    assert.deepEqual(source, original);
});

test('all reference fields participate in deduplication and bridging aliases collapse transitively', () => {
    const resources = normalizeSourceAttachments({
        attachments: [{ type: 'image', localName: 'assets/lake.png', width: 100 },
            { type: 'image', url: 'https://example.test/lake', height: 200 }],
        images: [{ type: 'image', localName: 'lake.png', sourceUrl: 'https://example.test/lake', mimeType: 'image/png' }],
    });
    assert.equal(resources.length, 1);
    assert.equal(resources[0].width, 100);
    assert.equal(resources[0].height, 200);
    assert.equal(resources[0].mimeType, 'image/png');
});

test('same filenames do not collapse different resources or anonymous missing records', () => {
    const resources = normalizeSourceAttachments({ attachments: [
        { type: 'image', localName: 'one/lake.png' }, { type: 'image', localName: 'two/lake.png' },
        { type: 'file' }, { type: 'file' },
    ] });
    assert.equal(resources.length, 4);
});

test('provider tokens resolve generated representations before tokens leave Domain', () => {
    const source = { attachments: [{ type: 'image', token: 'provider-token', sourceUrl: 'https://example.test/thumb', width: 100 }],
        images: [{ type: 'image', token: 'provider-token', sourceUrl: 'https://example.test/full', width: 1024, isGenerated: true, generation }] };
    const original = structuredClone(source);
    const [resource] = normalizeSourceAttachments(source);
    assert.equal(resource.sourceUrl, 'https://example.test/full');
    assert.equal(resource.width, 1024);
    assert.deepEqual(resource.generation, generation);
    assert.equal('token' in resource, false);
    assert.deepEqual(source, original);
});

test('resource metadata fills absent fields while preserving empty generation text and list occurrences', () => {
    const link = { title: 'Evidence', url: 'https://example.test/reference' };
    const source: SourceAttachmentLists = {
        attachments: [{ type: 'image', url: 'https://example.test/image', name: '',
            generation: { chatId: 'chat', generationOrdinal: 0, prompt: '' },
            sections: ['A'], links: [link], candidates: ['download'] }],
        images: [{ type: 'image', url: 'https://example.test/image', name: 'Image',
            generation: { chatId: 'chat', generationOrdinal: 0, prompt: 'Later prompt', imageCount: 1 },
            sections: ['A', 'A', 'B'], links: [link, { url: link.url, title: link.title }],
            candidates: ['download', 'download', 'preview'] }],
    };
    const original = structuredClone(source);
    const [resource] = normalizeSourceAttachments(source);
    assert.equal(resource.name, 'Image');
    assert.deepEqual(resource.generation, { chatId: 'chat', generationOrdinal: 0, prompt: '', imageCount: 1 });
    assert.deepEqual(resource.sections, ['A', 'A', 'B']);
    assert.deepEqual(resource.links, [link, link]);
    assert.deepEqual(resource.candidates, ['download', 'download', 'preview']);
    assert.deepEqual(source, original);
});

test('reliable generation identity merges online/offline paths and preserves metadata', async () => {
    const domain = await assertRoundTrip({ ...metadata, messages: [{ role: 'assistant', content: '',
        attachments: [{ type: 'image', localName: 'online.png', providerRequestId: 'r_ABCDEF0123456789', imageOrdinal: 0 }],
        images: [{ type: 'image', localName: 'offline.png', isGenerated: true, generation, dataBase64: 'AQID' }],
    }] });
    assert.equal(messageAssets(domain, 0)?.length, 1);
    assert.equal(messageAssets(domain, 0)?.[0].sourceUri, undefined);
    assert.deepEqual(messageAssets(domain, 0)?.[0].generation, Object.fromEntries(Object.entries(generation).filter(([key]) => key !== 'chatId' && key !== 'turnId')));
    assert.ok(messageAssets(domain, 0)?.[0].generation);
});

test('body references to discarded provider aliases bind to the one semantic resource', async () => {
    const domain = await assertRoundTrip({ ...metadata, messages: [{ role: 'assistant', content: '![Lake](assets/offline.png)',
        attachments: [{ type: 'image', localName: 'online.png', generation }],
        images: [{ type: 'image', localName: 'assets/offline.png', generation, isGenerated: true }],
    }] });
    assert.equal(messageAssets(domain, 0)?.length, 1);
    const paragraph = domain.detail.messages[0].content[0];
    assert.ok(paragraph.type === 'paragraph' && paragraph.children[0].type === 'image');
    assert.equal(paragraph.children[0].assetId, messageAssets(domain)[0].id);
    assert.equal(collectDocumentResources((await composeFixture(domain)).document).referencedIds.size, 1);
});

test('unknown image ordinals and conflicting generation ownership remain distinct', () => {
    const ambiguous = { ...generation, imageOrdinal: undefined, imageCount: 2 };
    assert.equal(normalizeSourceAttachments({ attachments: [
        { type: 'image', localName: 'one.png', generation: ambiguous },
        { type: 'image', localName: 'two.png', generation: ambiguous },
    ] }).length, 2);
    assert.equal(normalizeSourceAttachments({ attachments: [
        { type: 'image', url: 'https://example.test/shared', generation },
        { type: 'image', url: 'https://example.test/shared', generation: { ...generation, chatId: 'other-chat' } },
        { type: 'image', url: 'https://example.test/shared', generation: { ...generation, imageOrdinal: 1 } },
    ] }).length, 3);
});

test('an untagged alias cannot bridge conflicting document or generation identities', () => {
    const url = 'https://example.test/shared';
    assert.equal(normalizeSourceAttachments({
        attachments: [{ type: 'file', id: 'report-a', url }, { type: 'file', id: 'report-b', url }],
        documents: [{ type: 'file', url }],
    }).length, 3);
    assert.equal(normalizeSourceAttachments({
        attachments: [{ type: 'image', url, generation },
            { type: 'image', url, generation: { ...generation, chatId: 'other-chat' } }],
        images: [{ type: 'image', url }],
    }).length, 3);
});

test('generation event metadata without a request ID needs matching time, prompt and known image ordinal', () => {
    const event = { ...generation, providerRequestId: undefined };
    const resources = normalizeSourceAttachments({ attachments: [
        { type: 'image', localName: 'online.png', generation: event },
        { type: 'image', localName: 'offline.png', generation: event },
        { type: 'image', localName: 'online.png', generation: { ...event, time: 1700000005123 } },
    ] });
    assert.equal(resources.length, 2);
    assert.equal(resources[0].localName, 'online.png');
});

test('binary views survive Domain JSON round trips without changing input bytes', async () => {
    const buffer = new Uint8Array([9, 1, 2, 3, 9]);
    const view = new DataView(buffer.buffer, 1, 3);
    const domain = await assertRoundTrip({ ...metadata, messages: [{ role: 'assistant', content: '', attachments: [
        { type: 'file', name: 'bytes.bin', dataBuffer: view },
    ] }] });
    assert.equal(Object.hasOwn(messageAssets(domain, 0)![0], 'dataBase64'), false);
    assert.equal('dataBuffer' in messageAssets(domain, 0)![0], false);
    assert.deepEqual([...buffer], [9, 1, 2, 3, 9]);
    buffer[1] = 99;
    assert.equal(Object.hasOwn(messageAssets(domain, 0)![0], 'dataBase64'), false);
});

test('shared source gate rejects runtime legacy aliases; Composer uses explicit Domain resources', async () => {
    const resource = { id: 'report', kind: 'file' as const, name: 'report.md', document: { contentMarkdown: '# Report' } };
    const domain: DomainConversationWithDetail = { index: { key: fixtureKey(String(metadata.id), 'gemini'),   titleSource: "derived",  title: metadata.title,  }, detail: { key: fixtureKey(String(metadata.id), 'gemini'), quality: { status: 'unknown' }, assets: [resource], messages: [{ role: 'assistant', content: [], attachmentIds: [resource.id] }] } };
    const expected = await composeFixture(domain);
    const leaked = { index: { ...domain.index }, detail: {   ...domain.detail, messages: [{ ...domain.detail.messages[0], images: [{ type: 'image', url: 'wrong.png' }], documents: [{ ...resource }] }] } };
    await assert.rejects(composeFixture(leaked), /Invalid persisted Domain contract: messages/);
    assert.equal(collectDocumentResources(expected.document).referencedIds.size, 1);
    const explicit = { index: { ...domain.index }, detail: {   ...domain.detail, assets: [resource, { ...resource, id: 'second-report' }], messages: [{ ...domain.detail.messages[0], attachmentIds: [resource.id, 'second-report'] }] } };
    assert.equal(collectDocumentResources((await composeFixture(explicit)).document).referencedIds.size, 2,
        'Composer must not reconcile alias evidence or infer resource identity');
});

test('shared Composer and Domain consumption have no legacy resource alias reconciliation', () => {
    for (const file of ['src/l2/closure.ts', 'src/l3b/compose/composeDomainDocument.ts',
        'src/l3b/compose/composeContent.ts']) {
        const source = readFileSync(join(__dirname, '..', file), 'utf8');
        assert.doesNotMatch(source, /mergeMessageAttachments|reconcileLegacyMediaLists|structuredBodyAttachments|attachments\.includes|\bimages\??:|\bdocuments\??:/);
    }
});
});

__suiteDescribe("l2_domain_equality", () => {
const key = fixtureKey('typed-equality');
const sampleIndex = (): DomainConversationIndex => ({
    key: { ...key }, title: 'Hi', titleSource: 'provider', createdAt: 10, updatedAt: 20, activityAt: 25,
});
const sampleBlocks = (): BlockNode[] => [
    { type: 'paragraph', children: [
        { type: 'strong', children: [{ type: 'text', text: 'hello' }] },
        { type: 'emphasis', children: [{ type: 'strikethrough', children: [{ type: 'citationRef', citationId: 'source', label: '[1]' }] }] },
        { type: 'link', href: 'https://example.test', children: [{ type: 'inlineCode', code: 'echo' }] },
        { type: 'image', assetId: 'image', alt: 'inline', title: 'icon' },
        { type: 'inlineMath', source: 'x^2' }, { type: 'lineBreak', kind: 'hard' },
    ] },
    { type: 'heading', level: 2, children: [{ type: 'text', text: 'title' }] },
    { type: 'list', ordered: true, start: 3, items: [{ blocks: [{ type: 'quote', blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'quoted' }] }] }] }] },
    { type: 'code', code: 'print(1)', language: 'py', meta: 'fixture' },
    { type: 'math', source: 'y=2' },
    { type: 'table', caption: [{ type: 'text', text: 'caption' }], columns: [{ align: 'left' }],
        headerRows: [{ cells: [{ children: [{ type: 'text', text: 'header' }], colSpan: 1 }] }],
        rows: [{ cells: [{ children: [{ type: 'text', text: 'body' }], rowSpan: 2 }] }] },
    { type: 'image', assetId: 'image', alt: 'block', caption: [{ type: 'text', text: 'caption' }] },
    { type: 'file', assetId: 'file', label: 'download', description: [{ type: 'text', text: 'file description' }] },
    { type: 'thematicBreak' }, { type: 'unknown', sourceType: 'future', text: 'raw fallback' },
];
const sampleAssets = (): DomainAsset[] => [
    { id: 'image', kind: 'image', name: 'photo', mediaType: 'image/png', byteLength: 123,
        sourceUri: 'https://example.test/i.png',
        generation: { providerRequestId: 'request', time: 123, prompt: 'p',
            generationOrdinal: 1, imageCount: 3, imageOrdinal: 0 } },
    { id: 'file', kind: 'file', document: { id: 'doc', contentMarkdown: '# markdown' } },
];
const sampleDetail = (): DomainConversationDetail => ({
    key: { ...key }, savedAt: 100, quality: { status: 'complete' }, assets: sampleAssets(),
    messages: [{ role: 'assistant', id: 'm1', model: 'gemini', timestamp: 123, content: sampleBlocks(),
        citations: [{ id: 'source', title: 'reference', url: 'https://example.test' }],
        attachmentIds: ['image', 'file'], reasoning: [{ type: 'paragraph', children: [{ type: 'text', text: 'thought' }] }] }],
});

test('typed Domain equality ignores object insertion order but checks all Index fields', () => {
    const a = sampleIndex();
    const b: DomainConversationIndex = { activityAt: 25, updatedAt: 20, createdAt: 10,
        titleSource: 'provider', title: 'Hi', key: { conversationId: key.conversationId, accountId: key.accountId } };
    assert.equal(equal.index(a, b), true);
    assert.equal(equal.index(a, { ...b, activityAt: 26 }), false);
    assert.equal(equal.index(a, { ...b, key: { ...key, conversationId: 'other' } }), false);
    assert.equal(equal.index(a, { ...b, title: undefined }), false, 'present optional field differs from nonempty value');
    assert.equal(equal.index(a, null), false);
    assert.equal(equal.index(null, undefined), false);
});

test('typed Domain equality deeply compares every AST branch and resource metadata', () => {
    const a = sampleDetail();
    const b = structuredClone(a);
    const reverseKeys = sampleDetail();
    reverseKeys.messages[0] = { content: reverseKeys.messages[0].content, reasoning: reverseKeys.messages[0].reasoning,
        attachmentIds: reverseKeys.messages[0].attachmentIds, citations: reverseKeys.messages[0].citations,
        timestamp: reverseKeys.messages[0].timestamp, model: reverseKeys.messages[0].model,
        id: reverseKeys.messages[0].id, role: reverseKeys.messages[0].role };
    reverseKeys.assets[0] = { sourceUri: reverseKeys.assets[0].sourceUri, generation: reverseKeys.assets[0].generation,
        byteLength: reverseKeys.assets[0].byteLength, mediaType: reverseKeys.assets[0].mediaType,
        name: reverseKeys.assets[0].name, kind: reverseKeys.assets[0].kind, id: reverseKeys.assets[0].id };
    assert.equal(equal.detail(a, b), true);
    assert.equal(equal.material(a, b), true);
    // The reversed object explicitly includes the same optional fields, preserving its exact own-key set.
    assert.equal(equal.detail(a, reverseKeys), true);
    const changed = structuredClone(a);
    changed.messages[0].content[5] = { type: 'list', ordered: false, items: [] };
    assert.equal(equal.detail(a, changed), false);
    const changedAssets = structuredClone(a);
    changedAssets.assets[0].generation!.imageOrdinal = 1;
    assert.equal(equal.material(a, changedAssets), false);
    const changedCitation = structuredClone(a);
    changedCitation.messages[0].citations![0].title = 'other';
    assert.equal(equal.material(a, changedCitation), false);
    const changedReasoning = structuredClone(a);
    changedReasoning.messages[0].reasoning![0] = { type: 'paragraph', children: [{ type: 'text', text: 'edited' }] };
    assert.equal(equal.material(a, changedReasoning), false);
    assert.equal(equal.detail(a, null), false);
});

test('typed equality keeps source-version-only commits separate from material Live Save changes', () => {
    const a = sampleDetail(), b = structuredClone(a);
    b.savedAt = 101;
    assert.equal(equal.material(a, b), true);
    assert.equal(equal.detail(a, b), false);
    b.quality.status = 'partial';
    assert.equal(equal.material(a, b), false);
});

test('typed equality distinguishes array order and optional field presence', () => {
    const a = sampleDetail(), b = structuredClone(a);
    b.messages[0].attachmentIds!.reverse();
    assert.equal(equal.material(a, b), false);
    const c = structuredClone(a);
    c.messages[0].model = undefined;
    assert.equal(equal.material(a, c), false);
    const d = structuredClone(a);
    delete d.messages[0].model;
    assert.equal(equal.material(a, d), false);
    const e = structuredClone(a);
    e.messages[0].content = e.messages[0].content.slice().reverse();
    assert.equal(equal.material(a, e), false);
});

test('Domain equality does not confuse changed nested AST node variants', () => {
    const body = sampleDetail();
    for (const replacement of [
        { type: 'text' as const, text: 'new' },
        { type: 'lineBreak' as const, kind: 'soft' as const },
        { type: 'inlineMath' as const, source: 'z' },
    ]) {
        const altered = structuredClone(body);
        const first = altered.messages[0].content[0];
        if (first.type !== 'paragraph') throw new Error('bad fixture');
        first.children[0] = replacement;
        assert.equal(equal.material(body, altered), false);
    }
});

test('source turn completion changes are persisted and notify Live Save even with unchanged text', () => {
    const a = sampleDetail(), b = structuredClone(a);
    a.quality.sourceTurn = 'unfinished';
    b.quality.sourceTurn = 'finished';
    assert.equal(equal.detail(a, b), false);
    assert.equal(equal.material(a, b), false);
});
});

__suiteDescribe("l2_p1_boundary_narrowing", () => {
const key = { accountId: ACCOUNT_UUID, conversationId: 'p1-check' };

test('L2 key decoding validates unknown fields before creating a typed identity', () => {
    const raw = { ...key };
    assert.deepEqual(readConversationKey(raw), key);
    assert.deepEqual(raw, key, 'restoring a key must not mutate source input');
    assert.deepEqual(conversationKey(key.accountId, key.conversationId), key);

    const rejected: readonly unknown[] = [
        undefined, null, 0, '', [], {}, Object.create(null),
        { conversationId: key.conversationId },
        { accountId: key.accountId },
        { accountId: 12, conversationId: key.conversationId },
        { accountId: key.accountId, conversationId: 12 },
        { accountId: 'invalid-uuid', conversationId: key.conversationId },
        { ...key, conversationId: '' },
        { ...key, conversationId: ' surrounding ' },
        { ...key, extra: true },
    ];
    for (const value of rejected) {
        assert.throws(() => readConversationKey(value), /Invalid conversation key/);
    }
});

test('L2 index recovery narrows source metadata with exact optional field semantics', () => {
    const raw = { key, title: 'User title', titleSource: 'user', createdAt: 0, updatedAt: -2, activityAt: 8 };
    const before = structuredClone(raw);
    const index = restoreConversationIndex(raw);
    assert.deepEqual(index, raw);
    assert.deepEqual(raw, before);

    const empty = restoreConversationIndex({ key, title: undefined, titleSource: undefined,
        createdAt: undefined, updatedAt: undefined, activityAt: undefined });
    assert.deepEqual(empty, { key }, 'undefined optional fields remain absent in Domain');
    assert.equal(Object.hasOwn(empty, 'createdAt'), false);
    assert.equal(Object.hasOwn(empty, 'title'), false);

    const rejected: readonly unknown[] = [
        undefined, null, 42, [], {}, { key: 'not-a-key' },
        { key, unexpectedField: 1 },
        { key, title: 'Unpaired' },
        { key, titleSource: 'provider' },
        { key, title: '' , titleSource: 'provider' },
        { key, title: ' padded ', titleSource: 'provider' },
        { key, title: 42, titleSource: 'provider' },
        { key, title: 'Valid', titleSource: 'rpc' },
        { key, createdAt: null }, { key, createdAt: NaN },
        { key, updatedAt: 1.5 }, { key, updatedAt: Infinity },
        { key, activityAt: '8' }, { key, activityAt: Number.MAX_SAFE_INTEGER + 1 },
    ];
    for (const value of rejected) assert.throws(() => restoreConversationIndex(value), TypeError);
});

test('L2 index merging derives coupled title fields and timestamps without non-null assertions', () => {
    const initial = makeConversationIndex({ key, title: 'Provider title', titleSource: 'provider',
        createdAt: 20, updatedAt: 100 });
    const newer = makeConversationIndex({ key, title: 'User title', titleSource: 'user',
        createdAt: 10, updatedAt: 80, activityAt: 120 });
    const result = mergeConversationIndex(initial, newer);
    assert.deepEqual(result, { key, title: 'User title', titleSource: 'user',
        createdAt: 10, updatedAt: 100, activityAt: 120 });

    const empty = mergeConversationIndex(restoreConversationIndex({ key }),
        restoreConversationIndex({ key, createdAt: 10 }));
    assert.deepEqual(empty, { key, createdAt: 10 }, 'absent titles never create undefined title provenance');
});

test('L2 account decoding checks raw object shape and required fields before constructing Account', () => {
    const verified = { id: ACCOUNT_UUID, providerId: 'gemini', providerAccountId: 'gaia-id',
        email: 'person@example.test', displayName: 'Person' };
    const before = structuredClone(verified);
    assert.deepEqual(readAccount(verified), verified);
    const { id: _accountId, ...parameters } = verified;
    assert.deepEqual(readAccountParameters(parameters), parameters);
    assert.deepEqual(verified, before);

    assert.deepEqual(readAccount({ ...verified, providerAccountId: 'default' }), {
        id: ACCOUNT_UUID, providerId: 'gemini', providerAccountId: 'default',
    }, 'default-account display information is not persisted');
    assert.deepEqual(readAccountRegistry([verified]), [verified]);

    const rejected: readonly unknown[] = [
        undefined, null, 42, false, '', [], {},
        { providerId: 'gemini', providerAccountId: 'id', extra: true },
        { providerId: 1, providerAccountId: 'id' },
        { providerId: 'gemini', providerAccountId: 1 },
        { providerId: ' gemini ', providerAccountId: 'id' },
        { providerId: 'gemini', providerAccountId: 'id', email: null },
        { providerId: 'gemini', providerAccountId: 'id', displayName: ' padded ' },
    ];
    for (const value of rejected) assert.throws(() => readAccountParameters(value), TypeError);
    assert.throws(() => readAccount({ ...verified, id: 'invalid-uuid' }), /Invalid local account UUID/);
    assert.throws(() => readAccountRegistry([verified, verified]), /Duplicate account identity/);
});
});

__suiteDescribe("l2_typed_citation_closure", () => {
const citation = (citationId: string) => ({ type: 'citationRef' as const, citationId });
const paragraph = (citationId: string): BlockNode => ({
    type: 'paragraph',
    children: [{ type: 'strong', children: [{ type: 'emphasis', children: [{ type: 'strikethrough', children: [citation(citationId)] }] }] }],
});
const detail = (content: BlockNode[], reasoning?: BlockNode[]): Pick<DomainConversationDetail, 'assets' | 'messages' | 'quality'> => ({
    assets: [{ id: 'image', kind: 'image' }, { id: 'file', kind: 'file' }],
    quality: { status: 'complete' },
    messages: [{ role: 'assistant', citations: [{ id: 'source' }], content, ...(reasoning ? { reasoning } : {}) }],
});

test('typed citation closure traverses every legal inline/container position without mutation', () => {
    const blocks: BlockNode[] = [
        paragraph('source'),
        { type: 'heading', level: 2, children: [{ type: 'link', href: 'https://example.test', children: [citation('source')] }] },
        { type: 'list', ordered: false, items: [{ blocks: [{ type: 'quote', blocks: [paragraph('source')] }] }] },
        { type: 'table',
            caption: [citation('source')],
            headerRows: [{ cells: [{ children: [citation('source')] }] }],
            rows: [{ cells: [{ children: [citation('source')] }] }],
        },
        { type: 'image', assetId: 'image', caption: [citation('source')] },
        { type: 'file', assetId: 'file', description: [citation('source')] },
        { type: 'unknown', sourceType: 'future', text: 'preserve' },
    ];
    const conversation = detail(blocks, [{ type: 'quote', blocks: [paragraph('source')] }]);
    const snapshot = structuredClone(conversation);
    assert.doesNotThrow(() => assertDomainClosure(conversation));
    assert.deepEqual(conversation, snapshot);
});

test('typed citation closure rejects missing citations in every nested container', () => {
    const bad: BlockNode[] = [
        paragraph('missing'),
        { type: 'heading', level: 2, children: [citation('missing')] },
        { type: 'list', ordered: false, items: [{ blocks: [{ type: 'quote', blocks: [paragraph('missing')] }] }] },
        { type: 'table', caption: [citation('missing')], rows: [] },
        { type: 'table', headerRows: [{ cells: [{ children: [citation('missing')] }] }], rows: [] },
        { type: 'table', rows: [{ cells: [{ children: [citation('missing')] }] }] },
        { type: 'image', assetId: 'image', caption: [citation('missing')] },
        { type: 'file', assetId: 'file', description: [citation('missing')] },
    ];
    for (const [index, block] of bad.entries()) {
        assert.throws(() => assertDomainClosure(detail([block])), /Unregistered Domain citation/, `body case ${index}`);
        assert.throws(() => assertDomainClosure(detail([], [block])), /Unregistered Domain citation/, `reasoning case ${index}`);
    }
});

test('citation registries stay message-local with identical IDs', () => {
    const conversation = detail([paragraph('source')]);
    conversation.messages.push({ role: 'assistant', content: [paragraph('source')] });
    assert.throws(() => assertDomainClosure(conversation), /Unregistered Domain citation.*messages\[1\]/);
    conversation.messages[1].citations = [{ id: 'source' }];
    assert.doesNotThrow(() => assertDomainClosure(conversation));
});

test('asset closure rejects missing assets across all body and reasoning containers', () => {
    const image: BlockNode = { type: 'image', assetId: 'missing' };
    const paragraph: BlockNode = { type: 'paragraph', children: [{ type: 'link', href: 'https://example.test', children: [image] }] };
    const blocks: BlockNode[] = [
        image, { type: 'file', assetId: 'missing' }, paragraph,
        { type: 'heading', level: 1, children: [image] },
        { type: 'list', ordered: false, items: [{ blocks: [{ type: 'quote', blocks: [paragraph] }] }] },
        { type: 'table', caption: [image], rows: [] },
        { type: 'table', headerRows: [{ cells: [{ children: [image] }] }], rows: [] },
        { type: 'table', rows: [{ cells: [{ children: [image] }] }] },
        { type: 'image', assetId: 'image', caption: [image] },
        { type: 'file', assetId: 'file', description: [image] },
    ];
    for (const block of blocks) {
        assert.throws(() => assertDomainClosure(detail([block])), /Unregistered Domain asset 'missing'/);
        assert.throws(() => assertDomainClosure(detail([], [block])), /Unregistered Domain asset 'missing'/);
    }
});
});
