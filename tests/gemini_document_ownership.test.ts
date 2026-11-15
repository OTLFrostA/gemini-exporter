import test from 'node:test';
import assert from 'node:assert/strict';
import { citationText, coverageWire } from './fixtures/providers/gemini/detail/content.js';
import { fixtureAccount } from './helpers/domainFixture.js';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import { mergeConversationPages } from '../src/l1/parsers/gemini/rpc/mergePages.js';
import { assertDomainClosure } from '../src/l2/closure.js';
import { attachmentCard } from './fixtures/providers/gemini/detail/remainingFallbackCases.js';

// Independently authored wire documents and output expectations. Field 13 is a
// repeated document parallel to the candidate list, not content alternatives.
function parse(documents: unknown[], markdown: string[], selected: number) {
    const wire = coverageWire(documents, markdown.map((body, index) => [
        'rc_draft_' + index, [[body]],
    ]), 'rc_draft_' + selected);
    return mergeConversationPages([parseGeminiRpcConversation(wire, {
        account: fixtureAccount('gemini'), providerId: 'gemini',
    })], undefined, true);
}

test('candidate identity selects its parallel document even when another document matches its Markdown', () => {
    for (const selected of [0, 1]) {
        const documents = ['Native first.', 'Native second.'].map(body => [[citationText(body)]]);
        const result = parse(documents, ['Native second.', 'Native first.'], selected);
        assert.equal(result.conversation.detail.quality.status, 'complete');
        const assistant = result.conversation.detail.messages.find(message => message.role === 'assistant');
        assert.equal(assistant?.id, 'rc_draft_' + selected);
        assert.deepEqual(assistant?.content, [{ type: 'paragraph', children: [{ type: 'text',
            text: selected === 0 ? 'Native first.' : 'Native second.',
        }] }]);
        assertDomainClosure(result.conversation.detail);
    }
});

test('CJK delimiter differences and identical draft text do not make document ownership ambiguous', () => {
    for (const markdown of ['推荐**“示例”**方案', '推荐“示例”方案']) {
        const result = parse([[[citationText('推荐“示例”方案')]], [[citationText('推荐“示例”方案')]]],
            [markdown, markdown], 1);
        assert.equal(result.conversation.detail.quality.status, 'complete');
        assert.deepEqual(result.conversation.detail.messages[1].content,
            [{ type: 'paragraph', children: [{ type: 'text', text: '推荐“示例”方案' }] }]);
    }
});

test('missing, empty or rejected selected document never borrows a matching neighbor', () => {
    for (const selectedDocument of [undefined, [[]], [[citationText('Native selected.'), [null, null, null, null, null, null, null, 'unsupported']]]]) {
        const documents = [[[citationText('Selected Markdown.')]]];
        if (selectedDocument !== undefined) documents.push(selectedDocument);
        const result = parse(documents, ['Other Markdown.', 'Selected Markdown.'], 1);
        assert.ok(JSON.stringify(result.conversation.detail.messages[1].content).includes('Selected Markdown.'));
        assert.ok(!JSON.stringify(result.conversation.detail.messages[1].content).includes('Native selected.'));
        if (selectedDocument?.[0]?.length) assert.equal(result.conversation.detail.quality.status, 'partial');
    }
});

test('resources in an unselected document cannot leak through a rejected selected document', () => {
    for (const selected of [0, 1]) {
        const documents = [[[citationText('Other.'), attachmentCard()]],
            [[[null, null, null, null, null, null, null, 'unsupported']]]];
        if (selected === 0) documents.reverse();
        const result = parse(documents, ['Selected Markdown.', 'Selected Markdown.'], selected);
        assert.equal(result.conversation.detail.assets.length, 0);
        assert.equal(result.conversation.detail.quality.status, 'partial');
    }
});

test('a selected nonprimary document retains its own image while excluding the primary image', () => {
    const url = 'https://example.com/selected-image.jpg';
    const result = parse([[[attachmentCard()]], [[citationText('Selected.'), attachmentCard(url)]]],
        ['Other.', 'Selected.'], 1);
    assert.equal(result.conversation.detail.quality.status, 'complete');
    assert.equal(result.conversation.detail.assets.length, 1);
    assert.equal(result.conversation.detail.assets[0].sourceUri, url);
    assertDomainClosure(result.conversation.detail);
});

test('rejected nonprimary document retains its original index for diagnostic replay', () => {
    const rejected = [null, null, null, null, null, null, null, 'unsupported'];
    const documents = [[[citationText('Other.')]], [[rejected]]];
    const result = parse(documents, ['Other.', 'Selected Markdown.'], 1);
    const diagnostic = result.diagnostics.find(d => d.code === 'GEMINI_STRUCTURED_FALLBACK' && d.severity === 'warning');
    assert.ok(diagnostic?.details && typeof diagnostic.details === 'object' && !Array.isArray(diagnostic.details));
    assert.deepEqual(diagnostic.details.rawDocument, documents);
    assert.equal(diagnostic.details.candidateIndex, 1);
    const issue = diagnostic.details.issue;
    assert.ok(issue && typeof issue === 'object' && !Array.isArray(issue));
    assert.equal(issue.path, '/1/0/0');
    assert.deepEqual(diagnostic.details.candidateEvidence,
        { candidateIndex: 1, candidateId: 'rc_draft_1', candidateText: 'Selected Markdown.' });
});

test('selected native formatting and code survive independently of Markdown formatting', () => {
    const code = 'if ok:\n    run()\n';
    const codeNode = Object.assign(Array(4).fill(null), { 3: [code, 'python'] });
    const native = '推荐“示例”方案 a  b **literal**';
    const node = citationText(native, [
        [2, 6, [[null, null, null, null, 2]]],
        [9, 13, [[null, null, null, null, 3]]],
    ]);
    const result = parse([[[citationText('Other body.')]], [[node, codeNode]]],
        ['Other body.', '推荐**“示例”**方案 `a b` literal\n\n```python\nif ok:\nrun()\n```'], 1);
    assert.equal(result.conversation.detail.quality.status, 'complete');
    assert.deepEqual(result.conversation.detail.messages[1].content, [
        { type: 'paragraph', children: [
            { type: 'text', text: '推荐' }, { type: 'strong', children: [{ type: 'text', text: '“示例”' }] },
            { type: 'text', text: '方案 ' }, { type: 'inlineCode', code: 'a  b' },
            { type: 'text', text: ' **literal**' },
        ] },
        { type: 'code', code, language: 'python' },
    ]);
});
