import { describe as __suiteDescribe } from 'node:test';
import { type TestContext } from "node:test";
import test from "node:test";
import assert from "node:assert/strict";
import { type GeminiClientCredentialManagerModule } from "../src/l1/client/gemini/api/credentialManager.js";
import { type GeminiCredentials } from "../src/l1/client/gemini/api/credentialManager.js";
import { resolveCred } from "../src/l1/client/gemini/api/credentialManager.js";
import { updateCredential } from "../src/l1/client/gemini/api/credentialManager.js";
import RetryPolicy from "../src/l1/client/gemini/api/retryPolicy.js";
import { handleHttp400 } from "../src/l1/client/gemini/api/retryPolicy.js";
import { withCredMapLock } from "../src/l1/client/gemini/api/credStorage.js";
import { initGeminiCredentialCapture } from "../src/runtime/background/geminiCredentialCapture.js";
import { GEMINI_RPC_CREDENTIALS } from "../src/shared/types/geminiRpcCredentials.js";

__suiteDescribe("credential_manager_batch_c3", () => {
const test = require('node:test');
const assert = require('node:assert');

function bustRequireCache(p: string) {
    try {
        delete require.cache[require.resolve(p)];
    } catch { /* ignore */ }
}

function getFreshCredManager() {
    bustRequireCache('../src/l1/client/gemini/api/credStorage.js');
    bustRequireCache('../src/l1/client/gemini/api/credentialManager.js');
    return require('../src/l1/client/gemini/api/credentialManager.js');
}

function makeMockStorage(initialData: Record<string, unknown> = {}) {
    const data: Record<string, unknown> = JSON.parse(JSON.stringify(initialData));
    return {
        data,
        get: async (keys: string[]) => {
            const out: Record<string, unknown> = {};
            for (const k of keys) {
                if (k in data) out[k] = data[k];
            }
            return out;
        },
        set: async (items: Record<string, unknown>) => {
            Object.assign(data, JSON.parse(JSON.stringify(items)));
        },
        remove: async (keys: string[]) => {
            for (const k of keys) {
                delete data[k];
            }
        }
    };
}

test('1. BL extraction precedence and cache: HTML sources only', (t: TestContext) => {
    const credManager = getFreshCredManager();
    const globals = globalThis as Record<string, unknown>;
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    t.after(() => {
        if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
        else delete globals.document;
    });

    // Both blCfb2hFromHtml and blAssistantFromHtml present: blCfb2hFromHtml wins
    const docBoth = {
        documentElement: {
            innerHTML: 'start "cfb2h":"bl_primary" middle "bl":"boq_assistant-secondary" end'
        }
    };
    globals.document = docBoth;
    assert.strictEqual(credManager.getBlFromPage(), 'bl_primary', 'blCfb2hFromHtml should take highest precedence');

    // Only blAssistantFromHtml present ("bl":"boq_assistant...")
    const docAssistant = {
        documentElement: {
            innerHTML: 'prefix "bl":"boq_assistant-bard-web-server_2026" suffix'
        }
    };
    globals.document = docAssistant;
    assert.strictEqual(credManager.getBlFromPage(), 'boq_assistant-bard-web-server_2026', 'blAssistantFromHtml should be used when primary pattern absent');

    // A writerless legacy global must not supply BL credentials.
    globals.document = { documentElement: { innerHTML: '<div>no bl tokens here</div>' } };
    assert.strictEqual(credManager.getBlFromPage(), null, 'unmatched HTML must not supply a BL token');
});

test('2. AT extraction precedence: __gemExporterExtractAt -> cache -> _WIZ_global_data -> WIZ_global_data -> script scan -> full HTML -> empty', (t: TestContext) => {
    const credManager = getFreshCredManager();
    const P = require('../src/l1/protocol/gemini/protocol.js').default;
    const globals = globalThis as Record<string, unknown>;
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    t.after(() => {
        if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
        else delete globals.document;
    });

    // A. __gemExporterExtractAt wins over everything
    try {
        (globalThis as Record<string, unknown>).__gemExporterExtractAt = () => 'at_from_extract_fn';
        assert.strictEqual(credManager.getAtFromPage(), 'at_from_extract_fn', '__gemExporterExtractAt should be highest priority');
    } finally {
        delete (globalThis as Record<string, unknown>).__gemExporterExtractAt;
    }

    // B. _WIZ_global_data wins over WIZ_global_data and scripts
    try {
        (globalThis as Record<string, unknown>)._WIZ_global_data = { [P.TOKENS.AT]: 'at_wiz_1' };
        (globalThis as Record<string, unknown>).WIZ_global_data = { [P.TOKENS.AT]: 'at_wiz_2' };
        const doc = {
            documentElement: { innerHTML: '<html>"SNlM0e":"at_in_html"</html>' }
        };
        globals.document = doc;
        assert.strictEqual(credManager.getAtFromPage(), 'at_wiz_1', '_WIZ_global_data wins over WIZ_global_data');
    } finally {
        delete (globalThis as Record<string, unknown>)._WIZ_global_data;
        delete (globalThis as Record<string, unknown>).WIZ_global_data;
    }

    // C. WIZ_global_data wins over scripts
    try {
        (globalThis as Record<string, unknown>).WIZ_global_data = { [P.TOKENS.AT]: 'at_wiz_plain' };
        const doc = {
            documentElement: { innerHTML: '<html>"SNlM0e":"at_in_html_script"</html>' },
            querySelectorAll: () => [{ textContent: '"SNlM0e":"at_in_script_query"' }]
        };
        globals.document = doc;
        assert.strictEqual(credManager.getAtFromPage(), 'at_wiz_plain', 'WIZ_global_data wins over scripts');
    } finally {
        delete (globalThis as Record<string, unknown>).WIZ_global_data;
    }

    // D. script scan wins over full HTML scan
    const docScript = {
        documentElement: { innerHTML: '<html>"SNlM0e":"at_in_html_tail"</html>' },
        querySelectorAll: () => [{ textContent: 'var a = 1; "SNlM0e":"at_from_query_script";' }]
    };
    globals.document = docScript;
    assert.strictEqual(credManager.getAtFromPage(), 'at_from_query_script', 'querySelectorAll scripts wins over HTML regex');

    // E. full HTML scan when no scripts matched
    const docHtml = {
        documentElement: { innerHTML: '<div>content with "SNlM0e":"at_full_html" in body</div>' },
        querySelectorAll: () => []
    };
    globals.document = docHtml;
    assert.strictEqual(credManager.getAtFromPage(), 'at_full_html', 'full HTML scan fallback');

    // F. empty fallback
    const docNone = {
        documentElement: { innerHTML: '<div>plain text</div>' },
        querySelectorAll: () => []
    };
    globals.document = docNone;
    assert.strictEqual(credManager.getAtFromPage(), '', 'returns empty string when no AT tokens found');
});

test('External Wiz globals reject malformed token values before cache admission', (t: TestContext) => {
    const globals = globalThis as Record<string, unknown>;
    const names = ['document', '__gemExporterExtractAt', '_WIZ_global_data', 'WIZ_global_data'];
    const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
    t.after(() => names.forEach((name, i) => {
        if (previous[i]) Object.defineProperty(globalThis, name, previous[i]);
        else delete globals[name];
    }));

    const P = require('../src/l1/protocol/gemini/protocol.js').default;
    const manager = getFreshCredManager();
    delete globals.__gemExporterExtractAt;
    globals.document = { documentElement: { innerHTML: '<div>no AT token</div>' }, querySelectorAll: () => [] };
    globals._WIZ_global_data = { [P.TOKENS.AT]: 123 };
    globals.WIZ_global_data = { [P.TOKENS.AT]: ['invalid'] };
    assert.equal(manager.getAtFromPage(), '', 'malformed external Wiz values must not be cached as credentials');

    globals.WIZ_global_data = { [P.TOKENS.AT]: 'validated-at' };
    assert.equal(manager.getAtFromPage(), 'validated-at', 'the first valid fallback token is still accepted');
});

test('3. Slot detection: explicit path -> pathname -> u0 to default -> catch to default', () => {
    const credManager = getFreshCredManager();

    // explicit path
    assert.strictEqual(credManager.detectSlot('https://gemini.google.com/u/2/app'), 'u2', 'detects u2 from explicit url');
    assert.strictEqual(credManager.detectSlot('/u/3/app'), 'u3', 'detects u3 from pathname');

    // u0 maps to default
    assert.strictEqual(credManager.detectSlot('/u/0/app'), 'default', 'u0 maps to default');
    assert.strictEqual(credManager.detectSlot('https://gemini.google.com/u/0/'), 'default', 'u0 maps to default');

    // default path without slot
    assert.strictEqual(credManager.detectSlot('/app'), 'default', 'path without /u/N/ maps to default');

    // fallback when invalid/empty
    assert.strictEqual(credManager.detectSlot(''), 'default', 'empty path falls back to default');
    assert.strictEqual(credManager.detectSlot(null), 'default', 'null path falls back to default');
});

test('4. Valid map load from storage', async () => {
    const origChrome = (globalThis as Record<string, unknown>).chrome;
    const mock = makeMockStorage({
        gemini_credentials_map: {
            s1: { sid: 's1', at: 'at1', bl: 'bl1', accountSlot: 'default', lastUsed: 1000 },
            s2: { sid: 's2', at: 'at2', bl: 'bl2', accountSlot: 'u1', lastUsed: 2000 }
        }
    });
    (globalThis as Record<string, unknown>).chrome = { storage: { session: mock, local: mock } };
    try {
        const credManager = getFreshCredManager();
        const first = await credManager.resolveCred('s1');
        const second = await credManager.resolveCred('s2');
        assert.strictEqual(first.sid, 's1');
        assert.strictEqual(first.at, 'at1');
        assert.strictEqual(second.accountSlot, 'u1');
        assert.strictEqual(second.lastUsed, 2000);
        assert.strictEqual(Object.keys(mock.data.gemini_credentials_map as object).length, 2);
    } finally {
        (globalThis as Record<string, unknown>).chrome = origChrome;
    }
});

test('C3 review: array-shaped credential map is rejected, never selected or rewritten', async (t: TestContext) => {
    const globals = globalThis as Record<string, unknown>;
    const previousChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    t.after(() => {
        if (previousChrome) Object.defineProperty(globalThis, 'chrome', previousChrome);
        else delete globals.chrome;
        if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
        else delete globals.document;
    });

    const malformed = [{ sid: 'array_sid', at: 'array_at', bl: 'array_bl', accountSlot: 'default' }];
    const mock = makeMockStorage({ gemini_credentials_map: malformed });
    globals.chrome = { storage: { session: mock, local: mock } };
    delete globals.document;

    const manager = getFreshCredManager();
    const resolved = await manager.resolveCred('default');
    assert.notStrictEqual(resolved.sid, 'array_sid', 'positional credentials are not selected');
    assert.strictEqual(resolved.at, '', 'tokens from malformed array map are never reused');
    assert.deepStrictEqual(mock.data.gemini_credentials_map, malformed, 'invalid stored data is not rewritten');
});

test('8. Newest same-slot credential selected by lastUsed ordering', async () => {
    const origChrome = (globalThis as Record<string, unknown>).chrome;
    const mock = makeMockStorage({
        gemini_credentials_map: {
            old_cred: { sid: 'old_cred', at: 'at_old', bl: 'bl_common', accountSlot: 'default', lastUsed: 100 },
            mid_cred: { sid: 'mid_cred', at: 'at_mid', bl: 'bl_common', accountSlot: 'default', lastUsed: 500 },
            new_cred: { sid: 'new_cred', at: 'at_new', bl: 'bl_common', accountSlot: 'default', lastUsed: 999 }
        }
    });
    (globalThis as Record<string, unknown>).chrome = { storage: { session: mock, local: mock } };
    try {
        const credManager = getFreshCredManager();
        const resolved = await credManager.resolveCred('default');
        assert.strictEqual(resolved.sid, 'new_cred', 'most recently used credential in slot should be selected');
        assert.strictEqual(resolved.at, 'at_new');
    } finally {
        (globalThis as Record<string, unknown>).chrome = origChrome;
    }
});

test('9. Explicit target SID selection', async () => {
    const origChrome = (globalThis as Record<string, unknown>).chrome;
    const mock = makeMockStorage({
        gemini_credentials_map: {
            cred_a: { sid: 'cred_a', at: 'at_a', bl: 'bl_a', accountSlot: 'default', lastUsed: 1000 },
            cred_b: { sid: 'cred_b', at: 'at_b', bl: 'bl_b', accountSlot: 'default', lastUsed: 500 }
        }
    });
    (globalThis as Record<string, unknown>).chrome = { storage: { session: mock, local: mock } };
    try {
        const credManager = getFreshCredManager();
        // Request explicit cred_b even though cred_a is newer
        const resolved = await credManager.resolveCred('cred_b');
        assert.strictEqual(resolved.sid, 'cred_b', 'explicit SID must win');
        assert.strictEqual(resolved.at, 'at_b');
    } finally {
        (globalThis as Record<string, unknown>).chrome = origChrome;
    }
});

test('10. CRITICAL INVARIANT: NEVER borrow credentials from another account slot', async () => {
    const origChrome = (globalThis as Record<string, unknown>).chrome;
    const mock = makeMockStorage({
        gemini_credentials_map: {
            cred_default: { sid: 'sid_default', at: 'secret_default_at', bl: 'bl_default', accountSlot: 'default' },
            cred_u1: { sid: 'sid_u1', at: 'secret_u1_at', bl: 'bl_u1', accountSlot: 'u1' }
        }
    });
    (globalThis as Record<string, unknown>).chrome = { storage: { session: mock, local: mock } };
    try {
        const credManager = getFreshCredManager();

        // Request credentials for slot 'u2' which has NO stored credentials
        const resolved = await credManager.resolveCred('u2');

        // MUST NOT borrow sid_default or sid_u1!
        assert.notStrictEqual(resolved.sid, 'sid_default', 'Must never borrow from default slot');
        assert.notStrictEqual(resolved.sid, 'sid_u1', 'Must never borrow from u1 slot');
        assert.notStrictEqual(resolved.at, 'secret_default_at', 'Must never leak tokens from default slot');
        assert.notStrictEqual(resolved.at, 'secret_u1_at', 'Must never leak tokens from u1 slot');
        assert.strictEqual(resolved.accountSlot, 'u2');
    } finally {
        (globalThis as Record<string, unknown>).chrome = origChrome;
    }
});

test('11. Page fallback only for matching slot', async () => {
    const origChrome = (globalThis as Record<string, unknown>).chrome;
    const mock = makeMockStorage({
        gemini_credentials_map: {
            cred_default: { sid: 'sid_default', at: 'stored_token', bl: 'bl_default', accountSlot: 'default', lastUsed: 100 }
        }
    });
    (globalThis as Record<string, unknown>).chrome = { storage: { session: mock, local: mock } };
    const P = require('../src/l1/protocol/gemini/protocol.js').default;

    // Simulate page on slot 'default' with page AT token and mock document
    (globalThis as Record<string, unknown>).document = {
        documentElement: { innerHTML: 'page content' }
    };
    (globalThis as Record<string, unknown>)._WIZ_global_data = { [P.TOKENS.AT]: 'live_page_at' };
    try {
        const credManager = getFreshCredManager();

        // When requesting slot 'u3' while on default page (no stored creds for u3):
        // Must NOT attach default page's live_page_at to slot u3!
        const resolvedOtherSlot = await credManager.resolveCred('u3');
        assert.strictEqual(resolvedOtherSlot.accountSlot, 'u3');
        assert.strictEqual(resolvedOtherSlot.at, '', 'Page AT must not be attached to mismatched slot');

        // When page URL matches requested slot (e.g. simulate location on /u/3/app)
        (globalThis as Record<string, unknown>).location = { pathname: '/u/3/app' };
        const resolvedMatchedSlot = await credManager.resolveCred('u3');
        assert.strictEqual(resolvedMatchedSlot.accountSlot, 'u3');
        assert.strictEqual(resolvedMatchedSlot.at, 'live_page_at', 'Page AT attached when page slot matches requested slot');
    } finally {
        delete (globalThis as Record<string, unknown>).location;
        delete (globalThis as Record<string, unknown>)._WIZ_global_data;
        delete (globalThis as Record<string, unknown>).document;
        (globalThis as Record<string, unknown>).chrome = origChrome;
    }
});

test('12. Explicit overrides win over stored values', async () => {
    const origChrome = (globalThis as Record<string, unknown>).chrome;
    const mock = makeMockStorage({
        gemini_credentials_map: {
            my_sid: { sid: 'my_sid', at: 'stored_at', bl: 'stored_bl', accountSlot: 'default' }
        }
    });
    (globalThis as Record<string, unknown>).chrome = { storage: { session: mock, local: mock } };
    try {
        const credManager = getFreshCredManager();
        const overrides = {
            at: 'override_at',
            bl: 'override_bl',
            accountSlot: 'override_slot'
        };
        const resolved = await credManager.resolveCred('my_sid', overrides);
        assert.strictEqual(resolved.sid, 'my_sid');
        assert.strictEqual(resolved.at, 'override_at', 'override.at must take precedence');
        assert.strictEqual(resolved.bl, 'override_bl', 'override.bl must take precedence');
        assert.strictEqual(resolved.accountSlot, 'override_slot', 'override.accountSlot must take precedence');
    } finally {
        (globalThis as Record<string, unknown>).chrome = origChrome;
    }
});

test('13. Resolve queue survives prior failure without deadlock', async () => {
    const origChrome = (globalThis as Record<string, unknown>).chrome;
    let failNextLoad = true;
    const mock = {
        get: async () => {
            if (failNextLoad) {
                failNextLoad = false;
                throw new Error('transient storage error');
            }
            return {
                gemini_credentials_map: {
                    healthy_sid: { sid: 'healthy_sid', at: 'healthy_at', bl: 'healthy_bl', accountSlot: 'default' }
                }
            };
        },
        set: async () => {},
        remove: async () => {}
    };
    (globalThis as Record<string, unknown>).chrome = { storage: { session: mock, local: mock } };
    try {
        const credManager = getFreshCredManager();

        // First call fails due to storage error (simulated)
        const call1 = credManager.resolveCred('healthy_sid');
        const res1 = await call1;
        assert.ok(res1, 'first call resolves even on storage error with fallback');

        // Subsequent call succeeds and loads healthy credentials
        const res2 = await credManager.resolveCred('healthy_sid');
        assert.strictEqual(res2.sid, 'healthy_sid');
        assert.strictEqual(res2.at, 'healthy_at');
    } finally {
        (globalThis as Record<string, unknown>).chrome = origChrome;
    }
});

test('14. Missing historical fields remain missing during load and credential resolution', async () => {
    const origChrome = (globalThis as Record<string, unknown>).chrome;
    const mock = makeMockStorage({
        gemini_credentials_map: {
            hist_1: { sid: 'hist_1', at: 'tok_1' }
        }
    });
    (globalThis as Record<string, unknown>).chrome = { storage: { session: mock, local: mock } };
    try {
        const credManager = getFreshCredManager();
        const stored = (mock.data.gemini_credentials_map as Record<string, Record<string, unknown>>).hist_1;
        assert.ok(stored, 'entry must exist');
        assert.strictEqual(stored.sid, 'hist_1');
        assert.strictEqual(stored.at, 'tok_1');
        assert.strictEqual(stored.bl, undefined, 'bl must not be synthesized');
        assert.strictEqual(stored.accountSlot, undefined, 'accountSlot must not be synthesized');
        assert.strictEqual(stored.lastUsed, undefined, 'lastUsed must not be synthesized');

        // Reading a credential map must not write back invented metadata.
        const storedMap = mock.data.gemini_credentials_map as Record<string, Record<string, unknown>>;
        assert.strictEqual(storedMap.hist_1.bl, undefined);
        assert.strictEqual(storedMap.hist_1.accountSlot, undefined);
        assert.strictEqual(storedMap.hist_1.lastUsed, undefined);

        // resolveCred on hist_1 must preserve lack of accountSlot and not inject accountSlot: 'default'
        const resolved = await credManager.resolveCred('hist_1');
        assert.strictEqual(resolved.accountSlot, undefined, 'accountSlot must not be synthesized in resolved object');
        assert.strictEqual(resolved.sid, 'hist_1');
    } finally {
        (globalThis as Record<string, unknown>).chrome = origChrome;
    }
});

test('15. Extension metadata remains intact during page BL writeback', async () => {
    const origChrome = (globalThis as Record<string, unknown>).chrome;
    const mock = makeMockStorage({
        gemini_credentials_map: {
            ext_1: { sid: 'ext_1', at: 'tok_1', bl: 'ext_1_bl', customMeta: 'custom_123', flags: [1, 2, 3] },
            ext_2: { sid: 'ext_2', at: 'tok_2', accountSlot: 'default', customPluginData: { alpha: true } }
        }
    });
    (globalThis as Record<string, unknown>).chrome = { storage: { session: mock, local: mock } };
    try {
        const credManager = getFreshCredManager();
        (globalThis as Record<string, unknown>).document = {
            documentElement: { innerHTML: '<div>"cfb2h":"bl_backfill_123"</div>' }
        };
        const resolved = await credManager.resolveCred('ext_2');
        assert.strictEqual(resolved.sid, 'ext_2');
        assert.strictEqual(resolved.bl, 'bl_backfill_123');
        const updatedStored = mock.data.gemini_credentials_map as Record<string, Record<string, unknown>>;
        assert.strictEqual(updatedStored.ext_2.bl, 'bl_backfill_123', 'bl backfilled in storage');
        assert.deepStrictEqual(updatedStored.ext_2.customPluginData, { alpha: true }, 'extension data survives bl writeback');
        assert.strictEqual(updatedStored.ext_1.customMeta, 'custom_123', 'unrelated metadata remains unchanged');
        assert.deepStrictEqual(updatedStored.ext_1.flags, [1, 2, 3], 'unrelated array metadata remains unchanged');
    } finally {
        delete (globalThis as Record<string, unknown>).document;
        (globalThis as Record<string, unknown>).chrome = origChrome;
    }
});

test('16. Numeric SID is preserved when resolving stored credentials', async () => {
    const origChrome = (globalThis as Record<string, unknown>).chrome;
    const mock = makeMockStorage({
        gemini_credentials_map: {
            '987654321': { sid: 987654321, at: 'numeric_at', bl: 'numeric_bl', accountSlot: 'default' }
        }
    });
    (globalThis as Record<string, unknown>).chrome = { storage: { session: mock, local: mock } };
    try {
        const credManager = getFreshCredManager();
        const bySid = await credManager.resolveCred('987654321');
        assert.strictEqual(bySid.sid, 987654321);
        assert.strictEqual(bySid.at, 'numeric_at');
        assert.strictEqual(bySid.bl, 'numeric_bl');
        const bySlot = await credManager.resolveCred('default');
        assert.strictEqual(bySlot.sid, 987654321);
        assert.strictEqual(bySlot.at, 'numeric_at');
        assert.deepStrictEqual(mock.data.gemini_credentials_map, {
            '987654321': { sid: 987654321, at: 'numeric_at', bl: 'numeric_bl', accountSlot: 'default' }
        });
    } finally {
        (globalThis as Record<string, unknown>).chrome = origChrome;
    }
});

test('C3 review: existing entries without SID are not repaired on either selection path', async () => {
    const glob = globalThis as Record<string, unknown>;
    const previous = glob.chrome;
    const entry = { at: 'kept_at', bl: 'kept_bl', lastUsed: '100', extension: { retained: true } };
    const mock = makeMockStorage({ gemini_credentials_map: { stored_key: entry } });
    glob.chrome = { storage: { session: mock, local: mock } };
    try {
        const manager = getFreshCredManager();
        for (const target of ['stored_key', 'default']) {
            const result = await manager.resolveCred(target);
            assert.strictEqual(Object.hasOwn(result, 'sid'), false);
            assert.strictEqual(Object.hasOwn(result, 'accountSlot'), false);
            assert.strictEqual(result.lastUsed, '100');
            assert.deepStrictEqual(result.extension, entry.extension);
        }
        assert.deepStrictEqual(mock.data.gemini_credentials_map, { stored_key: entry });
    } finally { glob.chrome = previous; }
});

test('C3 review: numeric SID HTTP diagnostics use the real SID contract', async () => {
    const glob = globalThis as Record<string, unknown>;
    const previousChrome = glob.chrome;
    const previousFetch = glob.fetch;
    const mock = makeMockStorage({ gemini_credentials_map: {
        '12345': { sid: 12345, at: 'diagnostic_at', bl: 'diagnostic_bl', accountSlot: 'default' }
    } });
    glob.chrome = { storage: { session: mock, local: mock } };
    glob.fetch = async () => new Response('diagnostic failure', { status: 418 });
    try {
        getFreshCredManager();
        bustRequireCache('../src/l1/client/gemini/geminiClient.js');
        const Client = require('../src/l1/client/gemini/geminiClient.js').GeminiAPIClient;
        await assert.rejects(new Client().getConversationList(null, '12345'), /sidLen:5/);
    } finally { glob.chrome = previousChrome; glob.fetch = previousFetch; }
});

test('email cannot route credentials even when a stored key matches it', async () => {
    const glob = globalThis as Record<string, unknown>;
    const previous = glob.chrome;
    const raw = { 'alice@example.com': { sid: 'session', at: 'token', bl: 'build', accountSlot: 'u0' } };
    const mock = makeMockStorage({ gemini_credentials_map: raw });
    glob.chrome = { storage: { session: mock, local: mock } };
    try {
        await assert.rejects(getFreshCredManager().resolveCred('alice@example.com'), /Email is not a credential routing identity/);
        assert.deepEqual(mock.data.gemini_credentials_map, raw);
    } finally { glob.chrome = previous; }
});

test('accountId-scoped resolveCred never borrows another Google account credential in the same URL slot', async () => {
    const glob = globalThis as Record<string, unknown>;
    const previous = glob.chrome;
    const accA = '11111111-1111-4111-8111-111111111111';
    const accB = '22222222-2222-4222-8222-222222222222';
    const mock = makeMockStorage({
        gemini_credentials_map: {
            sid_a: { sid: 'sid_a', at: 'at_from_account_a', bl: 'bl_a', accountSlot: 'u0', accountId: accA, lastUsed: 2000 },
            sid_b: { sid: 'sid_b', at: 'at_from_account_b', bl: 'bl_b', accountSlot: 'u0', accountId: accB, lastUsed: 1000 },
        },
    });
    glob.chrome = { storage: { session: mock, local: mock } };
    try {
        const cm = getFreshCredManager();
        const forB = await cm.resolveCred('u0', { accountId: accB });
        assert.strictEqual(forB.sid, 'sid_b');
        assert.strictEqual(forB.at, 'at_from_account_b');
        const missingC = await cm.resolveCred('u0', { accountId: '33333333-3333-4333-8333-333333333333' });
        assert.strictEqual(missingC.at, '', 'must not borrow sid_a or sid_b when neither matches accountId');
    } finally { glob.chrome = previous; }
});

test('bootstrap ensureCreds scopes page tokens strictly by (slot, accountId) without mutating u1 credentials', async () => {
    const glob = globalThis as Record<string, unknown>;
    const saved = ['chrome', 'window', 'location', 'document'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);
    const accU0 = '11111111-1111-4111-8111-111111111111';
    const accU1 = '22222222-2222-4222-8222-222222222222';
    const mock = makeMockStorage({
        gemini_credentials_map: {
            sid_u1: { sid: 'sid_u1', at: 'secret_u1_token_123456', bl: 'boq_u1', accountSlot: 'u1', accountId: accU1, lastUsed: 999999 },
        },
    });
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
        runtime: { id: 'ext', sendMessage: async (msg: Record<string, unknown>) => {
            if (msg.action === 'ensureV2Ready') return { ok: true };
            return { ok: true, value: { id: accU0, providerId: 'gemini', providerAccountId: 'gaia-u0' } };
        } },
        storage: { session: mock, local: mock },
    } });
    Object.defineProperty(globalThis, 'location', { configurable: true, value: {
        href: 'https://gemini.google.com/u/0/app', origin: 'https://gemini.google.com', hostname: 'gemini.google.com', pathname: '/u/0/app',
    } });
    const msgListeners: Array<(e: unknown) => void> = [];
    const winMock: Record<string, unknown> = {
        __gemExporterExtractedAt: 'fresh_u0_xsrf_token_abcdef',
        addEventListener(type: string, fn: (e: unknown) => void) { if (type === 'message') msgListeners.push(fn); },
        removeEventListener(type: string, fn: (e: unknown) => void) {
            const idx = msgListeners.indexOf(fn);
            if (idx >= 0) msgListeners.splice(idx, 1);
        },
        postMessage(msg: { type?: string; payload?: { requestId?: string } }) {
            if (msg?.type === 'GEMINI_ACCOUNT_REQUESTED' && msg.payload?.requestId) {
                const reply = {
                    source: winMock,
                    origin: 'https://gemini.google.com',
                    data: {
                        type: 'GEMINI_ACCOUNT_OBSERVED',
                        payload: {
                            requestId: msg.payload.requestId,
                            slot: 'u0',
                            observation: { providerId: 'gemini', providerAccountId: 'gaia-u0' },
                        },
                    },
                };
                for (const fn of [...msgListeners]) fn(reply);
            }
        },
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: winMock });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
        readyState: 'complete', querySelectorAll: () => [], documentElement: { innerHTML: '' },
        addEventListener() {}, removeEventListener() {},
    } });
    try {
        bustRequireCache('../src/l1/client/gemini/api/credStorage.js');
        bustRequireCache('../src/runtime/content/accountContext.js');
        bustRequireCache('../src/runtime/content/installContentHost.js');
        bustRequireCache('../src/l1/client/gemini/bootstrap.js');
        require('../src/runtime/content/installContentHost.js').installContentRuntimeHost();
        const acctCtx = require('../src/runtime/content/accountContext.js');
        const { createGeminiAccountAdapter } = require('../src/runtime/content/adapters/geminiAccountAdapter.js');
        acctCtx.configureAccountAdapter(createGeminiAccountAdapter());
        await acctCtx.resolveCurrentAccount({ providerId: 'gemini', providerAccountId: 'gaia-u0' }, 'u0');
        const { ensureCreds } = require('../src/l1/client/gemini/bootstrap.js');
        await ensureCreds();
        const savedMap = mock.data.gemini_credentials_map as Record<string, Record<string, unknown>>;
        assert.strictEqual(savedMap.sid_u1.at, 'secret_u1_token_123456', 'u1 credential must remain untouched');
        assert.strictEqual(savedMap.sid_u1.accountSlot, 'u1');
        const u0Entries = Object.values(savedMap).filter(e => e.accountSlot === 'u0');
        assert.strictEqual(u0Entries.length, 1, 'u0 must receive its own isolated credential entry');
        assert.strictEqual(u0Entries[0].at, 'fresh_u0_xsrf_token_abcdef');
        assert.strictEqual(u0Entries[0].accountId, accU0);
    } finally {
        for (const [k, desc] of saved) {
            if (desc) Object.defineProperty(globalThis, k, desc);
            else delete glob[k];
        }
    }
});
});

