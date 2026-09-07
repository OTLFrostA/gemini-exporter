// known_issue_credentials_session.test.js — INTENTIONALLY RED.
//
// KNOWN ISSUE (audit report P1-2.6, still open after #194):
// Gemini session tokens (at / SNlM0e — functionally CSRF credentials for the
// Google account) are persisted in chrome.storage.local: plaintext on disk,
// never cleared on logout, readable by any code running in the extension.
// Desired behavior: keep credentials in chrome.storage.session (memory-
// scoped, cleared when the browser session ends), plus explicit cleanup on
// 401/logout.
//
// Fix path note: chrome.storage.session is not exposed to content scripts
// by default — background must call
//   chrome.storage.session.setAccessLevel('TRUSTED_AND_UNTRUSTED_CONTEXTS')
// or the content script must proxy credential writes through the service
// worker. This test pins the desired end state.
//
// This file makes `npm test` fail by design until the issue is fixed. Do
// not merge to main while it is red.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'content', 'bootstrap.js'), 'utf8');

function makeContext() {
    const ctx = {
        console: { log: () => {}, warn: () => {}, debug: () => {} },
        URL,
        chrome: {
            runtime: { id: 'test-extension' },
            storage: {
                local: {
                    get: async (keys) => {
                        const keyList = Array.isArray(keys) ? keys : [keys];
                        const out = {};
                        for (const k of keyList) {
                            if (ctx.__localData && Object.prototype.hasOwnProperty.call(ctx.__localData, k)) {
                                out[k] = ctx.__localData[k];
                            }
                        }
                        return out;
                    },
                    set: async (items) => {
                        ctx.__localWrites.push(items);
                        ctx.__localData = ctx.__localData || {};
                        Object.assign(ctx.__localData, JSON.parse(JSON.stringify(items)));
                    },
                    remove: async () => {}
                },
                session: {
                    get: async () => ({}),
                    set: async (items) => { ctx.__sessionWrites.push(items); },
                    remove: async () => {}
                }
            }
        },
        __localWrites: [],
        __sessionWrites: []
    };
    ctx.window = ctx;
    ctx.document = {
        querySelectorAll: () => [],
        addEventListener: () => {},
        documentElement: { innerHTML: '' }
    };
    ctx.location = { origin: 'https://gemini.google.com', href: 'https://gemini.google.com/u/0/app', pathname: '/u/0/app' };
    ctx.localStorage = { getItem: () => null, setItem: () => {} };
    ctx.sessionStorage = { getItem: () => null, setItem: () => {} };
    vm.createContext(ctx);
    return ctx;
}

test('KNOWN ISSUE P1-2.6: session tokens must live in chrome.storage.session, never in chrome.storage.local', async () => {
    const ctx = makeContext();
    ctx.WIZ_global_data = { SNlM0e: 'ATTEST0123456789abcdef' };

    vm.runInContext(code, ctx, { filename: 'bootstrap.js' });
    // bootstrap runs ensureCreds() at load; let its async chain settle.
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    const credKeys = w => 'gemini_credentials' in w || 'gemini_credentials_map' in w;
    const wroteLocal = ctx.__localWrites.some(credKeys);
    const wroteSession = ctx.__sessionWrites.some(credKeys);

    assert.ok(wroteSession, 'credentials must be persisted to chrome.storage.session (memory-scoped)');
    assert.ok(
        !wroteLocal,
        'credentials must NOT be written to chrome.storage.local — plaintext tokens on disk survive logout ' +
        'and are readable by any extension code. Migrate to chrome.storage.session (+401/logout cleanup).'
    );
});
