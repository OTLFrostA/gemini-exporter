/**
 * P1-H3 UI regressions.
 * Prefer observable DOM / callback behavior over checking production source.
 * Keep the few bootstrapping/modal source guards until an integration harness
 * covers those entire user-interaction flows.
 */
export {};
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = (p: string): string =>
    fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8');

function replaceGlobal(key: string, value: unknown): () => void {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    return () => {
        if (previous) Object.defineProperty(globalThis, key, previous);
        else Reflect.deleteProperty(globalThis, key);
    };
}

test('P1-118: list status update escapes dynamic IDs before querying the DOM', () => {
    const values: string[] = [];
    let query = '';
    const restoreCSS = replaceGlobal('CSS', {
        escape(value: string) {
            values.push(value);
            return `escaped:${value}`;
        }
    });
    const restoreDoc = replaceGlobal('document', {
        getElementById: () => null,
        querySelector(selector: string) { query = selector; return null; }
    });
    try {
        const view = require('../src/ui/views/listView.js');
        view.updateItemExportStatus('c_chat:with[brackets]');
        assert.ok(values.includes('chat:with[brackets]'), 'the normalized ID was escaped');
        assert.match(query, /escaped:chat:with\[brackets\]/, 'escaped ID reaches the DOM selector');
    } finally {
        restoreDoc();
        restoreCSS();
    }
});

test('P1-119: permission prompt is never requested without user activation', async () => {
    const dh = require('../src/ui/controllers/dirHandleController.js');
    let requested = false;
    const handle = {
        queryPermission: async () => 'prompt',
        requestPermission: async () => { requested = true; return 'granted'; },
        keys: async function* () {}
    };
    assert.equal(await dh.verifyDirPermission(handle), false);
    assert.equal(requested, false);
});
// P1-119 stored handle preservation is exercised in the runtime test
// live_save_permission_deadlock.test.ts; deleted duplicate source assertion.

test('P1-120: Takeout file input resets after success and error callbacks', () => {
    const { __setModuleOverride, __getModuleOverride } =
        require('../src/core/utils/moduleOverrides.js');
    const takeout = require('../src/ui/options/modules/optionsTakeout.js');
    const previousCtrl = __getModuleOverride('TakeoutController');
    const restoreDoc = replaceGlobal('document', { getElementById: () => null });
    const input = { value: 'original.zip' };
    try {
        __setModuleOverride('TakeoutController', {
            handleTakeoutImport: (_file: unknown, callbacks: any) => {
                callbacks.onFinished({ message: 'done' });
                return Promise.resolve();
            }
        });
        takeout.processTakeoutImport({ name: 'original.zip' } as File, input as HTMLInputElement);
        assert.equal(input.value, '', 'successful import must let the same ZIP be selected again');
        assert.equal(takeout.isImporting(), false);

        input.value = 'original.zip';
        __setModuleOverride('TakeoutController', {
            handleTakeoutImport: (_file: unknown, callbacks: any) => {
                callbacks.onError(new Error('invalid zip'));
                return Promise.resolve();
            }
        });
        takeout.processTakeoutImport({ name: 'original.zip' } as File, input as HTMLInputElement);
        assert.equal(input.value, '', 'failed import must also clear the input');
        assert.equal(takeout.isImporting(), false);
    } finally {
        __setModuleOverride('TakeoutController', previousCtrl);
        restoreDoc();
    }
});

test('P1-121: loadStore rejection reports an error through the UI log', async () => {
    const { __setModuleOverride, __getModuleOverride } =
        require('../src/core/utils/moduleOverrides.js');
    const previousStore = __getModuleOverride('ConversationsStore');
    const previousLog = __getModuleOverride('LogView');
    const reported: Array<{ message: string; level: string }> = [];
    __setModuleOverride('ConversationsStore', {
        getCurrentAccountId: () => '10000000-0000-4000-8000-000000000001',
        getConversations: () => [],
        loadStore: async () => { throw new Error('synthetic load failure'); }
    });
    __setModuleOverride('LogView', {
        log: (message: string, level: string) => reported.push({ message, level })
    });
    try {
        await require('../src/ui/options/modules/optionsInit.js').loadStore();
        assert.equal(reported.length, 1);
        assert.equal(reported[0].level, 'error');
        assert.ok(reported[0].message, 'UI log should contain an error message');
    } finally {
        __setModuleOverride('ConversationsStore', previousStore);
        __setModuleOverride('LogView', previousLog);
    }
});

test('P1-122: workbench startup is guarded in both entry paths (source guard)', () => {
    const src = SRC('ui/options/options.ts');
    assert.ok(src.includes('startWorkbench'));
    assert.ok(src.includes('.catch('));
    assert.ok(src.includes("addEventListener('DOMContentLoaded', startWorkbench)"));
});

test('P1-123: popup language change refreshes its controls (source guard)', () => {
    const src = SRC('ui/popup/popup.ts');
    assert.ok(src.includes('i18n.applyI18n()'));
    assert.ok(src.includes('applyLangToggleUI()'));
    assert.ok(src.includes('await updateCount()'));
});
// Popup export guard release is separately checked in seam_s3_ui_timeout.test.ts.

test('P1-121/123: user-facing error and busy messages exist in both locales', () => {
    const en = require('../src/core/utils/locales/en.js');
    const zh = require('../src/core/utils/locales/zh.js');
    for (const key of ['popupExportBusy', 'loadStoreFailed']) {
        assert.ok(typeof en[key] === 'string' && en[key].length > 0, `missing English ${key}`);
        assert.ok(typeof zh[key] === 'string' && zh[key].length > 0, `missing Chinese ${key}`);
    }
});

test('direct-write: modal observer does not override a user decision (source guard)', () => {
    const src = SRC('ui/options/modules/optionsExport.ts');
    assert.ok(src.includes('decisionMade'));
    assert.ok(/!decisionMade\)\s*settleDecision\(\)/.test(src));
    const choice = src.indexOf('async () => {\n                        decisionMade = true;');
    assert.ok(choice >= 0, 'folder choice synchronously locks its decision');
    assert.ok(src.includes('await decisionPromise'));
});