__suiteDescribe("cred_storage_unify", () => {
const test = require('node:test');
const assert = require('node:assert');

// Shared credential storage owns the session-to-local downgrade. Reload only
// the three modules under test, then restore their original require.cache and
// Chrome globals so the suite cannot change module singletons for other tests.
const modulePaths = [
    '../src/l1/client/gemini/api/credStorage.js',
    '../src/l1/client/gemini/api/credentialManager.js',
    '../src/l1/client/gemini/bootstrap.js',
];

async function withCredentialModules<T>(
    chromeMock: unknown,
    check: (modules: { credStorage: any; credManager: any; bootstrap: any }) => Promise<T> | T,
): Promise<T> {
    const g = globalThis as any;
    const chromeDescriptor = Object.getOwnPropertyDescriptor(g, 'chrome');
    const ids = modulePaths.map((p) => require.resolve(p));
    const previous = ids.map((id: string) => require.cache[id]);
    if (chromeMock === undefined) delete g.chrome;
    else Object.defineProperty(g, 'chrome', { value: chromeMock, writable: true, configurable: true });
    try {
        for (const id of ids) delete require.cache[id];
        const credStorage = require('../src/l1/client/gemini/api/credStorage.js');
        const credManager = require('../src/l1/client/gemini/api/credentialManager.js').default;
        const bootstrap = require('../src/l1/client/gemini/bootstrap.js');
        return await check({ credStorage, credManager, bootstrap });
    } finally {
        ids.forEach((id: string, i: number) => {
            if (previous[i]) require.cache[id] = previous[i];
            else delete require.cache[id];
        });
        if (chromeDescriptor) Object.defineProperty(g, 'chrome', chromeDescriptor);
        else delete g.chrome;
    }
}

function makeChromeMock(sessionFailure: 'get' | 'set' | null) {
    const sessionCalls: string[] = [];
    const denied = new Error('not allowed to access chrome.storage.session');
    const stores: Record<string, Record<string, any>> = { local: {}, session: {} };
    const area = (name: 'local' | 'session') => ({
        get: async (keys: any) => {
            if (name === 'session') sessionCalls.push('get');
            if (name === 'session' && sessionFailure === 'get') throw denied;
            const out: Record<string, any> = {};
            for (const k of (Array.isArray(keys) ? keys : [keys])) {
                if (Object.prototype.hasOwnProperty.call(stores[name], k)) out[k] = stores[name][k];
            }
            return out;
        },
        set: async (items: any) => {
            if (name === 'session') sessionCalls.push('set');
            if (name === 'session' && sessionFailure === 'set') throw denied;
            Object.assign(stores[name], structuredClone(items));
        },
        remove: async (keys: any) => {
            if (name === 'session') sessionCalls.push('remove');
            for (const k of (Array.isArray(keys) ? keys : [keys])) delete stores[name][k];
        },
    });
    return { mock: { storage: { local: area('local'), session: area('session') } }, stores, sessionCalls };
}

test('unified: every surface prefers a healthy session and reads its credentials', async () => {
    const { mock, stores } = makeChromeMock(null);
    await withCredentialModules(mock, async ({ credStorage, credManager, bootstrap }) => {
        assert.strictEqual(bootstrap.getCredStorage(), mock.storage.session);
        assert.strictEqual(credStorage.getCredStorage(), mock.storage.session);
        await bootstrap.saveCredentials(new Map([['u0', { at: 'fake-token' }]]));
        assert.deepStrictEqual(await bootstrap.loadCredentialsMap(), new Map([['u0', { at: 'fake-token' }]]));
        assert.strictEqual((await credManager.resolveCred('default')).at, 'fake-token');
        assert.equal(Object.keys(stores.session).length > 0, true, 'healthy session must hold the saved map');
    });
});

test('unified: session read denial downgrades all surfaces and subsequent I/O to local', async () => {
    const { mock, stores, sessionCalls } = makeChromeMock('get');
    await withCredentialModules(mock, async ({ credStorage, credManager, bootstrap }) => {
        assert.deepStrictEqual(await bootstrap.loadCredentialsMap(), new Map());
        assert.deepStrictEqual(sessionCalls, ['get'], 'initial session denial must be exercised');
        for (const surface of [credStorage, bootstrap]) {
            assert.strictEqual(surface.getCredStorage(), mock.storage.local, 'every surface must share the downgrade');
        }
        sessionCalls.length = 0;
        const map = { u0: { at: 'read-fallback' } };
        await bootstrap.saveCredentials(new Map(Object.entries(map)));
        assert.deepStrictEqual(await bootstrap.loadCredentialsMap(), new Map(Object.entries(map)));
        assert.strictEqual((await credManager.resolveCred('default')).at, 'read-fallback');
        assert.deepStrictEqual(sessionCalls, [], 'no session I/O after the shared downgrade');
        assert.ok(Object.values(stores.local).some(value => JSON.stringify(value) === JSON.stringify(map)),
            'fallback must persist credentials in local storage');
    });
});

test('unified: session write denial also downgrades all surfaces and retains the credential map', async () => {
    const { mock, stores, sessionCalls } = makeChromeMock('set');
    await withCredentialModules(mock, async ({ credStorage, credManager, bootstrap }) => {
        const map = { u1: { at: 'write-fallback' } };
        await bootstrap.saveCredentials(new Map(Object.entries(map)));
        assert.deepStrictEqual(sessionCalls, ['set'], 'actual session write rejection must be exercised');
        assert.deepStrictEqual(await bootstrap.loadCredentialsMap(), new Map(Object.entries(map)));
        assert.strictEqual((await credManager.resolveCred('default')).at, 'write-fallback');
        for (const surface of [credStorage, bootstrap]) {
            assert.strictEqual(surface.getCredStorage(), mock.storage.local);
        }
        assert.ok(Object.values(stores.local).some(value => JSON.stringify(value) === JSON.stringify(map)));
        assert.deepStrictEqual(sessionCalls, ['set'], 'retry and read must not touch a denied session');
    });
});

test('unified: shared resolver state and missing browser storage remain explicit', async () => {
    const { mock } = makeChromeMock(null);
    await withCredentialModules(mock, ({ credStorage }) => {
        assert.strictEqual(credStorage.getCredStorage(), mock.storage.session);
        credStorage.markCredSessionAccessFailed();
        assert.strictEqual(credStorage.getCredStorage(), mock.storage.local);
    });
    await withCredentialModules({ storage: { local: mock.storage.local } }, ({ credStorage }) => {
        assert.strictEqual(credStorage.getCredStorage(), mock.storage.local, 'missing session uses local');
    });
    await withCredentialModules(undefined, ({ credStorage }) => {
        assert.strictEqual(credStorage.getCredStorage(), null, 'no Chrome storage returns null');
    });
});
});

