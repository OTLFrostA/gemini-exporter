/** Domain/composer contracts, including the shared title authority rules. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTitle, titleAuthorityRank, TITLE_AUTHORITY_RANK } from '../src/core/domain/titleAuthority.js';
import { assertDomainClosure } from '../src/core/domain/closure.js';
import { parseProviderConversation } from '../src/core/provider/conversationParser.js';
import { composeDomainDocument } from '../src/core/export/document/composeDomainDocument.js';
import { renderDocumentHtml } from '../src/core/export/document/renderHtml.js';
import { renderDocumentMarkdown } from '../src/core/export/document/renderMarkdown.js';
import { renderDocumentTypst } from '../src/core/export/document/renderTypst.js';
import { normalizeArchiveResourceName } from '../src/core/export/assets/archivePath.js';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
function domain(): DomainConversationDetail {
    return { providerId: 'test', id: 'contract', title: 'Contract', timestamp: null, assets: [], messages: [{ id: 'm', role: 'assistant', content: [{ type: 'unknown', sourceType: 'widget', text: 'Visible fallback' }] }] };
}
test('Domain closure rejects missing provider identity and duplicate resource identities', () => {
    const value = domain(); value.providerId = '';
    assert.throws(() => assertDomainClosure(value), /providerId/);
    value.providerId = 'test'; value.assets = [{ id: 'same', kind: 'image' }, { id: 'same', kind: 'image' }];
    assert.throws(() => assertDomainClosure(value), /Duplicate.*asset identity/);
});
test('composer rejects empty and duplicate authored message IDs but assigns positions only for display', () => {
    const value = domain(); value.messages.push(structuredClone(value.messages[0]));
    assert.throws(() => composeDomainDocument(value), /MSG_DUP_ID/);
    value.messages.pop(); value.messages[0].id = '';
    assert.throws(() => composeDomainDocument(value), /MSG_BAD_ID/);
    delete value.messages[0].id;
    const original = structuredClone(value);
    assert.equal(composeDomainDocument(value).document.messages[0].id, 'msg-0');
    assert.deepEqual(value, original);
});
test('unknown content and message order survive a JSON round trip across all backends', () => {
    const value = domain(); value.messages.push({ id: 'second', role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Second message' }] }] });
    const document = composeDomainDocument(value).document;
    assert.deepEqual(composeDomainDocument(JSON.parse(JSON.stringify(value))).document, document);
    for (const output of [renderDocumentHtml(document, {}).html, renderDocumentMarkdown(document, {}), JSON.stringify(renderDocumentTypst(document, {}))]) {
        assert.ok(output.includes('Visible fallback'));
        assert.ok(output.indexOf('Visible fallback') < output.indexOf('Second message'));
    }
});
test('HTML and Markdown sanitize hostile link protocols without rejecting visible labels', () => {
    for (const href of ['javascript:alert(1)', 'vbscript:evil', 'data:text/html,evil']) {
        const value = domain(); value.messages[0].content = [{ type: 'paragraph', children: [{ type: 'link', href, children: [{ type: 'text', text: 'Safe label' }] }] }];
        const document = composeDomainDocument(value).document;
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
    const raw = { id: 'unknown', messages: [{ role: 'widget', content: { message: 'x'.repeat(5000) } }] };
    const original = structuredClone(raw);
    const parsed = parseProviderConversation(raw);
    const content = parsed.conversation.messages[0].content[0];
    assert.equal(content.type, 'unknown');
    if (content.type === 'unknown') { assert.ok(content.text.length <= 2001); assert.ok(content.text.endsWith('…')); assert.ok(content.sourceType); }
    assert.deepEqual(raw, original);
    assert.ok(parsed.diagnostics.some(d => d.code === 'UNKNOWN_MESSAGE_CONTENT'));
});

// ---------------------------------------------------------- title authority
test('low-authority observation cannot downgrade a high-authority title', () => {
    let title = resolveTitle([{ value: 'RPC权威标题', source: 'rpc' }]);
    assert.ok(title);
    title = resolveTitle([title!, { value: 'sniff旧标题', source: 'sniff' }]);
    assert.strictEqual(title!.value, 'RPC权威标题');
    assert.strictEqual(title!.source, 'rpc');
});

test('higher-authority observation upgrades the title (no regression)', () => {
    let title = resolveTitle([{ value: 'Takeout旧标题', source: 'takeout' }]);
    assert.ok(title);
    title = resolveTitle([title!, { value: 'RPC新标题', source: 'rpc' }]);
    assert.strictEqual(title!.value, 'RPC新标题');
    assert.strictEqual(title!.source, 'rpc');
});

test('same-tier newer observation overwrites (repo setTitleBySource semantics)', () => {
    let title = resolveTitle([{ value: 'DOM旧标题', source: 'dom', observedAt: '2026-01-01T00:00:00Z' }]);
    assert.ok(title);
    title = resolveTitle([title!, { value: 'DOM新标题', source: 'dom', observedAt: '2026-02-01T00:00:00Z' }]);
    assert.strictEqual(title!.value, 'DOM新标题');
});

test('same-tier older observation can never overwrite a newer title', () => {
    let title = resolveTitle([{ value: 'DOM新标题', source: 'dom', observedAt: '2026-02-01T00:00:00Z' }]);
    assert.ok(title);
    title = resolveTitle([title!, { value: 'DOM旧标题', source: 'dom', observedAt: '2026-01-01T00:00:00Z' }]);
    assert.strictEqual(title!.value, 'DOM新标题');
});

test('same-tier: candidate with a timestamp beats one without', () => {
    const title = resolveTitle([
        { value: '无时间', source: 'dom' },
        { value: '有时间', source: 'dom', observedAt: '2026-03-01T00:00:00Z' },
    ]);
    assert.strictEqual(title!.value, '有时间');
});

test('same-tier: later insertion wins when both timestamps are missing', () => {
    const title = resolveTitle([
        { value: '先到', source: 'dom' },
        { value: '后到', source: 'dom' },
    ]);
    assert.strictEqual(title!.value, '后到');
});

test('same-tier: later insertion wins on equal timestamps', () => {
    const at = '2026-03-01T00:00:00Z';
    const title = resolveTitle([
        { value: '先到', source: 'dom', observedAt: at },
        { value: '后到', source: 'dom', observedAt: at },
    ]);
    assert.strictEqual(title!.value, '后到');
});

test('authority tier beats recency: newer sniff cannot beat older rpc', () => {
    let title = resolveTitle([{ value: 'RPC旧', source: 'rpc', observedAt: '2026-01-01T00:00:00Z' }]);
    assert.ok(title);
    title = resolveTitle([title!, { value: 'sniff新', source: 'sniff', observedAt: '2026-06-01T00:00:00Z' }]);
    assert.strictEqual(title!.value, 'RPC旧');
    assert.strictEqual(title!.source, 'rpc');
});

test('resolveTitle returns undefined when no candidate is usable', () => {
    assert.strictEqual(resolveTitle([]), undefined);
    assert.strictEqual(resolveTitle([{ value: '   ', source: 'dom' }]), undefined);
});

test('title tiers mirror the repo TITLE_TIER_RANK ladder', () => {
    assert.strictEqual(titleAuthorityRank('rpc'), 50);
    assert.strictEqual(titleAuthorityRank('api-detail'), 50);
    assert.strictEqual(titleAuthorityRank('dom'), 40);
    assert.strictEqual(titleAuthorityRank('takeout'), 30);
    assert.strictEqual(titleAuthorityRank('sniff'), 20);
    assert.strictEqual(titleAuthorityRank('legacy'), 10);
    assert.strictEqual(titleAuthorityRank('default'), 0);
    assert.ok(TITLE_AUTHORITY_RANK.user > TITLE_AUTHORITY_RANK.rpc, 'user title outranks auto-derived');
    assert.strictEqual(resolveTitle([
        { value: 'derived', source: 'derived' },
        { value: 'mine', source: 'user' },
    ])!.value, 'mine');
});

test('unknown source titles resolve to nothing (unknown stays unknown)', () => {
    assert.strictEqual(resolveTitle([]), undefined);
    assert.strictEqual(resolveTitle([{ value: '   ', source: 'rpc' }]), undefined);
});
