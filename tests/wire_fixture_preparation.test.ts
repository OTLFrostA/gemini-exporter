import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizeProviderWire } from '../scripts/sanitize_provider_wire.js';

test('JSON preparation keeps graph references aligned and masks text at every byte and code-unit boundary', () => {
    const input = {
        current_node: 'private-node',
        mapping: { 'private-node': { id: 'private-node', parent: null, parts: ['**Aé中🚀**', true, 4] } },
        'signed/url~v1': 'https://private.example/file?sig=private-value',
        purpose: 'Approved QA prose',
    };
    const result = sanitizeProviderWire(JSON.stringify(input), JSON.stringify({
        aliases: { 'private-node': 'fixture-node' },
        redact: [{ pointer: '/mapping/private-node/parts/0' }, { pointer: '/signed~1url~0v1', replacement: 'https://example.test/file' }],
    }), 'json');
    const output = JSON.parse(result);
    assert.equal(output.current_node, 'fixture-node');
    assert.equal(output.mapping[output.current_node].id, 'fixture-node');
    const before = input.mapping['private-node'];
    const after = output.mapping[output.current_node];
    assert.equal(after.parent, null);
    assert.deepEqual(after.parts, ['**xø文😀**', true, 4]);
    const offsets = (text: string) => Array.from(text).map(char => [Buffer.byteLength(char), char.length]);
    assert.deepEqual(offsets(after.parts[0]), offsets(String(before.parts[0])));
    assert.equal(output['signed/url~v1'], 'https://example.test/file');
    assert.equal(output.purpose, input.purpose);
    assert.doesNotMatch(result, /private-node|private-value|Aé中🚀/);
});

test('SSE preparation retains event order and terminal marker without counting comments as data events', () => {
    const stream = ': private transport note\r\n\r\n'
        + 'event: message_start\r\ndata: {"id":"private-id",\r\ndata: "role":"assistant"}\r\n\r\n'
        + 'event: content_block_delta\r\ndata: {"text":"Sensitive"}\r\n\r\ndata: [DONE]\r\n\r\n';
    assert.equal(sanitizeProviderWire(stream, JSON.stringify({
        redact: [{ pointer: '/1/text' }], aliases: { 'private-id': 'fixture-id' },
    }), 'sse'), 'event: message_start\ndata: {"id":"fixture-id","role":"assistant"}\n\n'
        + 'event: content_block_delta\ndata: {"text":"xxxxxxxxx"}\n\ndata: [DONE]\n\n');
});

test('preparation rejects stale plans, aliases that collide, loss of numeric precision and incomplete streams', () => {
    const plan = '{"redact":[{"pointer":"/message"}]}';
    assert.throws(() => sanitizeProviderWire('{"message":"private",broken}', plan, 'json'), /Invalid capture JSON/);
    assert.throws(() => sanitizeProviderWire('{"other":"private"}', plan, 'json'), /unmatched/);
    assert.throws(() => sanitizeProviderWire('{"message":42}', plan, 'json'), /must select a string/);
    assert.throws(() => sanitizeProviderWire('{"message":"private","number":9007199254740995}', plan, 'json'), /number/);
    assert.throws(() => sanitizeProviderWire('{"a":"first","b":"second"}', '{"redact":[],"aliases":{"a":"b"}}', 'json'), /collides/);
    assert.throws(() => sanitizeProviderWire('data: {"message":"private"}\n', plan, 'sse'), /incomplete/);
    assert.throws(() => sanitizeProviderWire('data: {"message":"private"}\nid: private\n\n', plan, 'sse'), /Unsupported SSE field/);
});

test('Gemini CLI accepts input and output without a salt and does not emit malformed captures', t => {
    const directory = mkdtempSync(join(tmpdir(), 'gemini-wire-test-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const source = join(directory, 'source.txt');
    const output = join(directory, 'review.txt');
    const cli = (...args: string[]) => spawnSync(process.execPath, [
        '-r', join(__dirname, 'ts_register.js'), join(__dirname, '../scripts/sanitize_gemini_wire.ts'), ...args,
    ], { encoding: 'utf8' });
    writeFileSync(source, JSON.stringify([['di', 'example']]), 'utf8');
    const valid = cli(source, output, '--mode', 'full');
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(readFileSync(output, 'utf8'))[0][0], 'di');
    assert.doesNotMatch(readFileSync(output, 'utf8'), /example/);
    writeFileSync(source, ")]}'\n\nmalformed canary\n", 'utf8');
    const invalid = cli(source);
    assert.notEqual(invalid.status, 0);
    assert.equal(invalid.stdout, '');
    assert.doesNotMatch(invalid.stderr, /malformed canary/);
});