__suiteDescribe("credential_map_ingress", () => {
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type CredentialPorts = [
    Assert<Equal<Extract<keyof GeminiClientCredentialManagerModule, 'loadCredMap' | 'getCredStorage'>, never>>,
    Assert<Equal<Awaited<ReturnType<GeminiClientCredentialManagerModule['resolveCred']>>, GeminiCredentials>>,
];
const contracts: CredentialPorts = [true, true];
void contracts;

function storage(t: import('node:test').TestContext, map: unknown) {
    const previous = new Map(['chrome', 'document', 'location'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    t.after(() => {
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    });
    Reflect.deleteProperty(globalThis, 'document');
    Reflect.deleteProperty(globalThis, 'location');
    const data = { gemini_credentials_map: map };
    let writes = 0, removals = 0;
    const session = {
        get: async () => structuredClone(data),
        set: async (items: object) => { writes++; Object.assign(data, structuredClone(items)); },
    };
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { storage: {
        session, local: { remove: async () => { removals++; } },
    } } });
    return { data, writes: () => writes, removals: () => removals };
}

test('credential ingress rejects invalid fields on direct SID and slot selection without erasing raw neighbors', async t => {
    const valid = { sid: 123, at: 'valid', bl: 'build', accountSlot: 'default', lastUsed: '100', extension: { kept: true } };
    const invalid = {
        badSid: { ...valid, sid: {} }, badAt: { ...valid, at: 7 }, badBl: { ...valid, bl: false },
        badSlot: { ...valid, accountSlot: [] }, badTime: { ...valid, lastUsed: {} },
        array: [valid], primitive: 'not-a-credential', empty: null,
    };
    const raw = { ...invalid, valid };
    const env = storage(t, raw);
    for (const sid of Object.keys(invalid)) assert.equal((await resolveCred(sid)).at, 'valid');
    assert.equal((await resolveCred('default')).sid, 123);
    assert.deepEqual(env.data.gemini_credentials_map, raw);
    assert.equal(env.writes(), 0);
    await updateCredential(123, () => ({ patch: { at: 'not-a-stored-key' } }));
    assert.equal(env.writes(), 0, 'SID field is not a substitute for the persisted map key');
    await updateCredential('valid', () => ({ patch: { at: 'fresh' } }));
    assert.deepEqual(env.data.gemini_credentials_map, { ...invalid, valid: { ...valid, at: 'fresh' } });
    assert.equal(env.removals(), 1);
});

test('HTTP refresh ignores inherited credential keys and preserves explicitly stored special keys', async t => {
    const env = storage(t, {});
    const params = { resp: { status: 400 }, cred: { sid: '__proto__', at: 'old' }, getAtFromPage: () => 'fresh', getBlFromPage: () => null };
    assert.equal((await handleHttp400(params)).shouldRetry, true);
    assert.equal(env.writes(), 0, 'inherited Object.prototype is not a stored credential');
    assert.equal(env.removals(), 0);
    env.data.gemini_credentials_map = JSON.parse('{"__proto__":{"at":"old","extension":{"kept":true}},"neighbor":17}');
    await handleHttp400(params);
    assert.deepEqual(env.data.gemini_credentials_map, JSON.parse('{"__proto__":{"at":"fresh","extension":{"kept":true}},"neighbor":17}'));
    assert.equal(env.writes(), 1);
});

test('credential mutation preserves refresh-specific cleanup and deletes only the expired entry', async t => {
    const env = storage(t, { stale: { at: 'old', sid: 'stale', extension: true }, other: false });
    await updateCredential('stale', () => ({ patch: { at: 'fresh' }, clearLocal: false }));
    assert.deepEqual(env.data.gemini_credentials_map, { stale: { at: 'fresh', sid: 'stale', extension: true }, other: false });
    assert.equal(env.removals(), 0, '401 refresh preserves the existing cleanup policy');
    await updateCredential('stale', () => ({ patch: null }));
    assert.deepEqual(env.data.gemini_credentials_map, { other: false });
    assert.equal(env.removals(), 1);
    await updateCredential('missing', () => ({ patch: null }));
    assert.equal(env.writes(), 2);
});


test('queued 401 observes page rotation after acquiring the credential lock', async t => {
    const env = storage(t, { session: { sid: 'session', at: 'old' } });
    let release = () => {};
    let entered = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const acquired = new Promise<void>(resolve => { entered = resolve; });
    t.after(() => release());
    const held = withCredMapLock(async () => { entered(); await gate; });
    await acquired;
    let pageAt = 'old', reads = 0;
    const queued = RetryPolicy.handleHttp401({ cred: { sid: 'session', at: 'old' },
        refreshAtFromPage: () => { reads++; return pageAt; } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, 0, 'refresh/delete decision must wait for the same read-modify-write lock');
    pageAt = 'rotated-while-queued';
    release();
    await held;
    await queued;
    assert.deepEqual(env.data.gemini_credentials_map, { session: { sid: 'session', at: pageAt } });
    assert.equal(env.removals(), 0);
});


function currentGeminiPage(t: import('node:test').TestContext, pathname: string) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, '__gemExporterExtractAt');
    t.after(() => {
        if (previous) Object.defineProperty(globalThis, '__gemExporterExtractAt', previous);
        else Reflect.deleteProperty(globalThis, '__gemExporterExtractAt');
    });
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { pathname } });
    Object.defineProperty(globalThis, '__gemExporterExtractAt', { configurable: true, value: () => 'PAGE_AT_CURRENT' });
}

