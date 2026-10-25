import { getDetail, listIndexes } from '../src/l3a/storageService.js';
import { getOrCreateAccount } from '../src/runtime/api/accountRegistry.js';
import { GrokProvider } from '../src/l1/client/grok/grokProvider.js';
import { indexStorage } from './helpers/indexStorage.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGrokConversation } from '../src/l1/parsers/grok/parseConversation.js';
import { parseGrokList } from '../src/l1/parsers/grok/parseList.js';
import { grokAccount } from '../src/l1/parsers/grok/source.js';
import { preprocessGrokMarkdown } from '../src/l1/parsers/grok/markdownCompatibility.js';
import { readGrokSource, validGrokRead } from '../src/l1/client/grok/grokSource.js';
import { grokRequest } from '../src/l1/sniffer/grok/observation.js';
import { contentComposer } from '../src/l3b/compose/composeContent.js';
import { renderDocumentMarkdown } from '../src/l4/format/markdown/renderMarkdown.js';
import { renderDocumentHtml } from '../src/l4/format/html/renderHtml.js';
const fixture = () => JSON.parse(readFileSync(__dirname + '/fixtures/providers/grokDetail.json', 'utf8')) as {
    id: string; metadata: { conversation: { conversationId: string; title: string; modifyTime: string } };
    tree: { responseNodes: { responseId: string; parentResponseId: string; sender: string }[]; inflightResponses: unknown[] };
    bodies: { responses: { responseId: string; parentResponseId: string; message: string; partial: boolean; generatedImageUrls: string[] }[] };
};

test('observed Grok tree and batch payload preserve text, table, Python and TeX in Markdown and HTML', () => {
    const f = fixture(), copy = structuredClone(f);
    const parsed = parseGrokConversation(f.metadata, f.tree, f.bodies, f.id);
    assert.deepEqual(f, copy);
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    assert.deepEqual(parsed.conversation.detail.messages.map(m => m.role), ['user', 'assistant']);
    const answer = parsed.conversation.detail.messages[1];
    assert.equal(answer.model, 'grok-3');
    assert.ok(answer.content.some(b => b.type === 'table'));
    assert.ok(answer.content.some(b => b.type === 'code' && b.code.includes('import csv, json')));
    assert.ok(JSON.stringify(answer.content).includes('E = mc^2'));
    assert.ok(answer.reasoning?.length);
    const compose = contentComposer(new Map(), id => ({ id, label: id }));
    const doc = { title: f.metadata.conversation.title, metadata: { id: f.id, provider: 'grok' },
        messages: parsed.conversation.detail.messages.map(m => ({ role: m.role, blocks: compose(m.content) })) };
    const md = renderDocumentMarkdown(doc, {}), html = renderDocumentHtml(doc, {}).html;
    for (const expected of ['Feature', 'Hierarchical, nested', 'import csv, json', 'E = mc^2']) {
        assert.ok(md.includes(expected), 'Markdown missing ' + expected);
        assert.ok(html.includes(expected), 'HTML missing ' + expected);
    }
});

test('Grok never marks missing bodies, inflight replies, unsupported media or branching as complete', () => {
    for (const mutate of [
        (f: ReturnType<typeof fixture>) => { f.bodies.responses.pop(); },
        (f: ReturnType<typeof fixture>) => { f.tree.inflightResponses.push({}); },
        (f: ReturnType<typeof fixture>) => { f.bodies.responses[1].partial = true; },
        (f: ReturnType<typeof fixture>) => { Object.assign(f.bodies.responses[1], { toolResponses: [{ tool: 'unknown-tool' }] }); },
        (f: ReturnType<typeof fixture>) => { f.tree.responseNodes[1].parentResponseId = '11111111-1111-4111-8111-111111111111';
            f.bodies.responses[1].parentResponseId = f.tree.responseNodes[1].parentResponseId; },
    ]) {
        const f = fixture(); mutate(f);
        assert.equal(parseGrokConversation(f.metadata, f.tree, f.bodies, f.id).conversation.detail.quality.status, 'partial');
    }
    const f = fixture(); f.metadata.conversation.conversationId = 'different';
    assert.throws(() => parseGrokConversation(f.metadata, f.tree, f.bodies, f.id), /identity/);
});

