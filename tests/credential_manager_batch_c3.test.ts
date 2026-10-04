export {};
const test = require('node:test');
const assert = require('node:assert');

function bustRequireCache(p: string) {
    try {
        delete require.cache[require.resolve(p)];
    } catch { /* ignore */ }
}

function getFreshCredManager() {
    bustRequireCache('../src/core/api/client/credStorage.js');
    bustRequireCache('../src/core/api/client/credentialManager.js');
    return require('../src/core/api/client/credentialManager.js');
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

test('1. BL extraction precedence and cache: blCfb2hFromHtml -> blAssistantFromHtml -> __gemExporterBl', () => {
    const credManager = getFreshCredManager();

    // Both blCfb2hFromHtml and blAssistantFromHtml present: blCfb2hFromHtml wins
    const docBoth = {
        documentElement: {
            innerHTML: 'start "cfb2h":"bl_primary" middle "bl":"boq_assistant-secondary" end'
        }
    };
    assert.strictEqual(credManager.getBlFromPage(docBoth), 'bl_primary', 'blCfb2hFromHtml should take highest precedence');

    // Only blAssistantFromHtml present ("bl":"boq_assistant...")
    const docAssistant = {
        documentElement: {
            innerHTML: 'prefix "bl":"boq_assistant-bard-web-server_2026" suffix'
        }
    };
    assert.strictEqual(credManager.getBlFromPage(docAssistant), 'boq_assistant-bard-web-server_2026', 'blAssistantFromHtml should be used when primary pattern absent');

    // Neither present in doc, but glob.__gemExporterBl present
    const origWindow = (globalThis as Record<string, unknown>).window;
    try {
        (globalThis as Record<string, unknown>).__gemExporterBl = 'bl_from_glob';
        const docEmpty = {
            documentElement: {
                innerHTML: '<div>no bl tokens here</div>'
            }
        };
        assert.strictEqual(credManager.getBlFromPage(docEmpty), 'bl_from_glob', '__gemExporterBl should be fallback when patterns absent');
    } finally {
        delete (globalThis as Record<string, unknown>).__gemExporterBl;
        if (origWindow !== undefined) (globalThis as Record<string, unknown>).window = origWindow;
    }
});

test('2. AT extraction precedence: __gemExporterExtractAt -> cache -> _WIZ_global_data -> WIZ_global_data -> script scan -> full HTML -> empty', () => {
    const credManager = getFreshCredManager();
    const P = require('../src/core/protocol/protocol.js').default;

    // A. __gemExporterExtractAt wins over everything
    const origExtractAt = (globalThis as Record<string, unknown>).__gemExporterExtractAt;
    try {
        (globalThis as Record<string, unknown>).__gemExporterExtractAt = () => 'at_from_extract_fn';
        assert.strictEqual(credManager.getAtFromPage(), 'at_from_extract_fn', '__gemExporterExtractAt should be highest priority');
    } finally {
        delete (globalThis as Record<string, unknown>).__gemExporterExtractAt;
    }

    // B. _WIZ_global_data wins over WIZ_global_data and scripts
    const origWiz = (globalThis as Record<string, unknown>)._WIZ_global_data;
    const origWiz2 = (globalThis as Record<string, unknown>).WIZ_global_data;
    try {
        (globalThis as Record<string, unknown>)._WIZ_global_data = { [P.TOKENS.AT]: 'at_wiz_1' };
        (globalThis as Record<string, unknown>).WIZ_global_data = { [P.TOKENS.AT]: 'at_wiz_2' };
        const doc = {
            documentElement: { innerHTML: '<html>"SNlM0e":"at_in_html"</html>' }
        };
        assert.strictEqual(credManager.getAtFromPage(doc), 'at_wiz_1', '_WIZ_global_data wins over WIZ_global_data');
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
        assert.strictEqual(credManager.getAtFromPage(doc), 'at_wiz_plain', 'WIZ_global_data wins over scripts');
    } finally {
        delete (globalThis as Record<string, unknown>).WIZ_global_data;
    }

    // D. script scan wins over full HTML scan
    const docScript = {
        documentElement: { innerHTML: '<html>"SNlM0e":"at_in_html_tail"</html>' },
        querySelectorAll: () => [{ textContent: 'var a = 1; "SNlM0e":"at_from_query_script";' }]
    };
    assert.strictEqual(credManager.getAtFromPage(docScript), 'at_from_query_script', 'querySelectorAll scripts wins over HTML regex');

    // E. full HTML scan when no scripts matched
    const docHtml = {
        documentElement: { innerHTML: '<div>content with "SNlM0e":"at_full_html" in body</div>' },
        querySelectorAll: () => []
    };
    assert.strictEqual(credManager.getAtFromPage(docHtml), 'at_full_html', 'full HTML scan fallback');

    // F. empty fallback
    const docNone = {
        documentElement: { innerHTML: '<div>plain text</div>' },
        querySelectorAll: () => []
    };
    assert.strictEqual(credManager.getAtFromPage(docNone), '', 'returns empty string when no AT tokens found');
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
        const map = await credManager.loadCredMap();
        assert.strictEqual(Object.keys(map).length, 2);
        assert.strictEqual(map.s1.sid, 's1');
        assert.strictEqual(map.s1.at, 'at1');
        assert.strictEqual(map.s2.accountSlot, 'u1');
        assert.strictEqual(map.s2.lastUsed, 2000);
    } finally {
        (globalThis as Record<string, unknown>).chrome = origChrome;
    }
});

