import test from 'node:test';
import assert from 'node:assert/strict';
import { transformMarkdownOutsideCode, normalizeTexBracketsInProse } from '../src/l1/parsers/shared/markdown/texBrackets.js';

for (const [name, code] of [
    ['shorter backticks', '````text\nbefore\n```\n\\(x+y\\)\n````'],
    ['shorter tildes', '~~~~text\nbefore\n~~~\n\\(x+y\\)\n~~~~'],
    ['backticks inside tildes', '~~~text\n```\n\\(x+y\\)\n~~~'],
    ['longer closing fence', '```text\n\\(x+y\\)\n````'],
    ['indented closing fence', '   ````text\n```\n\\(x+y\\)\n   `````  '],
    ['non-line closing run', '````text\nbefore ```` after\n\\(x+y\\)\n````'],
    ['closing run with text', '````text\n```` not a closer\n\\(x+y\\)\n````'],
    ['inline span', '`\\(x+y\\)`'],
    ['list continuation', '1. Step\n   ```text\n   \\(x+y\\)\n   ```'],
    ['list marker opener', '- ```text\n  \\(x+y\\)\n  ```'],
    ['blockquote', '> ```text\n> \\(x+y\\)\n> ```'],
    ['nested containers', '> 1. - ```text\n>      \\(x+y\\)\n>      ```'],
    ['nested list continuation', '1. Step\n   - Nested\n     ```text\n     \\(x+y\\)\n     ```'],
] as const) {
    test(`TeX shielding: ${name}`, () => {
        assert.equal(transformMarkdownOutsideCode(`\\(a+b\\)\n${code}\n\\(c+d\\)`, normalizeTexBracketsInProse),
            `$a+b$\n${code}\n$c+d$`);
    });
}

test('TeX shielding keeps unclosed fences literal through EOF', () => {
    const source = '\\(a+b\\)\n````text\n```\n\\(x+y\\)';
    assert.equal(transformMarkdownOutsideCode(source, normalizeTexBracketsInProse), source.replace('\\(a+b\\)', '$a+b$'));
});

test('TeX shielding handles empty input and propagates transform errors', () => {
    assert.equal(transformMarkdownOutsideCode('', () => { throw new Error('unused'); }), '');
    assert.throws(() => transformMarkdownOutsideCode('prose', () => { throw new Error('failed'); }), /failed/);
});