test('Grok rejects duplicate, foreign and misbound response bodies', () => {
    const f = fixture(); f.bodies.responses.push(f.bodies.responses[0]);
    assert.throws(() => parseGrokConversation(f.metadata, f.tree, f.bodies, f.id), /Unexpected/);
    const g = fixture(); g.bodies.responses[1].parentResponseId = g.bodies.responses[1].responseId;
    assert.throws(() => parseGrokConversation(g.metadata, g.tree, g.bodies, g.id), /binding/);
});

test('Grok list uses native activity and cursor and rejects invalid records', () => {
    const f = fixture(); const row = { ...f.metadata.conversation, createTime: '2026-10-25T05:10:31.525Z' };
    const parsed = parseGrokList({ conversations: [row], nextPageToken: f.id });
    assert.equal(parsed.keys[0].time, Date.parse(row.modifyTime));
    assert.equal(parsed.nextCursor, f.id);
    assert.equal(parseGrokList({ conversations: [] }).nextCursor, null);
    assert.throws(() => parseGrokList({ conversations: [row, row] }), /duplicate/);
    assert.throws(() => parseGrokList({ conversations: [{ ...row, modifyTime: null }] }), /timestamp/);
    assert.throws(() => parseGrokList({ conversations: [], nextPageToken: '../foreign' }), /token/);
});

test('Grok account comes from userId and TeX normalization preserves code literals', () => {
    const f = fixture();
    assert.equal(grokAccount({ userId: f.id, email: 'test@example.com', givenName: 'Test' }).providerAccountId, f.id);
    assert.throws(() => grokAccount({ email: 'test@example.com' }), /identity/);
    const source = '```python\nx = "\\(literal\\)"\n```\n`\\(code\\)`\n\\(a+b\\)';
    const output = preprocessGrokMarkdown(source);
    assert.ok(output.includes('x = "\\(literal\\)"'));
    assert.ok(output.includes('`\\(code\\)`'));
    assert.ok(output.endsWith('$a+b$'));
});

test('Grok source allowlist rejects writes and extension injection serializes discovery safely', async () => {
    const f = fixture();
    assert.equal(validGrokRead('/rest/app-chat/conversations/new'), false);
    assert.equal(validGrokRead('https://evil.test/rest/auth/get-user'), false);
    assert.equal(validGrokRead('/rest/app-chat/conversations/' + f.id + '/load-responses', { responseIds: [f.tree.responseNodes[0].responseId] }), true);
    assert.equal(grokRequest('https://grok.com.evil.test/rest/app-chat/conversations', 'GET'), null);
    assert.equal(grokRequest('https://grok.com/rest/app-chat/conversations/' + f.id, 'DELETE')?.kind, 'delete');
    assert.equal(grokRequest('https://grok.com/rest/app-chat/conversations?pageSize=60', 'GET')?.kind, 'list');
    const original = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
        permissions: { contains: async () => true }, tabs: { query: async () => [{ id: 1 }] },
        scripting: { executeScript: async (injection: { args: unknown[] }) => {
            assert.ok(injection.args.every(v => v !== undefined));
            return [{ result: { userId: f.id } }];
        } },
    } });
    try { await readGrokSource('/rest/auth/get-user'); }
    finally { if (original) Object.defineProperty(globalThis, 'chrome', original); else Reflect.deleteProperty(globalThis, 'chrome'); }
});

