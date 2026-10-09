import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeminiRpcConversation } from '../src/core/parsers/gemini/rpc/parseConversation.js';
import { decodeGeminiDetail } from '../src/core/parsers/gemini/rpc/detailDecoder.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { renderDocumentMarkdown } from '../src/core/renderers/markdown/renderMarkdown.js';
import { extractBlockText } from '../src/core/domain/content/unknownFallback.js';

// Sanitized shape observed in the failing 2026-10-09 Tier 2 spray-dryer RPC:
// one request, two answer drafts, turn[3][3] naming the displayed candidate.
const ID = 'c_selected12345678';
const rpc = (candidates: unknown[], selected?: unknown) => {
    const model = [candidates, null, null, selected];
    const turn = [[ID, 'r_request'], [1700000000, 0], [['Derive the mass balance.']], model];
    return `)]}'\n\n${JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[turn]])]])}`;
};
const candidates = [
    ['rc_displayed', [['## System Definition and Mass Balances\n\nDisplayed balance.']]],
    ['rc_alternative', [['## System Boundaries and Assumptions\n\nUnselected balance.']]],
];
const parse = (wire: string) => parseGeminiRpcConversation(wire, { providerId: 'gemini' });
const answerText = (wire: string) => parse(wire).conversation.messages[1].content.map(block => extractBlockText(block)).join('\n');

test('selected wire answer exports one Assistant section and retains raw alternative evidence', () => {
    const wire = rpc(candidates, 'rc_displayed');
    const result = parse(wire);
    assert.deepEqual(result.conversation.messages.map(m => [m.role, m.id]), [['user', 'r_request'], ['assistant', 'rc_displayed']]);
    assert.match(answerText(wire), /Displayed balance/);
    assert.doesNotMatch(answerText(wire), /Unselected balance/);
    const markdown = renderDocumentMarkdown(composeDomainDocument(result.conversation).document, {});
    assert.equal((markdown.match(/^## 🤖 Assistant/gm) ?? []).length, 1);
    assert.match(markdown, /System Definition and Mass Balances/);
    assert.doesNotMatch(markdown, /System Boundaries and Assumptions/);
    const raw = result.transport.decodedPayload as unknown[][];
    assert.deepEqual(raw[0][0], [[ID, 'r_request'], [1700000000, 0], [['Derive the mass balance.']], [candidates, null, null, 'rc_displayed']]);
});

test('selection is by candidate identity even when the displayed answer is not first', () => {
    const wire = rpc(candidates, 'rc_alternative');
    assert.equal(parse(wire).conversation.messages[1].id, 'rc_alternative');
    assert.match(answerText(wire), /Unselected balance/);
    assert.doesNotMatch(answerText(wire), /Displayed balance/);
});

test('legacy missing, telemetry and unknown selections use a single primary draft', () => {
    for (const selection of [undefined, null, 'c', 6, 'rc_missing']) {
        const parsed = decodeGeminiDetail(rpc(candidates, selection));
        assert.equal(parsed.messages.length, 2);
        assert.equal(parsed.messages[1].id, 'rc_displayed');
    }
});

test('unselected images do not leak into the selected answer or consume its resources', () => {
    const image = 'https://lh3.googleusercontent.com/selected-image.png';
    const wire = rpc([
        ['rc_unselected', [[`Unselected image ![image](${image})`], [image, 640, 480]]],
        ['rc_selected', [[`Displayed image ![image](${image})`], [image, 640, 480]]],
    ], 'rc_selected');
    const parsed = decodeGeminiDetail(wire);
    assert.equal(parsed.messages.length, 2);
    assert.equal(parsed.messages[1].id, 'rc_selected');
    assert.equal(parsed.messages[1].images?.length, 1);
    assert.equal(parsed.messages[1].images?.[0].sourceUrl, image);
});