test('5. Partial legacy record normalization', async () => {
    const origChrome = (globalThis as Record<string, unknown>).chrome;
    // Legacy record with only sid and at (missing bl, accountSlot, lastUsed)
    const mock = makeMockStorage({
        gemini_credentials: {
            sid: 'legacy_only_sid_at',
            at: 'legacy_token'
        }
    });
    (globalThis as Record<string, unknown>).chrome = { storage: { session: mock, local: mock } };
    try {
        const credManager = getFreshCredManager();
        const migrated = await credManager.migrateCredentials();
        assert.strictEqual(migrated, true, 'migration should report true');
        const map = await credManager.loadCredMap();
        assert.ok(map.legacy_only_sid_at, 'legacy credential should be added to map');
        assert.strictEqual(map.legacy_only_sid_at.at, 'legacy_token');
        assert.strictEqual(map.legacy_only_sid_at.accountSlot, 'default');
        assert.ok(map.legacy_only_sid_at.bl, 'fallback bl should be assigned');
        assert.ok(typeof map.legacy_only_sid_at.lastUsed === 'number');
    } finally {
        (globalThis as Record<string, unknown>).chrome = origChrome;
    }
});

test('6. Legacy migration preserves order and removes legacy key', async () => {
    const origChrome = (globalThis as Record<string, unknown>).chrome;
    const mock = makeMockStorage({
        gemini_credentials_map: {
            existing_sid: { sid: 'existing_sid', at: 'at_exist', bl: 'bl_exist', accountSlot: 'default' }
        },
        gemini_credentials: {
            sid: 'legacy_to_migrate',
            at: 'at_migrated'
        }
    });
    (globalThis as Record<string, unknown>).chrome = { storage: { session: mock, local: mock } };
    try {
        const credManager = getFreshCredManager();
        const migrated = await credManager.migrateCredentials();
        assert.strictEqual(migrated, true);

        // check map has both
        const map = await credManager.loadCredMap();
        assert.strictEqual(Object.keys(map).length, 2);
        assert.strictEqual(map.existing_sid.at, 'at_exist');
        assert.strictEqual(map.legacy_to_migrate.at, 'at_migrated');

        // check legacy key is removed from storage
        assert.strictEqual(mock.data.gemini_credentials, undefined, 'legacy key must be removed');
    } finally {
        (globalThis as Record<string, unknown>).chrome = origChrome;
    }
});

test('7. Alternate storage + chrome.storage.local merge', async () => {
    const origChrome = (globalThis as Record<string, unknown>).chrome;
    const sessionMock = makeMockStorage({
        gemini_credentials_map: {
            sess_sid: { sid: 'sess_sid', at: 'at_sess', bl: 'bl_sess', accountSlot: 'default' }
        }
    });
    const localMock = makeMockStorage({
        gemini_credentials_map: {
            local_sid: { sid: 'local_sid', at: 'at_local', bl: 'bl_local', accountSlot: 'u1' }
        },
        gemini_credentials: {
            sid: 'local_legacy_sid',
            at: 'at_local_legacy'
        }
    });

    (globalThis as Record<string, unknown>).chrome = {
        storage: {
            session: sessionMock,
            local: localMock
        }
    };
    try {
        const credManager = getFreshCredManager();
        const migrated = await credManager.migrateCredentials();
        assert.strictEqual(migrated, true);

        // session storage now has all merged credentials
        const map = await credManager.loadCredMap();
        assert.ok(map.sess_sid, 'session credential kept');
        assert.ok(map.local_sid, 'local credential merged');
        assert.ok(map.local_legacy_sid, 'local legacy credential migrated and merged');

        // chrome.storage.local had its map and credentials cleaned
        assert.strictEqual(localMock.data.gemini_credentials_map, undefined);
        assert.strictEqual(localMock.data.gemini_credentials, undefined);
    } finally {
        (globalThis as Record<string, unknown>).chrome = origChrome;
    }
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
    const P = require('../src/core/protocol/protocol.js').default;

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
