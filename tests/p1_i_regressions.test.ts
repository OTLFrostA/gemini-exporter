import { useIndexStorage } from './helpers/indexStorage.js';
import { ACCOUNT_UUID } from './helpers/accountRuntime.js';
useIndexStorage();
/**
 * tests/p1_i_regressions.test.ts
 * I 组「协议层与 provider 契约收尾」P1-075~080, P1-084, P1-088/089 回归测试。
 */
import type { GeminiLiveSaveTriggerPayload } from '../src/core/protocol/events.js';

const test = require('node:test');
const assert = require('node:assert');

const Proto = require('../src/core/protocol/protocol.js');
const { ProviderRegistryClass } = require('../src/core/provider/providerRegistry.js');
const { GeminiProvider } = require('../src/core/provider/gemini/geminiProvider.js');

function fakeProvider(id: string, opts: { matchesUrl?: (u: string) => boolean; hostPatterns?: string[] } = {}) {
    const p: any = { id, name: id, hostPatterns: opts.hostPatterns || [] };
    if (opts.matchesUrl) p.matchesUrl = opts.matchesUrl;
    return p;
}

// ---------------------------------------------------------------- P1-075
test('P1-075 - second DELETION_ANCHOR requires the c_ prefix (anchored discipline)', () => {
    // Unquoted GzXR5e followed by a BARE hex token (no c_) must NOT match:
    // this is exactly the false-positive the old (?:c_)? allowed.
    const decoy = 'GzXR5e something happened deadbeef00112233 nearby';
    assert.strictEqual(decoy.match(Proto.DELETION_ANCHORS[1]), null);

    // Unquoted GzXR5e followed by a real c_-prefixed id still matches (fallback kept).
    const real = '...GzXR5e...c_feedface12345678...';
    const m = real.match(Proto.DELETION_ANCHORS[1]);
    assert.ok(m, 'unquoted anchor must still extract c_-prefixed ids');
    assert.strictEqual(m![1], 'feedface12345678');

    // Quoted form unchanged.
    const quoted = `[["wrb.fr","GzXR5e","c_aabbccdd11223344",null]]`;
    const m0 = quoted.match(Proto.DELETION_ANCHORS[0]);
    assert.ok(m0);
    assert.strictEqual(m0![1], 'aabbccdd11223344');
});

// ---------------------------------------------------------------- P1-077
test('P1-077 - protocol self-mounts remain available without a globalThis mount', () => {
    assert.strictEqual(Proto.GeminiProtocol, Proto);
    assert.strictEqual(Proto.default, Proto);
    assert.strictEqual(Proto.CrossWorldEvents, Proto.EVENTS);
    assert.strictEqual((globalThis as any).GeminiProtocol, undefined);
});

// ------------------------------------------------------------- P1-078/079/080
test('P1-078 - duplicate registration of a DIFFERENT instance warns loudly', () => {
    const registry = new ProviderRegistryClass();
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => { warnings.push(args.join(' ')); };
    try {
        const first = fakeProvider('dup');
        const second = fakeProvider('dup');
        registry.register(first);
        // Same instance re-registered: silent no-op, no warning.
        registry.register(first);
        assert.strictEqual(warnings.length, 0, 'same-instance re-register must stay silent');
        // Different instance, same id: warn + overwrite.
        registry.register(second);
        assert.strictEqual(warnings.length, 1, 'different-instance duplicate must warn');
        assert.ok(warnings[0].includes('"dup"'), 'warning names the colliding id');
        assert.strictEqual(registry.get('dup'), second);
    } finally {
        console.warn = origWarn;
    }
});

test('P1-079 - setDefaultProviderId rejects unregistered ids', () => {
    const registry = new ProviderRegistryClass();
    assert.throws(() => registry.setDefaultProviderId('ghost'), /unregistered id "ghost"/);
    registry.register(fakeProvider('real'));
    registry.setDefaultProviderId('real');
    assert.strictEqual(registry.getDefault()?.id, 'real');
});

test('P1-080 - explicit matchesUrl=false is never overruled by hostPatterns', () => {
    const registry = new ProviderRegistryClass();
    registry.register(fakeProvider('strict', {
        matchesUrl: () => false, // explicit refusal...
        hostPatterns: ['https://example.com/*'], // ...with a broad pattern that must NOT win
    }));
    registry.register(fakeProvider('legacy', {
        hostPatterns: ['https://legacy.example.net/*'], // no matchesUrl at all
    }));
    assert.strictEqual(
        registry.findByUrl('https://example.com/page'), undefined,
        'explicit refusal must not fall back to hostPatterns'
    );
    assert.strictEqual(
        registry.findByUrl('https://legacy.example.net/x')?.id, 'legacy',
        'pattern-only providers still resolve via hostPatterns'
    );
});

// ------------------------------------------------------------- P1-081/082 (fixed by #356, locked here; Phase E: dormant)


// P1-084: TypeScript-checked contract (there is no useful runtime behavior here).
// These assignments are checked by npm run type-check; do not mock the consumer.
const acceptedLiveSaveTrigger: GeminiLiveSaveTriggerPayload = {
    cid: 'c_1', reason: 'turn_complete', mockMode: true
};
// @ts-expect-error: unknown payload fields must be rejected by the public type.
const rejectedLiveSaveTrigger: GeminiLiveSaveTriggerPayload = { cid: 'c_1', arbitraryField: 'not allowed' };
void acceptedLiveSaveTrigger;
void rejectedLiveSaveTrigger;

// ---------------------------------------------------------------- P1-085




// ---------------------------------------------------------------- P1-086


// ---------------------------------------------------------------- P1-087


// ---------------------------------------------------------------- P1-088
test('P1-088 - checkReadiness never passes the slot id off as the account name', async () => {
    // Runtime: stub credential resolution to force the ready:true branch.
    const credMgr = require('../src/core/api/client/credentialManager.js').default;
    const orig = credMgr.resolveCred;
    credMgr.resolveCred = async () => ({ sid: 's', at: 'a', bl: 'b', accountSlot: 'u0' });
    try {
        const readiness = await new GeminiProvider(undefined, async () => 'u0').checkReadiness(ACCOUNT_UUID);
        assert.strictEqual(readiness.ready, true);
        assert.equal('accountSlot' in readiness, false);
        assert.ok(
            readiness.accountName === undefined || readiness.accountName === null,
            `accountName must be absent/null, got: ${readiness.accountName}`
        );
    } finally {
        credMgr.resolveCred = orig;
    }
});

// ---------------------------------------------------------------- P1-089
test('P1-089 - gemini hostPatterns cover everything matchesUrl accepts', () => {
    const gemini = new GeminiProvider();
    assert.ok(gemini.matchesUrl('https://gemini.google.com/app'), 'gemini host matches');
    assert.ok(gemini.matchesUrl('https://bard.google.com/app'), 'legacy bard host matches');
    for (const host of ['https://gemini.google.com/', 'https://bard.google.com/']) {
        const registry = new ProviderRegistryClass();
        registry.register(gemini);
        assert.strictEqual(registry.findByUrl(host)?.id, 'gemini', `findByUrl resolves ${host}`);
    }
    assert.ok(
        (gemini.hostPatterns as string[]).includes('https://bard.google.com/*'),
        'hostPatterns must include the bard pattern'
    );
    assert.ok(!gemini.matchesUrl('https://chatgpt.com'), 'unrelated host still refused');
});

// ------------------------------------------------------------- P1-043/044 (Phase E: dormant — no pagination walk left)



