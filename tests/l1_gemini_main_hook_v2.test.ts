// L1-owned source hook protocol tests, formerly mixed into Browser Runtime unit tests.
// Runtime tests mock the L1 bootstrap/MessageBridge v2 contracts instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
const root = path.resolve(__dirname, '..');

test('MAIN hook reinjection returns before wrapping fetch or adding timers/listeners', () => {
    const fs = require('node:fs');
    const esbuild = require('esbuild');
    const vm = require('node:vm');
    const source = fs.readFileSync(path.join(root, 'src/l1/sniffer/gemini/hookCredentials.ts'), 'utf8')
        .replace(/import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*\s,]+)\s*from\s*['"][^'"]+['"];?\s*/g, '');
    const script = esbuild.transformSync(source, { loader: 'ts', format: 'iife' }).code;
    const window = { __gemExporterHookInstalled: true, fetch: () => {} };
    const original = window.fetch;
    vm.runInNewContext(script, { window });
    assert.equal(window.fetch, original);
});


// Completion requires an answered candidate and a complete response, not HTTP status.
// The fixture has no cloud-history persistence token. Application acquires Detail.
function streamWire(options: { answered?: number; responseId?: string } = {}) {
    const candidate = ['rc_abc123', ['latest reply'], null, null, null, null, null, null, [options.answered ?? 2]];
    const inner = new Array(5).fill(null);
    inner[1] = ['c_abcdef123456', options.responseId || 'r_abc123']; inner[4] = [candidate];
    const frame = JSON.stringify([['wrb.fr', null, JSON.stringify(inner)]]);
    return ")]}'\n\n" + Buffer.byteLength(frame) + '\n' + frame + '\n';
}
function hookHarness(fetcher: Function) {
    const fs = require('node:fs'), esbuild = require('esbuild'), vm = require('node:vm');
    const protocol = require('../src/l1/protocol/gemini/protocol.js');
    const messages: any[] = [];
    let intervals = 0;
    class Xhr extends EventTarget {
        status = 200; responseText = ''; nativeSendError = false;
        open() {}
        send() { if (this.nativeSendError) throw new Error('native send failed'); }
        emit(type: string) { this.dispatchEvent(new Event(type)); }
    }
    const win = Object.assign(new EventTarget(), {
        fetch: fetcher,
        postMessage: (message: unknown) => { messages.push(message); },
        setInterval: () => { intervals++; return 1; },
    });
    const location = { href: 'https://gemini.google.com/app/abcdef123456', pathname: '/app/abcdef123456', origin: 'https://gemini.google.com' };
    const source = fs.readFileSync(path.join(root, 'src/l1/sniffer/gemini/hookCredentials.ts'), 'utf8')
        .replace(/import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*\s,]+)\s*from\s*['"][^'"]+['"];?\s*/g, '');
    const script = esbuild.transformSync(source, { loader: 'ts', format: 'iife' }).code;
    const context = vm.createContext({ window: win, location, document: new EventTarget(),
        console, Event, URL, URLSearchParams, Request, Response, TextEncoder, TextDecoder, Uint8Array,
        XMLHttpRequest: Xhr, GeminiProtocol: protocol, CrossWorldEvents: protocol.CrossWorldEvents,
        sniffUserProfileFromDom: () => ({}), geminiAccountObservation: () => ({ providerId: 'gemini', providerAccountId: 'gaia' }),
        readGeminiListRequest: () => null, readGeminiDetailRequest: () => null,
    });
    const inject = () => vm.runInContext(script, context);
    inject();
    return { win, Xhr, messages, inject, intervals: () => intervals,
        complete: () => messages.filter(message => message.type === 'GEMINI_STREAM_GENERATE_COMPLETE'),
        url: 'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate',
    };
}
const settleHook = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };

test('Fetch: answered frames without a persistence token notify once, reinjection and replay do not duplicate', async () => {
    const harness = hookHarness(async () => new Response(streamWire()));
    const fetch = harness.win.fetch;
    harness.inject(); assert.equal(harness.win.fetch, fetch); assert.equal(harness.intervals(), 1);
    const response = await harness.win.fetch(harness.url);
    await response.text(); await settleHook();
    assert.equal(harness.complete().length, 1);
    assert.equal(harness.complete()[0].payload.id, 'abcdef123456');
    await (await harness.win.fetch(harness.url)).text(); await settleHook();
    assert.equal(harness.complete().length, 1);
});
for (const status of [400, 500]) test(`Fetch: HTTP ${status} never completes even with final-looking body`, async () => {
    const harness = hookHarness(async () => new Response(streamWire(), { status }));
    await (await harness.win.fetch(harness.url)).text(); await settleHook();
    assert.equal(harness.complete().length, 0);
    assert.equal((harness.win as any).__geminiIsStreaming, false);
});
test('Fetch: rejected Abort clears transient generation state without completing', async () => {
    const harness = hookHarness(async () => { throw new DOMException('cancelled', 'AbortError'); });
    await assert.rejects(harness.win.fetch(harness.url), /cancelled/);
    assert.equal(harness.complete().length, 0);
    assert.equal((harness.win as any).__geminiIsStreaming, false);
});
test('Fetch: body reader failure never falls back to successful text or completes', async () => {
    const harness = hookHarness(async () => ({ ok: true, clone: () => ({
        body: { getReader: () => ({ read: async () => { throw new Error('read failed'); }, releaseLock() {} }) },
        text: () => assert.fail('Do not reinterpret failed reader as successful text'),
    }) }));
    await harness.win.fetch(harness.url); await settleHook();
    assert.equal(harness.complete().length, 0);
    assert.equal((harness.win as any).__geminiIsStreaming, false);
});
test('Fetch: capped response cannot complete even when its prefix contains completion markers', async () => {
    let reads = 0, cancels = 0;
    const harness = hookHarness(async () => ({ ok: true, clone: () => ({ body: { getReader: () => ({
        read: async () => ({ done: false, value: new TextEncoder().encode(streamWire() + ' '.repeat(4 * 1024 * 1024)) }),
        cancel: () => { cancels++; return new Promise<void>(() => {}); }, releaseLock() { reads++; },
    }) } }) }));
    await harness.win.fetch(harness.url); await settleHook();
    assert.equal(reads, 1); assert.equal(cancels, 1);
    assert.equal(harness.complete().length, 0);
});
for (const wire of [streamWire({ answered: 1 }), '[]\n', streamWire() + '50\n', streamWire() + '[["er",7]]\n']) {
    test('Fetch: HTTP 200 without unambiguous successful protocol termination is ignored: ' + wire.slice(-22), async () => {
        const harness = hookHarness(async () => new Response(wire));
        await (await harness.win.fetch(harness.url)).text(); await settleHook();
        assert.equal(harness.complete().length, 0);
    });
}
test('Fetch: clone failure and signal aborted after headers do not complete', async () => {
    const failedClone = hookHarness(async () => ({ ok: true, clone: () => { throw new Error('clone failed'); } }));
    await failedClone.win.fetch(failedClone.url); await settleHook(); assert.equal(failedClone.complete().length, 0);
    const controller = new AbortController();
    const aborted = hookHarness(async () => { controller.abort(); return new Response(streamWire()); });
    await (await aborted.win.fetch(aborted.url, { signal: controller.signal })).text(); await settleHook();
    assert.equal(aborted.complete().length, 0);
});
test('XHR: successful final frames on load notify once; loadend/reinjection/replay cannot duplicate', () => {
    const harness = hookHarness(async () => new Response(''));
    harness.inject(); assert.equal(harness.intervals(), 1);
    const xhr = new harness.Xhr();
    (xhr.open as Function)('POST', harness.url); xhr.responseText = streamWire(); xhr.send();
    xhr.emit('load'); xhr.emit('loadend'); xhr.emit('load');
    assert.equal(harness.complete().length, 1);
    // Reusing the object must not retain old listeners, and a new response id is a new turn.
    (xhr.open as Function)('POST', harness.url); xhr.responseText = streamWire({ responseId: 'r_def456' }); xhr.send(); xhr.emit('load'); xhr.emit('loadend');
    assert.equal(harness.complete().length, 2);
});
for (const event of ['abort', 'error', 'timeout', 'loadend']) test(`XHR: ${event} is request termination, never generation completion`, () => {
    const harness = hookHarness(async () => new Response(''));
    const xhr = new harness.Xhr(); (xhr.open as Function)('POST', harness.url); xhr.responseText = streamWire(); xhr.send();
    xhr.emit(event); xhr.emit('loadend'); xhr.emit('load');
    assert.equal(harness.complete().length, 0);
    assert.equal((harness.win as any).__geminiIsStreaming, false);
});
for (const status of [0, 403, 503]) test(`XHR: status ${status} with load cannot complete`, () => {
    const harness = hookHarness(async () => new Response(''));
    const xhr = new harness.Xhr(); (xhr.open as Function)('POST', harness.url); xhr.status = status; xhr.responseText = streamWire(); xhr.send(); xhr.emit('load'); xhr.emit('loadend');
    assert.equal(harness.complete().length, 0);
});
test('XHR: 200 without completion markers, oversized body and synchronous send failure cannot complete', () => {
    const harness = hookHarness(async () => new Response(''));
    for (const body of [streamWire({ answered: 1 }), streamWire() + ' '.repeat(4 * 1024 * 1024)]) {
        const xhr = new harness.Xhr(); (xhr.open as Function)('POST', harness.url); xhr.responseText = body; xhr.send(); xhr.emit('load'); xhr.emit('loadend');
    }
    const xhr = new harness.Xhr(); (xhr.open as Function)('POST', harness.url); xhr.nativeSendError = true;
    assert.throws(() => xhr.send(), /native send failed/); xhr.responseText = streamWire(); xhr.emit('load');
    assert.equal(harness.complete().length, 0);
});


