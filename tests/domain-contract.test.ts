import { fixtureKey, fixtureAccountFor } from './helpers/domainFixture.js';
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { historicalFixture } from './helpers/nativeFixture.js';
import { parseConversation } from '../src/core/parsers/parseConversation.js';
/** Domain/composer contracts, including the shared title authority rules. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTitle, titleAuthorityRank } from '../src/core/domain/titleAuthority.js';
import { assertDomainClosure } from '../src/core/domain/closure.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { renderDocumentHtml } from '../src/core/renderers/html/renderHtml.js';
import { renderDocumentMarkdown } from '../src/core/renderers/markdown/renderMarkdown.js';
import { renderDocumentTypst } from '../src/core/renderers/typst/renderTypst.js';
import { normalizeArchiveResourceName } from '../src/core/export/assets/archivePath.js';
import type { DomainConversationWithDetail } from '../src/core/domain/conversation.js';
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
    assert.deepEqual(document.messages.map(message => message.id), value.detail.messages.map((_, index) => `msg-${index}`));
    assert.equal(new Set(document.messages.flatMap(message => message.sources?.items.map(item => item.id) ?? [])).size, value.detail.messages.length);
    assert.deepEqual(value, original);
});
test('unknown content and message order survive a JSON round trip across all backends', () => {
    const value = domain(); value.detail.messages.push({ id: 'second', role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Second message' }] }] });
    const document = composeDomainDocument(validateParserDomain(value), fixtureAccountFor(validateParserDomain(value))).document;
    assert.deepEqual(composeDomainDocument(JSON.parse(JSON.stringify(value)), fixtureAccountFor(JSON.parse(JSON.stringify(value)))).document, document);
    for (const output of [renderDocumentHtml(document, {}).html, renderDocumentMarkdown(document, {}), JSON.stringify(renderDocumentTypst(document, {}))]) {
        assert.ok(output.includes('Visible fallback'));
        assert.ok(output.indexOf('Visible fallback') < output.indexOf('Second message'));
    }
});
test('HTML and Markdown sanitize hostile link protocols without rejecting visible labels', () => {
    for (const href of ['javascript:alert(1)', 'vbscript:evil', 'data:text/html,evil']) {
        const value = domain(); value.detail.messages[0].content = [{ type: 'paragraph', children: [{ type: 'link', href, children: [{ type: 'text', text: 'Safe label' }] }] }];
        const document = composeDomainDocument(validateParserDomain(value), fixtureAccountFor(validateParserDomain(value))).document;
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
