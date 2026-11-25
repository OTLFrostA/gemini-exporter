import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseClaudeConversation } from '../src/l1/parsers/claude/parseConversation.js';
import { parseChatGPTConversation } from '../src/l1/parsers/chatgpt/parseConversation.js';
import type { ChatGPTApiConversationWithId, ChatGPTConversationNode } from '../src/l1/parsers/chatgpt/chatgptTypes.js';
import { parseGeminiTakeoutConversation } from '../src/l1/parsers/gemini/takeout/parseConversation.js';
import { validateParserDomain } from '../src/l2/runtimeValidation.js';
import { assertDomainClosure } from '../src/l2/closure.js';
import type { Account } from '../src/l2/accountRegistry.js';
import { composeDomainDocument } from '../src/l3b/compose/composeDomainDocument.js';
import { renderDocumentMarkdown } from '../src/l4/format/markdown/renderMarkdown.js';
import { renderDocumentHtml } from '../src/l4/format/html/renderHtml.js';
import { serializeDomainJson, JSON_ARCHIVE_VERSION } from '../src/l4/format/json/serializeDomainJson.js';
import { renderDocumentTypstCore } from '../src/l4/format/typst/renderTypstCore.js';
import { renderDocumentDocx } from '../src/l4/format/docx/renderDocx.js';
import type { DomainConversationWithDetail } from '../src/l2/conversation.js';
import { fixtureAccount } from './helpers/domainFixture.js';

const JSZip = require('../lib/jszip.min.js');
const FIXTURE_DIR = join(__dirname, 'fixtures', 'provider', 'realistic');
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

async function verifyFiveFormatPipeline(
    conversation: DomainConversationWithDetail,
    account: Account,
    expectedSnippets: string[],
    forbiddenSnippets: string[] = [],
): Promise<void> {
    assertDomainClosure(conversation.detail);
    const resources = {};
    const doc = composeDomainDocument(conversation, account);
    const md = renderDocumentMarkdown(doc, resources);
    const { html } = renderDocumentHtml(doc, resources);
    const jsonText = serializeDomainJson(conversation, account, resources);
    const json = JSON.parse(jsonText);
    const typst = renderDocumentTypstCore(doc, resources, { locale: 'en' });
    const docx = await renderDocumentDocx(doc, resources, new Map());

    assert.equal(json.version, JSON_ARCHIVE_VERSION);
    assert.equal(docx[0], 0x50);
    assert.equal(docx[1], 0x4b);
    assert.equal(typst.messages.length, conversation.detail.messages.length);
    assert.ok(html.includes('<!DOCTYPE html>') || html.includes('<html'));

    const docxZip = await JSZip.loadAsync(docx);
    const docxXml = await docxZip.file('word/document.xml')?.async('string');
    assert.ok(docxXml && docxXml.length > 0);
    const typstJson = JSON.stringify(typst);

    for (const snippet of expectedSnippets) {
        assert.ok(md.includes(snippet), `Markdown missing expected snippet: ${snippet}`);
        assert.ok(html.includes(snippet), `HTML missing expected snippet: ${snippet}`);
        assert.ok(jsonText.includes(snippet), `JSON missing expected snippet: ${snippet}`);
        assert.ok(typstJson.includes(snippet), `Typst IR missing expected snippet: ${snippet}`);
        assert.ok(docxXml.includes(snippet), `DOCX XML missing expected snippet: ${snippet}`);
    }
    for (const forbidden of forbiddenSnippets) {
        assert.equal(md.includes(forbidden), false, `Markdown leaked forbidden snippet: ${forbidden}`);
        assert.equal(html.includes(forbidden), false, `HTML leaked forbidden snippet: ${forbidden}`);
        assert.equal(jsonText.includes(forbidden), false, `JSON leaked forbidden snippet: ${forbidden}`);
        assert.equal(typstJson.includes(forbidden), false, `Typst IR leaked forbidden snippet: ${forbidden}`);
        assert.equal(docxXml.includes(forbidden), false, `DOCX XML leaked forbidden snippet: ${forbidden}`);
    }
}