test('page AT never initializes another requested slot from an empty credential map', async t => {
    const env = storage(t, {});
    currentGeminiPage(t, '/app');
    const foreign = await resolveCred('u2');
    assert.equal(foreign.accountSlot, 'u2');
    assert.equal(foreign.at, '');
    assert.equal(env.writes(), 0, 'page token must not be persisted under the foreign slot');

    const current = await resolveCred('default');
    assert.equal(current.accountSlot, 'default');
    assert.equal(current.at, 'PAGE_AT_CURRENT');
    assert.equal(env.writes(), 1, 'the same page may initialize its own slot');
});

test('explicit foreign SID with missing token never borrows the current page AT', async t => {
    const raw = {
        foreign: { sid: 'foreign', at: '', bl: 'BL_FOREIGN', accountSlot: 'u2' },
        current: { sid: 'current', at: 'CURRENT_STORED', accountSlot: 'default' },
    };
    const env = storage(t, raw);
    currentGeminiPage(t, '/app');
    const resolved = await resolveCred('foreign');
    assert.equal(resolved.sid, 'foreign');
    assert.equal(resolved.accountSlot, 'u2');
    assert.equal(resolved.at, '');
    assert.equal(env.writes(), 0);
    assert.deepEqual(env.data.gemini_credentials_map, raw);
});

