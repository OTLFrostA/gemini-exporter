
export {};
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const readSrc = (rel: string): string =>
    fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8');

function replaceGlobal(key: string, value: unknown): () => void {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    return () => {
        if (previous) Object.defineProperty(globalThis, key, previous);
        else Reflect.deleteProperty(globalThis, key);
    };
}

// P1-001 / P1-004 were comment-text tests, not security contracts.
// P1-002's specific identifier absence was weaker than the actual session
// storage behavior covered by known_issue_credentials_session.test.ts.
// P1-007 pinned an obsolete diagnostic string instead of detecting secrets.

test('P1-003: bootstrap avoids the previously leaked token logging patterns', () => {
    const src = readSrc('content/bootstrap.ts');
    assert.ok(!src.includes('atFromPage.slice(0, 12)'), 'credential prefix should never be logged');
    assert.ok(!src.includes("console.log('[Gemini Exporter] bl refreshed', blFromPage)"), 'raw bl should never be logged');
    assert.ok(src.includes("'atLen', atFromPage.length"), 'at log should use only length');
    assert.ok(src.includes("'blLen', blFromPage.length"), 'bl log should use only length');
});

test('P1-005: empty postMessage token must not replace the stored token (source guard)', () => {
    const src = readSrc('content/bootstrap.ts');
    assert.ok(src.includes('at: p.at || old.at'), 'empty token must not overwrite stored at');
});

// P1-010: this is a genuine storage behavior test; preserve it.
test('P1-010: self-healed bl is written to session storage rather than memory only', async () => {
    const CredManager = require('../src/core/api/client/credentialManager.js').default;
    const resolveCred = CredManager.resolveCred;
    assert.equal(typeof resolveCred, 'function');

    const setCalls: any[] = [];
    const stored: any = {
        gemini_credentials_map: {
            sid1: { sid: 'sid1', at: 'at-value', bl: '', accountSlot: 'default', lastUsed: 1 }
        }
    };
    const undoChrome = replaceGlobal('chrome', {
        storage: {
            session: {
                get: async (keys: string[]) => {
                    const o: any = {};
                    for (const k of keys) o[k] = stored[k];
                    return o;
                },
                set: async (obj: any) => { Object.assign(stored, obj); setCalls.push(obj); }
            },
            local: { remove: async () => {} }
        }
    });
    const undoDoc = replaceGlobal('document', {});
    const undoBl = replaceGlobal('__gemExporterBl', 'healed-bl-from-page');
    try {
        const cred = await resolveCred();
        assert.ok(setCalls.length > 0, 'healed bl must be persisted');
        const persisted = setCalls[setCalls.length - 1].gemini_credentials_map;
        assert.equal(persisted?.sid1?.bl, 'healed-bl-from-page');
        assert.equal(cred.bl, 'healed-bl-from-page');
    } finally {
        undoBl();
        undoDoc();
        undoChrome();
    }
});