test('Grok provider commits verified source pages and detail, rejects account mismatch, repeated cursor and cancellation', async () => {




    const env = indexStorage();
    try {
        const f = fixture(), account = await getOrCreateAccount('grok', '11111111-1111-4111-8111-111111111111');
        const calls: string[] = [];
        const provider = new GrokProvider({ images: async () => [], apiRead: async (path, owner, body) => {
            assert.equal(owner, account.providerAccountId); calls.push(path);
            if (path === '/rest/auth/get-user') return { userId: account.providerAccountId };
            if (path.includes('pageSize')) return { conversations: [f.metadata.conversation] };
            if (path.includes('conversations_v2')) return f.metadata;
            if (path.endsWith('response-node?includeThreads=true')) return f.tree;
            assert.deepEqual(body?.responseIds.sort(), f.tree.responseNodes.map(n => n.responseId).sort());
            return f.bodies;
        } });
        assert.equal((await provider.checkReadiness(account.id)).ready, true);
        assert.equal(await provider.listConversations({ accountId: account.id, streamId: 'recent' }), 'source_end');
        assert.equal((await listIndexes(account.id)).length, 1);
        await provider.fetchConversationDetail(account.id, f.id);
        assert.equal((await getDetail({ accountId: account.id, conversationId: f.id }))?.quality.status, 'complete');
        assert.ok(calls.filter(p => p.endsWith('response-node?includeThreads=true')).length === 2);
        const abort = new AbortController(); abort.abort();
        await assert.rejects(provider.fetchConversationDetail(account.id, f.id, abort.signal), { name: 'AbortError' });
        const cycling = new GrokProvider({ images: async () => [], apiRead: async () => ({ conversations: [f.metadata.conversation], nextPageToken: f.id }) });
        await assert.rejects(cycling.listConversations({ accountId: account.id, streamId: 'recent' }), /Unverified/);
        let treeReads = 0;
        const changing = new GrokProvider({ images: async () => [], apiRead: async (path) => {
            if (path.includes('conversations_v2')) return f.metadata;
            if (path.endsWith('load-responses')) return f.bodies;
            return treeReads++ % 2 ? f.tree : { ...f.tree, inflightResponses: [{}] };
        } });
        await assert.rejects(changing.fetchConversationDetail(account.id, f.id), /changed/);
        assert.equal(provider.matchesUrl('https://grok.com.evil.test/'), false);
    } finally { env.restore(); }
});

test('vendored Loominary parser resolves citation cards, images and files into the shared Domain', () => {
    const f = fixture();
    Object.assign(f.bodies.responses[1], {
        message: 'Read <grok:render card_id="source-card">citation</grok:render> and see image.',
        cardAttachmentsJson: [JSON.stringify({ cardType: 'citation_card', id: 'source-card', url: 'https://example.com/reference' })],
        webSearchResults: [{ url: 'https://example.com/reference', title: 'Primary source' }],
        imageAttachments: [{ fileName: 'diagram.png', mimeType: 'image/png', url: 'https://assets.grok.com/diagram.png' }],
        fileAttachments: [{ fileName: 'report.csv', mimeType: 'text/csv', size: 10, url: 'https://assets.grok.com/report.csv' }],
    });
    const parsed = parseGrokConversation(f.metadata, f.tree, f.bodies, f.id);
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    const answer = parsed.conversation.detail.messages[1];
    assert.equal(answer.citations?.[0].title, 'Primary source');
    assert.ok(JSON.stringify(answer.content).includes('https://example.com/reference'));
    assert.ok(!JSON.stringify(answer.content).includes('<grok:render'));
    assert.equal(parsed.conversation.detail.assets.length, 2);
    assert.equal(answer.attachmentIds?.length, 2);
    assert.ok(parsed.conversation.detail.assets.every(asset => parsed.acquisitionHints[asset.id]?.url));
    assert.ok(!answer.content.some(block => block.type === 'file')); // Composer owns attachments.
});

test('Loominary captured image bytes stay in task hints and missing file locators remain partial', () => {
    const f = fixture();
    Object.assign(f.bodies.responses[1], { capturedImages: [{ source: 'ai_generated', format: 'image/png', data: 'aGVsbG8=', size: 5,
        original_src: 'https://assets.grok.com/generated.png' }] });
    const parsed = parseGrokConversation(f.metadata, f.tree, f.bodies, f.id);
    assert.equal(parsed.conversation.detail.assets.length, 1);
    assert.ok(!JSON.stringify(parsed.conversation.detail).includes('aGVsbG8='));
    assert.ok(Object.values(parsed.acquisitionHints).some(hint => hint.dataBase64?.includes('aGVsbG8=')));
    Object.assign(f.bodies.responses[1], { fileAttachments: [{ fileName: 'missing.pdf', mimeType: 'application/pdf', size: 5 }] });
    assert.equal(parseGrokConversation(f.metadata, f.tree, f.bodies, f.id).conversation.detail.quality.status, 'partial');
});