test('Fetch: relative StreamGenerate URL completes; unrelated BardFrontend RPC never does', async () => {
    const relative = hookHarness(async () => new Response(streamWire()));
    await (await relative.win.fetch(new URL(relative.url).pathname)).text(); await settleHook();
    assert.equal(relative.complete().length, 1);
    const unrelated = hookHarness(async () => new Response(streamWire()));
    await (await unrelated.win.fetch(unrelated.url.replace('/StreamGenerate', '/OtherRpc'))).text(); await settleHook();
    assert.equal(unrelated.complete().length, 0);
});


test('Fetch: live newline-inclusive frame lengths are accepted and corrupt lengths are rejected', async () => {
    const wire = streamWire().replace(/\n(\d+)\n/, (_match, count) => '\n' + (Number(count) + 2) + '\n');
    const valid = hookHarness(async () => new Response(wire));
    await (await valid.win.fetch(valid.url)).text(); await settleHook();
    assert.equal(valid.complete().length, 1);
    const corrupt = hookHarness(async () => new Response(wire.replace(/\n(\d+)\n/, (_match, count) => '\n' + (Number(count) + 1) + '\n')));
    await (await corrupt.win.fetch(corrupt.url)).text(); await settleHook();
    assert.equal(corrupt.complete().length, 0);
});

test('Fetch: sanitized live answered frame with newline-inclusive length triggers completion', async () => {
    const fixture = require('./fixtures/gemini_answered_stream.json');
    const wire = ")]}'\n\n" + fixture.frames.map((frame: unknown) => {
        const json = JSON.stringify(frame);
        return (Buffer.byteLength(json) + 2) + '\n\n' + json + '\n';
    }).join('');
    const harness = hookHarness(async () => new Response(wire));
    await (await harness.win.fetch(harness.url)).text(); await settleHook();
    assert.equal(harness.complete().length, 1);
    assert.equal(harness.complete()[0].payload.id, 'abcdef123456');
});

test('Fetch: live Unicode frame lengths count UTF-16 units rather than UTF-8 bytes', async () => {
    const inner = [null, ['c_abcdef123456', 'r_abc123'], null, null,
        [['rc_abc123', ['公式：α + β，中文与 🌿'], null, null, null, null, null, null, [2]]]];
    const frame = JSON.stringify([['wrb.fr', null, JSON.stringify(inner)]]);
    assert.notEqual(frame.length, Buffer.byteLength(frame));
    const harness = hookHarness(async () => new Response(")]}'\n\n" + (frame.length + 2) + '\n\n' + frame + '\n'));
    await (await harness.win.fetch(harness.url)).text(); await settleHook();
    assert.equal(harness.complete().length, 1);
});