test('matching-slot page AT backfill keeps exact keys, foreign accounts and extra fields', async t => {
    const raw = {
        foreign: { sid: 'foreign', at: '', accountSlot: 'u2', extension: { untouched: true } },
        current: { sid: 'current', at: '', bl: 'BL_CURRENT', accountSlot: 'default',
            extension: { kept: true } },
        other: { sid: 'other', at: 'TOKEN_OTHER', accountSlot: 'u3' },
    };
    const env = storage(t, raw);
    currentGeminiPage(t, '/app');
    const resolved = await resolveCred('default');
    assert.equal(resolved.sid, 'current');
    assert.equal(resolved.at, 'PAGE_AT_CURRENT');
    assert.equal(resolved.bl, 'BL_CURRENT');
    assert.deepEqual(env.data.gemini_credentials_map, {
        ...raw, current: { ...raw.current, at: 'PAGE_AT_CURRENT', lastUsed: resolved.lastUsed },
    });
    assert.equal(env.writes(), 1);
    assert.equal(env.removals(), 1);
});

test('credential selection rejects invalid SID, lastUsed and slot values without erasing raw storage', async t => {
    const healthy = { sid: 'healthy', at: 'HEALTHY_AT', accountSlot: 'default', lastUsed: 300 };
    const invalid = {
        sidNaN: { ...healthy, sid: NaN },
        sidInfinity: { ...healthy, sid: Infinity },
        sidNegative: { ...healthy, sid: -2 },
        sidFraction: { ...healthy, sid: 2.5 },
        timeInfinity: { ...healthy, lastUsed: Infinity },
        timeStringInfinity: { ...healthy, lastUsed: 'Infinity' },
        timeStringOverflow: { ...healthy, lastUsed: '1e309' },
        timeNegative: { ...healthy, lastUsed: -1 },
        timeUnsafe: { ...healthy, lastUsed: Number.MAX_SAFE_INTEGER + 1 },
        slotPath: { ...healthy, accountSlot: 'u2/../../' },
        slotUnknown: { ...healthy, accountSlot: 'foreign-account-uuid' },
    };
    const raw = {
        ...invalid, healthy,
        legacy: { sid: 12345, at: 'LEGACY_AT', accountSlot: '/u/2', lastUsed: '101' },
        largeNumericSid: { sid: 1e19, at: 'LARGE_SID', accountSlot: 'u3' },
    };
    const env = storage(t, raw);
    for (const key of Object.keys(invalid)) {
        const result = await resolveCred(key);
        assert.equal(result.at, 'HEALTHY_AT', key);
        assert.equal(result.sid, 'healthy', key);
    }
    const latest = await resolveCred('default');
    assert.equal(latest.sid, 'healthy');
    const legacy = await resolveCred('u2');
    assert.equal(legacy.at, 'LEGACY_AT');
    assert.equal(legacy.accountSlot, 'u2', 'historical URL-style slots normalize only in the trusted view');
    const largeSid = await resolveCred('largeNumericSid');
    assert.equal(largeSid.sid, 1e19, 'historic large numeric SIDs must remain readable');
    assert.equal(env.writes(), 0);
    assert.deepEqual(env.data.gemini_credentials_map, raw);
});

