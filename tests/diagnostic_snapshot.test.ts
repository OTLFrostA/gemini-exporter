// tests/diagnostic_snapshot.test.ts - Unit tests for Full Sanitized State Mirror and Flight Recorder
export {};
const test = require('node:test');
const assert = require('node:assert');

const { FlightRecorder } = require('../src/runtime/diagnostics/flightRecorder.js');
// The flight recorder is a singleton; audited tests must leave no sensitive fixtures behind.
test.afterEach(() => FlightRecorder.clear());

test('flightRecorder: records events and automatically sanitizes sensitive fields', () => {
    FlightRecorder.clear();
    assert.strictEqual(FlightRecorder.getEntries().length, 0);

    FlightRecorder.record('workbench', 'button_click', { button: 'btnExport', safeNumber: 42 });
    FlightRecorder.record('storage', 'token_saved', {
        SNlM0e: 'super-secret-token',
        userCredential: 'secret-auth-key',
        authHeader: 'Bearer eyJhbGciOi...',
        apiKey: 'secret-key-1234',
        password: 'my-password',
        normalKey: 'visible-data',
        nested: { password: 'nested-private', label: 'visible-label' }
    });

    const entries = FlightRecorder.getEntries();
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].subsystem, 'workbench');
    assert.strictEqual(entries[0].action, 'button_click');
    assert.strictEqual(entries[0].details.button, 'btnExport');
    assert.strictEqual(entries[0].details.safeNumber, 42);

    // Verify sensitive tokens are redacted
    assert.strictEqual(entries[1].details.SNlM0e, '[REDACTED]');
    assert.strictEqual(entries[1].details.userCredential, '[REDACTED]');
    assert.strictEqual(entries[1].details.authHeader, '[REDACTED]');
    assert.strictEqual(entries[1].details.apiKey, '[REDACTED]');
    assert.strictEqual(entries[1].details.password, '[REDACTED]');
    assert.strictEqual(entries[1].details.normalKey, 'visible-data');
    assert.deepStrictEqual(entries[1].details.nested, { password: '[REDACTED]', label: 'visible-label' });

    // Verify in-memory buffer itself is eagerly redacted (zero raw sensitive tokens in memory)
    assert.strictEqual((FlightRecorder as any)._events[1].details.SNlM0e, '[REDACTED]', 'Internal in-memory event must be eagerly redacted');
});

// v2 retired the persistent sanitized state mirror and derived "updated"
// business state. Diagnostics retain only the bounded runtime FlightRecorder.
test('runtime diagnostic snapshots redact nested credentials and serialize safely', () => {
    FlightRecorder.record('export', 'failed', {
        accountId: '10000000-0000-4000-8000-000000000001',
        nested: { authorization: 'secret-auth', tokens: ['secret-token'], safe: 42 },
    });
    const json = JSON.stringify(FlightRecorder.getEntries());
    assert.ok(!json.includes('secret-auth') && !json.includes('secret-token'));
    const [entry] = JSON.parse(json);
    assert.strictEqual(entry.details.nested.safe, 42);
    assert.strictEqual(entry.details.nested.authorization, '[REDACTED]');
});

test('diagnostic buffer remains bounded and old snapshots survive clear without persistent session state', () => {
    for (let index = 0; index < 305; index++) FlightRecorder.record('export', 'progress', { index });
    const snapshot = FlightRecorder.getEntries();
    assert.strictEqual(snapshot.length, 300);
    assert.strictEqual(snapshot[0].details.index, 5);
    assert.strictEqual(snapshot[299].details.index, 304);
    FlightRecorder.clear();
    assert.strictEqual(FlightRecorder.getEntries().length, 0);
    assert.strictEqual(snapshot.length, 300);
});

test('diagnostics bound long values and deep objects without changing the caller input', () => {
    const details = { text: 'x'.repeat(1000), list: Array.from({ length: 20 }, (_, i) => i), deep: { a: { b: { c: { password: 'private-value' } } } } };
    const before = structuredClone(details);
    FlightRecorder.record('content', 'observation', details);
    assert.deepStrictEqual(details, before);
    const [entry] = FlightRecorder.getEntries();
    assert.ok(entry.details.text.length < 1000);
    assert.ok(entry.details.list.length < 20);
    assert.ok(!JSON.stringify(entry).includes('private-value'));
});