test('current live Grok generated-image cards reuse upstream media parsing without needing an open DOM', () => {
    const f = JSON.parse(readFileSync(__dirname + '/fixtures/providers/grokImageDetail.json', 'utf8')) as ReturnType<typeof fixture>;
    const parsed = parseGrokConversation(f.metadata, f.tree, f.bodies, f.id);
    assert.equal(parsed.conversation.detail.quality.status, 'complete', JSON.stringify(parsed.diagnostics));
    assert.equal(parsed.conversation.detail.messages.length, 6);
    const imageReply = parsed.conversation.detail.messages[5];
    assert.equal(imageReply.model, 'imagine_x_1');
    assert.deepEqual(imageReply.content, []); // Render the owned attachment once, without upstream placeholders.
    assert.equal(parsed.conversation.detail.assets.length, 1);
    const asset = parsed.conversation.detail.assets[0];
    assert.equal(asset.kind, 'image');
    assert.ok(asset.sourceUri?.startsWith('https://assets.grok.com/'));
    assert.ok(asset.generation?.prompt?.includes('origami fox'));
    assert.equal(imageReply.attachmentIds?.[0], asset.id);
    assert.equal(parsed.acquisitionHints[asset.id].url, asset.sourceUri);
    assert.ok(!JSON.stringify(imageReply.content).includes('<grok:render'));
});

test('signed Grok resource URLs remain acquisition hints and never enter durable Domain', () => {
    const f = fixture();
    Object.assign(f.bodies.responses[1], { imageAttachments: [{ url: 'https://assets.grok.com/image.png?token=temporary', mimeType: 'image/png' }] });
    const parsed = parseGrokConversation(f.metadata, f.tree, f.bodies, f.id);
    assert.equal(parsed.conversation.detail.assets[0].sourceUri, undefined);
    assert.ok(!JSON.stringify(parsed.conversation).includes('token=temporary'));
    assert.ok(Object.values(parsed.acquisitionHints).some(hint => hint.url?.includes('token=temporary')));
});

test('Grok UUID file metadata resolves through asset keys instead of invented URL paths', () => {
    const f = fixture(), id = '22222222-2222-4222-8222-222222222222';
    Object.assign(f.bodies.responses[1], { fileAttachments: [id],
        fileAttachmentsMetadata: [{ fileMetadataId: id, fileUri: id, fileName: 'report.csv', fileMimeType: 'text/csv' }],
        fileAttachmentAssetMetadata: [{ assetId: id, key: 'users/example/report.csv', name: 'report.csv', mimeType: 'text/csv' }] });
    const parsed = parseGrokConversation(f.metadata, f.tree, f.bodies, f.id);
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    assert.equal(parsed.conversation.detail.assets.length, 1);
    assert.equal(parsed.conversation.detail.assets[0].sourceUri, 'https://assets.grok.com/users/example/report.csv');
});

test('upstream citation titles preserve literal backslashes and brackets without Markdown injection', () => {
    const f = fixture(), title = String.raw`source \[literal](https://untrusted.example)`;
    Object.assign(f.bodies.responses[1], {
        message: '<grok:render card_id="quoted">citation</grok:render>',
        cardAttachmentsJson: [JSON.stringify({ cardType: 'citation_card', id: 'quoted', url: 'https://example.com/source' })],
        webSearchResults: [{ url: 'https://example.com/source', title }],
    });
    const parsed = parseGrokConversation(f.metadata, f.tree, f.bodies, f.id);
    const content = parsed.conversation.detail.messages[1].content;
    assert.deepEqual(content, [{ type: 'paragraph', children: [{ type: 'link',
        href: 'https://example.com/source', children: [{ type: 'text', text: title }] }] }]);
    assert.equal(parsed.conversation.detail.messages[1].citations?.[0].title, title);
});
