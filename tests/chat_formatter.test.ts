export {};
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

test('chat_formatter - convertHtmlToMarkdown converts html elements safely', () => {
    const rawHtml = '<p>Here is a code snippet:</p><pre><code class="language-js">console.log(&quot;hello&quot;);</code></pre><p>And some <b>bold</b> and <i>italic</i> text with <br/>break.</p>';
    const md = ChatFormatter.convertHtmlToMarkdown(rawHtml);
    assert.ok(md.includes('```js'), 'Code block should have language');
    assert.ok(md.includes('console.log("hello");'), 'Entities should be unescaped');
    assert.ok(md.includes('**bold**'), 'Bold should be markdown');
    assert.ok(md.includes('*italic*'), 'Italic should be markdown');
});

test('chat_formatter - adjustHeadingHierarchy shifts headings outside code blocks', () => {
    const md = '# Title\n## Subtitle\n```\n# Not a heading\n```\n### Inner';
    const shifted = ChatFormatter.adjustHeadingHierarchy(md, 2);
    const lines = shifted.split('\n');
    assert.strictEqual(lines[0], '### Title');
    assert.strictEqual(lines[1], '#### Subtitle');
    assert.strictEqual(lines[3], '# Not a heading');
    assert.strictEqual(lines[5], '##### Inner');
});

test('chat_formatter - cleanMessageBody strips placeholder urls and chips', () => {
    const text = 'Hello world\nhttps://googleusercontent.com/immersive_entry_chip/12345\nNext line';
    const cleaned = ChatFormatter.cleanMessageBody(text);
    assert.ok(!cleaned.includes('immersive_entry_chip'), 'Immersive chip url should be stripped');
    assert.ok(cleaned.includes('Hello world'));
    assert.ok(cleaned.includes('Next line'));
});

test('chat_formatter - renderAttachments renders images and file attachments', () => {
    const atts = [
        { type: 'image', localName: 'assets/cat.png', alt: 'Cute cat', src: 'https://images.google.com/cat.png' },
        { type: 'file', localName: 'files/data.csv', name: 'data.csv', title: 'Data File' }
    ];
    const rendered = ChatFormatter.renderAttachments(atts, true);
    assert.ok(rendered.includes('![Cute cat](assets/cat.png)'), 'Image markdown should be rendered');
    assert.ok(rendered.includes('- 📎 [Data File](files/data.csv)'), 'File attachment should be rendered');
});