test('credential mutation retains a captured local storage reference across async browser teardown', async t => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    t.after(() => {
        if (previous) Object.defineProperty(globalThis, 'chrome', previous);
        else Reflect.deleteProperty(globalThis, 'chrome');
    });
    const data = { gemini_credentials_map: { stored: { sid: 'stored', at: 'old' } } };
    let removed = 0;
    const local = { remove: async () => { removed++; } };
    const session = {
        get: async () => structuredClone(data),
        set: async (items: object) => {
            Object.assign(data, structuredClone(items));
            Reflect.deleteProperty(globalThis, 'chrome');
        },
    };
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { storage: { session, local } } });
    await updateCredential('stored', () => ({ patch: { at: 'new' } }));
    assert.equal(data.gemini_credentials_map.stored.at, 'new');
    assert.equal(removed, 1, 'cleanup must use the acquired local reference without re-reading chrome');
});
});

__suiteDescribe("credential_rmw_race", () => {
const test = require('node:test');
const assert = require('node:assert');
const { handleHttp400 } = require('../src/l1/client/gemini/api/retryPolicy.js');

test('concurrent credential refreshes preserve updates to both SIDs', async () => {
    const originalChrome = (global as any).chrome;
    const data: Record<string, any> = { gemini_credentials_map: {
        sid1: { sid: 'sid1', at: 'old1' }, sid2: { sid: 'sid2', at: 'old2' }
    } };
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const firstSet = new Promise<void>(resolve => { entered = resolve; });
    let writes = 0;
    const localWrites: unknown[] = [];
    const localRemovals: string[][] = [];
    const sessionStorage = {
        get: async () => ({ gemini_credentials_map: JSON.parse(JSON.stringify(data.gemini_credentials_map)) }),
        set: async (obj: any) => {
            if (++writes === 1) { entered(); await gate; }
            Object.assign(data, JSON.parse(JSON.stringify(obj)));
        }
    };
    (global as any).chrome = { storage: {
        session: sessionStorage,
        local: {
            set: async (obj: unknown) => { localWrites.push(obj); },
            remove: async (keys: string[]) => { localRemovals.push(keys); }
        }
    } };
    const params = (sid: string, at: string) => ({
        resp: { status: 400 }, snippet: 'xsrf', cred: { sid, at: 'old' }, isRetried: false,
        getAtFromPage: () => at, getBlFromPage: () => null
    });
    try {
        const first = handleHttp400(params('sid1', 'new1'));
        await firstSet;
        const second = handleHttp400(params('sid2', 'new2'));
        await new Promise(resolve => setImmediate(resolve));
        release();
        const [firstResult, secondResult] = await Promise.all([first, second]);
        assert.strictEqual(firstResult.shouldRetry, true);
        assert.strictEqual(secondResult.shouldRetry, true);
        assert.strictEqual(firstResult.freshAt, 'new1');
        assert.strictEqual(secondResult.freshAt, 'new2');
        assert.strictEqual(writes, 2, 'each credential refresh must be persisted to session storage');
        assert.deepStrictEqual(data.gemini_credentials_map, {
            sid1: { sid: 'sid1', at: 'new1' },
            sid2: { sid: 'sid2', at: 'new2' }
        }, 'both account tokens must survive serialized read-modify-write');
        assert.deepStrictEqual(localWrites, [], 'refresh must never persist tokens to chrome.storage.local');
        assert.strictEqual(localRemovals.length, 2, 'legacy disk copies must be cleaned after each successful refresh');
    } finally {
        release();
        (global as any).chrome = originalChrome;
    }
});
});