test('Realistic multi-turn Claude wire fixture: active branch, thinking + redacted_thinking, tool_use/tool_result, inline image', async () => {
    const raw = JSON.parse(readFileSync(join(FIXTURE_DIR, 'claude_multiturn_wire.json'), 'utf8'));
    const parsed = parseClaudeConversation(raw, raw.uuid);
    const account = fixtureAccount('claude');
    const key = { accountId: account.id, conversationId: parsed.conversationId };
    const domain = validateParserDomain({
        index: { key, ...parsed.conversation.index },
        detail: parsed.conversation.detail,
    });

    // Active branch has 4 messages (2 user + 2 assistant); abandoned sibling branch excluded
    assert.equal(domain.detail.messages.length, 4);
    assert.equal(domain.detail.quality.status, 'partial');
    assert.ok(parsed.diagnostics.some(d => d.code === 'claude.content.redacted_thinking'));
    assert.ok(domain.detail.messages[1].reasoning && domain.detail.messages[1].reasoning.length > 0);
    assert.ok(domain.detail.assets.some(a => a.kind === 'image' && a.sourceUri === 'https://claude.ai/api/files/raft-quorum.png'));

    await verifyFiveFormatPipeline(
        domain,
        account,
        ['Snapshot threshold: 10000 entries', 'should_compact', 'quorum'],
        ['ABANDONED_BRANCH_SHOULD_NOT_EXPORT'],
    );
});

test('Realistic multi-turn ChatGPT wire fixture: active branch, thoughts, image asset_pointer, code & math', async () => {
    const raw = JSON.parse(readFileSync(join(FIXTURE_DIR, 'chatgpt_multiturn_wire.json'), 'utf8')) as {
        id: string;
        title: string;
        create_time: number;
        update_time: number;
        current_node: string;
        mapping: Record<string, ChatGPTConversationNode>;
    };
    const conversation: ChatGPTApiConversationWithId = {
        id: raw.id,
        title: raw.title,
        is_archived: false,
        createdAtMs: raw.create_time * 1000,
        updatedAtMs: raw.update_time * 1000,
        current_node: raw.current_node,
        mapping: new Map(Object.entries(raw.mapping)),
    };
    const account = fixtureAccount('chatgpt');
    const parsed = parseChatGPTConversation({
        source: 'api',
        account,
        conversation,
        assetsByNode: new Map([
            ['node-u1', {
                nodeId: 'node-u1',
                images: [{
                    pointer: 'file-service://file-waveguide-01',
                    assetId: 'chatgpt-img-waveguide-01',
                    dataBase64: TINY_PNG_B64,
                    mediaType: 'image/png',
                    fileName: 'waveguide.png',
                    byteLength: 68,
                }],
                files: [],
            }],
        ]),
    });
    const key = { accountId: account.id, conversationId: parsed.conversationId };
    const domain = validateParserDomain({
        index: { key, ...parsed.conversation.index },
        detail: parsed.conversation.detail,
    });

    assert.equal(domain.detail.messages.length, 4);
    assert.equal(domain.detail.quality.status, 'complete');
    assert.ok(domain.detail.assets.some(a => a.id === 'chatgpt-img-waveguide-01' && a.kind === 'image'));
    assert.ok(domain.detail.messages[1].reasoning && domain.detail.messages[1].reasoning.length > 0);

    await verifyFiveFormatPipeline(
        domain,
        account,
        ['te10_cutoff_ghz', '6.557 GHz', 'WR-90'],
        ['ABANDONED_CHATGPT_BRANCH_MARKER'],
    );
});

test('Realistic multi-turn Gemini Takeout HTML fixture: chronological ordering, table with code/math, archive image resolution', async () => {
    const htmlText = readFileSync(join(FIXTURE_DIR, 'gemini_takeout_multiturn.html'), 'utf8');
    const account = fixtureAccount('gemini');
    const archiveEntry = {
        _data: { uncompressedSize: 68 },
        async: async () => TINY_PNG_B64,
    };
    const parsed = parseGeminiTakeoutConversation(
        {
            htmlText,
            activityPath: 'Takeout/My Activity/Gemini Apps/MyActivity.html',
            archiveFiles: {
                'Takeout/My Activity/Gemini Apps/images/complexity_curve.png': archiveEntry,
            },
        },
        { account, providerId: 'gemini' },
    );
    const key = { accountId: account.id, conversationId: parsed.conversationId };
    const domain = validateParserDomain({
        index: { key, ...parsed.conversation.index },
        detail: parsed.conversation.detail,
    });

    // Two chronological turns (oldest first -> binarySearch turn before complexity table turn)
    assert.equal(domain.detail.messages.length, 4);
    assert.equal(domain.detail.quality.status, 'partial');
    assert.ok(domain.detail.assets.some(a => a.kind === 'image' && a.name === 'complexity_curve.png'));
    const imageAsset = domain.detail.assets.find(a => a.kind === 'image')!;
    assert.equal(parsed.archiveResources[imageAsset.id]?.entry, archiveEntry);

    await verifyFiveFormatPipeline(domain, account, ['binarySearch', 'quicksort', 'mergesort']);
});
