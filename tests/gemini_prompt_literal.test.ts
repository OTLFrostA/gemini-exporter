import { fixtureAccount, fixtureAccountFor } from './helpers/domainFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGeminiRpcConversation } from '../src/core/parsers/gemini/rpc/parseConversation.js';
import { parseMarkdownToBlocks } from '../src/core/parsers/shared/markdown/index.js';
import { extractBlockText } from '../src/core/domain/content/unknownFallback.js';

test('native Gemini prompts preserve literal syntax while assistant Markdown remains structured', () => {
    const prompt = String.raw`Use f(\$)=1, **literal**, $x$, <input> and C:\temp\file.

Keep [link](https://example.com) and \* intact.`;
    const turn = [['c_literalprompt', 'r_prompt'], [1700000000, 0], [[prompt]],
        [[['rc_answer', [['**Rendered answer**']]]]]];
    const wire = JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[turn]])]]);
    const { conversation } = parseGeminiRpcConversation(wire, { account: fixtureAccount('gemini'), providerId: 'gemini' });
    const user = conversation.detail.messages[0];
    assert.equal(user.role, 'user');
    assert.equal(user.content.map(block => extractBlockText(block)).join('\n'), prompt);
    assert.ok(user.content.every(block => block.type === 'paragraph'));
    const answer = conversation.detail.messages[1];
    assert.ok(answer.content.some(block => block.type === 'paragraph' && block.children.some(node => node.type === 'strong')));
    assert.equal('key' in conversation.detail, false);
});