__suiteDescribe("gemini_credential_capture", () => {
type RequestDetails = chrome.webRequest.OnBeforeRequestDetails;

test('Gemini native credentials go only to the initiating document, with URL/form precedence', t => {
    const origin = 'https://gemini.google.com';
    const url = origin + '/u/1/_/BardChatUi/data/batchexecute?f.sid=fixture-sid&bl=fixture-build&_reqid=123';
    const request: RequestDetails = {
        url, initiator: origin, frameId: 0, tabId: 42, documentId: 'document-id',
        parentFrameId: -1, method: 'POST', type: 'xmlhttprequest', timeStamp: 1, requestId: '42',
    };
    let receive: ((details: RequestDetails) => void) | undefined;
    const sendMessage = t.mock.fn(async (_tabId: number, _message: unknown, _options: chrome.tabs.MessageSendOptions) => {});
    const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    t.after(() => {
        if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
        else Reflect.deleteProperty(globalThis, 'chrome');
    });
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
        tabs: { sendMessage },
        webRequest: { onBeforeRequest: { addListener: (listener: typeof receive) => { receive = listener; } } },
    } });
    initGeminiCredentialCapture();
    assert.ok(receive);
    for (const partial of [
        { frameId: 1 }, { tabId: -1 }, { documentId: undefined },
        { initiator: 'chrome-extension://extension-id' },
        { method: 'GET' }, { url: origin + '/no-rpc?next=batchexecute' },
        { url: origin + '/batchexecute?f.sid=fixture-sid' },
        { url: origin + '/_/BardChatUi/data/batchexecute' },
    ]) receive({ ...request, ...partial });
    assert.equal(sendMessage.mock.callCount(), 0);

    const raw = (...chunks: string[]) => ({ raw: chunks.map(chunk => ({ bytes: new TextEncoder().encode(chunk).buffer })) });
    const cases: [string, RequestDetails['requestBody'], string][] = [
        ['&at=url%20token', { formData: { at: ['body token'] } }, 'url token'],
        ['', { formData: { at: ['form token'] } }, 'form token'],
        ['', raw('request=1&a%74=form', '+token%2B%25'), 'form token+%'],
        ['', raw('f.req=at=decoy&format=wrong'), ''],
    ];
    for (const [query, requestBody, at] of cases) {
        receive({ ...request, url: url + query, requestBody });
        assert.deepEqual(sendMessage.mock.calls.at(-1)?.arguments, [42, {
            action: GEMINI_RPC_CREDENTIALS,
            requestId: '123',
            payload: { at, sid: 'fixture-sid', bl: 'fixture-build', accountSlot: 'u1' },
        }, { documentId: 'document-id' }]);
    }
});
});

