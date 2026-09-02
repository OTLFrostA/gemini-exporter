const test = require('node:test');
const assert = require('node:assert');
const ChatFormatter = require('../src/core/engine/chatFormatter.js');

test('chat_formatter - formatContent markdown', () => {
    const mockChat = {
        id: '12345678',
        title: 'Quantum Physics Guide',
        url: 'https://gemini.google.com/app/12345678',
        timestamp: 1700000000000,
        messages: [
            { role: 'user', content: 'What is superposition?' },
            { role: 'model', content: 'Superposition is a fundamental principle of quantum mechanics.' }
        ]
    };

    const res = ChatFormatter.formatContent(mockChat, 'markdown');
    assert.strictEqual(res.ext, 'md');
    assert.ok(res.content.includes('# Quantum Physics Guide'));
    assert.ok(res.content.includes('What is superposition?'));
    assert.ok(res.content.includes('Superposition is a fundamental principle'));
});

test('chat_formatter - formatContent json_openai', () => {
    const mockChat = {
        id: '12345678',
        title: 'Test',
        messages: [
            { role: 'user', content: 'Hello' },
            { role: 'model', content: 'Hi there!' }
        ]
    };

    const res = ChatFormatter.formatContent(mockChat, 'json_openai');
    assert.strictEqual(res.ext, 'json');
    const parsed = JSON.parse(res.content);
    assert.strictEqual(parsed.messages.length, 2);
    assert.strictEqual(parsed.messages[0].role, 'user');
    assert.strictEqual(parsed.messages[0].content, 'Hello');
    assert.strictEqual(parsed.messages[1].role, 'assistant');
    assert.strictEqual(parsed.messages[1].content, 'Hi there!');
});
