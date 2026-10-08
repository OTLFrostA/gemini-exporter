import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConversation } from '../src/core/parsers/parseConversation.js';

const turn = [['c_noTsTurn_1', 'r_turn_1'], null, [['Question']], [[['rc_model_1', [['Answer']]]]]];
const data = `)]}'\n\n${JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[turn]])]])}`;

test('timestamp_honesty - RPC Domain messages omit timestamps when source dates are absent', () => {
    const { conversation } = parseConversation({ format: 'gemini-rpc', providerId: 'gemini', data });
    assert.equal(conversation.messages.length, 2);
    assert.equal(conversation.timestamp, null);
    for (const message of conversation.messages) assert.equal(message.timestamp, undefined);
});

test('timestamp_honesty - Takeout Domain messages omit dates instead of fabricating now', () => {
    const htmlText = `<div class="outer-cell"><a href="https://gemini.google.com/app/no_timestamp">Chat</a>
        <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted Question<br><p>Answer</p></div></div>`;
    const { conversation } = parseConversation({ format: 'gemini-takeout', providerId: 'gemini', data: { htmlText } });
    assert.equal(conversation.messages.length, 2);
    assert.equal(conversation.timestamp, null);
    for (const message of conversation.messages) assert.equal(message.timestamp, undefined);
});