__suiteDescribe("known_issue_credentials_session", () => {
// Credential security: session-only persistence, no local-storage leakage, and targeted 401 eviction.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const code = require('esbuild').buildSync({ stdin: { resolveDir: path.join(__dirname, '..'), loader: 'ts', contents: `
    import { installContentRuntimeHost } from './src/runtime/content/installContentHost.ts';
    installContentRuntimeHost();
    export * from './src/l1/client/gemini/bootstrap.ts';
` }, bundle: true, write: false, format: 'iife', globalName: 'TestBootstrap', logLevel: 'silent' }).outputFiles[0].text;
const protocolCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'l1', 'protocol', 'gemini', 'protocol.js'), 'utf8');

function makeContext() {
    const ctx: Record<string, any> = {
        console: { log: () => {}, warn: () => {}, debug: () => {} },
        crypto: require('node:crypto').webcrypto,
        setTimeout, clearTimeout, queueMicrotask,
        URL,
        chrome: {
            runtime: {
                id: 'test-extension',
                sendMessage: async (message: any) => message.action === 'ensureV2Ready' ? {ok:true} : ({ok:true,value:{id:'10000000-0000-4000-8000-000000000003',providerId:message.providerId,providerAccountId:message.providerAccountId}}),
                onMessage: { addListener: (receive: Function) => { ctx.receiveRuntime = receive; }, removeListener: () => {} },
            },
            storage: {
                local: {
                    get: async (keys: any) => {
                        const keyList = Array.isArray(keys) ? keys : [keys];
                        const out: Record<string, any> = {};
                        for (const k of keyList) {
                            if (ctx.__localData && Object.prototype.hasOwnProperty.call(ctx.__localData, k)) {
                                out[k] = ctx.__localData[k];
                            }
                        }
                        return out;
                    },
                    set: async (items: any) => {
                        ctx.__localWrites.push(items);
                        ctx.__localData = ctx.__localData || {};
                        Object.assign(ctx.__localData, JSON.parse(JSON.stringify(items)));
                    },
                    remove: async () => {}
                },
                session: {
                    get: async (keys: any) => {
                        const keyList = Array.isArray(keys) ? keys : [keys];
                        const out: Record<string, any> = {};
                        for (const k of keyList) {
                            if (ctx.__sessionData && Object.prototype.hasOwnProperty.call(ctx.__sessionData, k)) {
                                out[k] = ctx.__sessionData[k];
                            }
                        }
                        return out;
                    },
                    set: async (items: any) => {
                        ctx.__sessionWrites.push(items);
                        ctx.__sessionData = ctx.__sessionData || {};
                        Object.assign(ctx.__sessionData, JSON.parse(JSON.stringify(items)));
                    },
                    remove: async (keys: any) => {
                        const keyList = Array.isArray(keys) ? keys : [keys];
                        for (const k of keyList) {
                            if (ctx.__sessionData) delete ctx.__sessionData[k];
                        }
                    }
                }
            }
        },
        addEventListener: () => {},
        removeEventListener: () => {},
        __localWrites: [],
        __sessionWrites: [],
        __sessionData: {}
    };
    ctx.window = ctx;
    ctx.document = {
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
        documentElement: { innerHTML: '' }
    };
    ctx.location = { origin: 'https://gemini.google.com', href: 'https://gemini.google.com/u/0/app', pathname: '/u/0/app' };
    ctx.localStorage = { getItem: () => null, setItem: () => {} };
    ctx.sessionStorage = { getItem: () => null, setItem: () => {} };
    vm.createContext(ctx);
    // This storage-focused fixture has no Gaia. Model the real MAIN-world
    // response so identity discovery completes before credential assertions.
    vm.runInContext(`
        const accountListeners = new Set();
        window.addEventListener = (type, listener) => { if (type === 'message') accountListeners.add(listener); };
        window.removeEventListener = (type, listener) => { if (type === 'message') accountListeners.delete(listener); };
        window.postMessage = message => {
            if (message.type !== 'GEMINI_ACCOUNT_REQUESTED') return;
            queueMicrotask(() => {
                const event = { source: window, origin: location.origin, data: {
                    type: 'GEMINI_ACCOUNT_OBSERVED', payload: { requestId: message.payload.requestId, slot: 'u0', observation: null }
                } };
                for (const listener of [...accountListeners]) listener(event);
            });
        };
    `, ctx);
    return ctx;
}

test('p1-lock: session tokens live in chrome.storage.session, never in chrome.storage.local', async () => {
    const ctx = makeContext();
    ctx.WIZ_global_data = { SNlM0e: 'ATTEST0123456789abcdef' };

    // Mirror the browser load order: protocol.js loads before bootstrap.js.
    vm.runInContext(protocolCode, ctx, { filename: 'protocol.js' });
    vm.runInContext(code, ctx, { filename: 'bootstrap.js' });
    ctx.TestBootstrap.initBootstrap();
    // bootstrap runs ensureCreds() at load; let its async chain settle.
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    const credKeys = (w: any) => 'gemini_credentials' in w || 'gemini_credentials_map' in w;
    const wroteLocal = ctx.__localWrites.some(credKeys);
    const wroteSession = ctx.__sessionWrites.some(credKeys);

    assert.ok(wroteSession, 'credentials must be persisted to chrome.storage.session (memory-scoped)');
    assert.ok(
        !wroteLocal,
        'credentials must NOT be written to chrome.storage.local — plaintext tokens on disk survive logout ' +
        'and are readable by any extension code. Migrate to chrome.storage.session (+401/logout cleanup).'
    );
});

test('CredentialManager credentials storage uses chrome.storage.session and does not leak to local', async () => {
    const CredentialManager = require('../src/l1/client/gemini/api/credentialManager.js').default || require('../src/l1/client/gemini/api/credentialManager.js');
    const localStore: Record<string, any> = {};
    const sessionStore: Record<string, any> = { gemini_credentials_map: { test_sid: { at: 'test_at', sid: 'test_sid' } } };
    const originalChromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    (global as any).chrome = {
        storage: {
            local: {
                get: async (keys: any) => {
                    const out: Record<string, any> = {};
                    for (const k of (Array.isArray(keys) ? keys : [keys])) {
                        if (localStore[k]) out[k] = JSON.parse(JSON.stringify(localStore[k]));
                    }
                    return out;
                },
                set: async (items: any) => {
                    Object.assign(localStore, JSON.parse(JSON.stringify(items)));
                },
                remove: async (keys: any) => {
                    for (const k of (Array.isArray(keys) ? keys : [keys])) delete localStore[k];
                }
            },
            session: {
                get: async (keys: any) => {
                    const out: Record<string, any> = {};
                    for (const k of (Array.isArray(keys) ? keys : [keys])) {
                        if (sessionStore[k]) out[k] = JSON.parse(JSON.stringify(sessionStore[k]));
                    }
                    return out;
                },
                set: async (items: any) => {
                    Object.assign(sessionStore, JSON.parse(JSON.stringify(items)));
                },
                remove: async (keys: any) => {
                    for (const k of (Array.isArray(keys) ? keys : [keys])) delete sessionStore[k];
                }
            }
        }
    };
    try {
        const resolved = await CredentialManager.resolveCred('test_sid');
        assert.strictEqual(resolved.at, 'test_at');
        assert.strictEqual(sessionStore.gemini_credentials_map?.test_sid?.at, 'test_at');
        assert.strictEqual(localStore.gemini_credentials_map, undefined, 'credentials must never be written to local store on read');
    } finally {
        if (originalChromeDescriptor) Object.defineProperty(globalThis, 'chrome', originalChromeDescriptor);
        else Reflect.deleteProperty(globalThis, 'chrome');
    }
});

test('GeminiAPIClient 401 evicts only the expired SID from session storage', async () => {
    const { GeminiAPIClient } = require('../src/l1/client/gemini/geminiClient.js');
    const originalChromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    const sessionStore: Record<string, any> = {
        gemini_credentials_map: {
            bad_sid: { at: 'bad_token', sid: 'bad_sid', accountSlot: 'default' },
            healthy_sid: { at: 'healthy_token', sid: 'healthy_sid', accountSlot: 'u2' }
        }
    };
    const localStore: Record<string, any> = {};
    (global as any).chrome = {
        storage: {
            local: {
                get: async () => ({ ...localStore }),
                set: async (items: any) => Object.assign(localStore, items),
                remove: async (keys: any) => { for (const k of [keys].flat()) delete localStore[k]; }
            },
            session: {
                get: async (keys: any) => {
                    const out: Record<string, any> = {};
                    for (const k of [keys].flat()) {
                        if (sessionStore[k]) out[k] = JSON.parse(JSON.stringify(sessionStore[k]));
                    }
                    return out;
                },
                set: async (items: any) => Object.assign(sessionStore, JSON.parse(JSON.stringify(items))),
                remove: async (keys: any) => { for (const k of [keys].flat()) delete sessionStore[k]; }
            }
        }
    };

    try {
        const client = new GeminiAPIClient();
        (global as any).fetch = async () => ({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            text: async () => 'Unauthorized'
        });

        await assert.rejects(
            () => client.getConversationList(null, 'bad_sid'),
            (error: unknown) => error instanceof Error && error.message.includes('401'),
            'expired credentials must surface an HTTP 401 to the caller'
        );
        assert.strictEqual(sessionStore.gemini_credentials_map.bad_sid, undefined, '401 must evict the expired SID');
        assert.deepStrictEqual(sessionStore.gemini_credentials_map.healthy_sid,
            { at: 'healthy_token', sid: 'healthy_sid', accountSlot: 'u2' },
            'evicting one account must retain another account credential');
        assert.strictEqual(localStore.gemini_credentials_map, undefined, '401 handling must not copy secrets into local storage');
    } finally {
        if (originalFetchDescriptor) Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor);
        else Reflect.deleteProperty(globalThis, 'fetch');
        if (originalChromeDescriptor) Object.defineProperty(globalThis, 'chrome', originalChromeDescriptor);
        else Reflect.deleteProperty(globalThis, 'chrome');
    }
});


test('bootstrap stores a new special-key SID as an own entry and ignores inherited credentials', async () => {
    const ctx = makeContext();
    ctx.__sessionData.gemini_credentials_map = { neighbor: { sid: 'neighbor', at: 'kept' } };
    vm.runInContext(code, ctx, { filename: 'bootstrap.js' });
    ctx.TestBootstrap.initBootstrap();
    await new Promise(resolve => setImmediate(resolve));
    for (const sid of ['__proto__', 'constructor']) {
        ctx.receiveRuntime({ action: 'geminiRpcCredentials', payload: { sid, at: 'fresh', accountSlot: 'u0' } }, { id: 'test-extension' });
        await new Promise(resolve => setImmediate(resolve));
        const stored = ctx.__sessionData.gemini_credentials_map;
        assert.ok(Object.hasOwn(stored, sid), 'new SID must survive object serialization');
        assert.equal(stored[sid].at, 'fresh');
        assert.equal(stored[sid].name, undefined, 'an inherited constructor must not become prior credential metadata');
        assert.equal(stored.neighbor.at, 'kept');
    }
});

test('bootstrap retains stored at token on empty runtime updates and never logs raw tokens in dev mode', async () => {
    const logged: string[] = [];
    const ctx = makeContext();
    ctx.__gemExporterDevMode = true;
    ctx.__gemExporterExtractedAt = 'SECRET_AT_TOKEN_VALUE_1234567890';
    ctx.document.documentElement.innerHTML = '"cfb2h":"boq_assistant-bard-web-server_secret_build"';
    ctx.console = {
        log: (...args: unknown[]) => logged.push(args.map(String).join(' ')),
        warn: (...args: unknown[]) => logged.push(args.map(String).join(' ')),
        debug: (...args: unknown[]) => logged.push(args.map(String).join(' ')),
    };
    vm.runInContext(code, ctx, { filename: 'bootstrap.js' });
    ctx.TestBootstrap.initBootstrap();
    await new Promise(resolve => setImmediate(resolve));

    ctx.receiveRuntime({ action: 'geminiRpcCredentials', payload: { sid: 'sid_keep', at: 'PERSISTED_AT_TOKEN_999', bl: 'bl_1', accountSlot: 'u0' } }, { id: 'test-extension' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ctx.__sessionData.gemini_credentials_map.sid_keep.at, 'PERSISTED_AT_TOKEN_999');

    // Subsequent message with empty `at` must not overwrite the previously stored `at`
    ctx.receiveRuntime({ action: 'geminiRpcCredentials', payload: { sid: 'sid_keep', at: '', bl: 'bl_2', accountSlot: 'u0' } }, { id: 'test-extension' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ctx.__sessionData.gemini_credentials_map.sid_keep.at, 'PERSISTED_AT_TOKEN_999');
    assert.equal(ctx.__sessionData.gemini_credentials_map.sid_keep.bl, 'bl_2');

    const allLogs = logged.join('\n');
    assert.equal(allLogs.includes('SECRET_AT_TOKEN'), false, 'raw extracted at token prefix must never enter console logs');
    assert.equal(allLogs.includes('boq_assistant-bard-web-server_secret_build'), false, 'raw bl build string must never enter console logs');
});
});
