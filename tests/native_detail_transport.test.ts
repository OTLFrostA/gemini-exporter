import { saveDomainConversation } from '../src/core/domain/snapshotAdmission.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historicalFixture } from './helpers/nativeFixture.js';
import { requestNativeDetail, requestNativeBatch } from '../src/core/utils/nativeDetailTransport.js';
import { isResourceConversationParseResult } from '../src/core/parsers/parsingResult.js';
import { callDomainBroker, encodeDomainRecord, decodeDomainRecord } from '../src/core/storage/domain/transport.js';
import { __clearDomainMemory } from '../src/core/storage/domain/domainStore.js';

function opaqueCannotBecomeNative(raw: unknown): void {
    // @ts-expect-error Unknown input is not a typed native result.
    isResourceConversationParseResult(raw);
}
void opaqueCannotBecomeNative;

test('current extension reply preserves native identity; legacy and malformed envelopes are failures', async () => {
    const parsed = historicalFixture({ id: 'typed', messages: [{ role: 'user', content: 'Independent body' }] });
    assert.equal((await requestNativeDetail(async () => ({ success: true, domainEnvelopeVersion: 3, data: parsed }))).data, parsed);
    const batch = await requestNativeBatch(async () => ({ success: true, domainEnvelopeVersion: 3, results: [parsed, { error: 'deleted', isDeleted: true }] }));
    assert.equal(batch.success, true);
    if (batch.success) assert.equal(batch.results?.[0], parsed);
    for (const raw of [null, 42, {}, { success: true, data: parsed }, { success: true, domainEnvelopeVersion: 1, data: parsed }, { success: true, domainEnvelopeVersion: 2, data: parsed },
        { success: true, domainEnvelopeVersion: 3, data: { conversation: {} } },
        { success: true, domainEnvelopeVersion: 3, data: { error: 42 } }]) {
        assert.equal((await requestNativeDetail(async () => raw)).success, false);
    }
    for (const raw of [{ success: true, domainEnvelopeVersion: 3 }, { success: true, domainEnvelopeVersion: 3, results: [{}] },
        { success: true, domainEnvelopeVersion: 3, results: [], skipped: Infinity }]) {
        assert.equal((await requestNativeBatch(async () => raw)).success, false);
    }
    const aborted = await requestNativeBatch(async () => ({ success: false, aborted: true, error: 'aborted', retryAfterMs: 500 }));
    assert.equal(aborted.success, false);
    if (!aborted.success) { assert.equal(aborted.aborted, true); assert.equal(aborted.retryAfterMs, 500); }
    await assert.rejects(requestNativeDetail(async () => { throw new Error('transport offline'); }), /transport offline/);
});

test('authenticated storage transport requires version and preserves resource bytes and Domain graph', async () => {
    __clearDomainMemory();
    const parsed = historicalFixture({ id: 'broker', messages: [{ role: 'user', content: 'Body' }] });
    const record = await saveDomainConversation('10000000-0000-4000-8000-000000000001', parsed);
    assert.ok(record);
    const wire = encodeDomainRecord(record);
    assert.deepEqual(decodeDomainRecord(wire), record);
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    try {
        for (const version of [undefined, 1, 2, 3, 4]) {
            Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: { sendMessage: async () => ({ ok: true, value: wire, domainEnvelopeVersion: version }) } } });
            if (version === 3) assert.equal(await callDomainBroker('get', {}), wire);
            else await assert.rejects(callDomainBroker('get', {}), /Incompatible/);
        }
    } finally {
        if (previous) Object.defineProperty(globalThis, 'chrome', previous);
        else Reflect.deleteProperty(globalThis, 'chrome');
    }
});
