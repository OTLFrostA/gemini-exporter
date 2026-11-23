import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureAccount, fixtureKey } from './helpers/domainFixture.js';
import { validateParserDomain } from '../src/l2/runtimeValidation.js';
import { composeDomainDocument } from '../src/l3b/compose/composeDomainDocument.js';
import { renderDocumentMarkdown } from '../src/l4/format/markdown/renderMarkdown.js';
import { detailGen } from './fixtures/providers/geminiDetail.js';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';

function markdownFrom(capture: Parameters<typeof detailGen>[0]) {
    const account = fixtureAccount('gemini');
    const parsed = parseGeminiRpcConversation(detailGen(capture), { providerId: 'gemini' });
    const key = fixtureKey(parsed.conversationId, 'gemini');
    const domain = validateParserDomain({
        index: { ...parsed.conversation.index, key },
        detail: { ...parsed.conversation.detail, key },
    });
    return renderDocumentMarkdown(composeDomainDocument(domain, account), {});
}

function tableFrom(key: Parameters<typeof detailGen>[0]) {
    const parsed = parseGeminiRpcConversation(detailGen(key), { providerId: 'gemini' });
    const answer = parsed.conversation.detail.messages.find(message => message.role === 'assistant');
    const table = answer?.content.find(block => block.type === 'table');
    assert.ok(table);
    return table;
}

for (const key of ['G_TABLE_RESTORE_LL1_20', 'G_TABLE_RESTORE_LL1_23'] as const) {
    test(`${key}: preserves native header content and restores each missing last-column production`, () => {
        const table = tableFrom(key);
        const headers = table.headerRows?.[0].cells;
        assert.equal(headers?.length, 10);
        assert.equal(headers?.[7].colSpan, 2);
        assert.deepEqual(headers?.[7].children, [
            { type: 'inlineMath', source: '(' },
            { type: 'text', text: '\\vert{}' },
            { type: 'inlineMath', source: ')' },
        ]);
        assert.deepEqual(table.rows.map(row => row.cells.length), [11, 11, 11]);
        const expectedTails = key === 'G_TABLE_RESTORE_LL1_20'
            ? ["E' \\to \\epsilon", "T' \\to \\epsilon", 'F_{\\text{tail}} \\to \\epsilon']
            : Array(3).fill('\\epsilon');
        assert.deepEqual(table.rows.map(row => row.cells.at(-1)?.children),
            expectedTails.map(source => [{ type: 'inlineMath', source }]));
        const markdown = markdownFrom(key);
        assert.ok(markdown.includes('<th colspan="2"><code>(</code>\\vert{}<code>)</code></th>'));
        const rows = [...markdown.matchAll(/<tr><td>.*?<td><code>([^<]+)<\/code><\/td><\/tr>/g)];
        assert.deepEqual(rows.map(row => row[1]), expectedTails.map(source => source.replaceAll("'", "&#39;")));
    });
}

test('preserves existing cell math and recovers the independently marked suffix', () => {
    const table = tableFrom('G_TABLE_RESTORE_SUPERSCRIPT_46');
    assert.deepEqual(table.rows[0].cells.at(-1)?.children, [
        { type: 'inlineMath', source: '0.0210' },
        { type: 'text', text: ' (SE' },
        { type: 'inlineMath', source: '^2' },
        { type: 'text', text: ')' },
    ]);
});

test('recovered superscript stays math in emitted Markdown', () => {
    const markdown = markdownFrom('G_TABLE_RESTORE_SUPERSCRIPT_46');
    assert.ok(markdown.includes('$0.0210$ (SE$^2$)'));
});

test('a conflicting header or ambiguous duplicate Markdown tables cannot supply cells', () => {
    for (const key of ['G_TABLE_RESTORE_CONFLICT', 'G_TABLE_RESTORE_AMBIGUOUS'] as const) {
        const table = tableFrom(key);
        assert.equal(table.headerRows?.[0].cells.length, 10);
        assert.deepEqual(table.rows.map(row => row.cells.length), [10, 10, 10]);
    }
});
