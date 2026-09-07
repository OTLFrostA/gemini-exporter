// p0_regression_lock.test.js — behavioral regression locks for the P0 fixes
// landed in #194 ("resolve export race conditions, storage overwrites, ...").
//
// tests/audit_p0_p2_fixes.test.js covers the fixes at unit level (parser,
// storageService, tabService, listView). This suite pins the same fixes at
// BEHAVIOR level on the two paths that had zero coverage:
//   1. exportEngine.run() end-to-end — finalize-once semantics, and the
//      ZIP-mode contentMarkdown path that used to permanently swallow the
//      export record (finalizeChatExport never fired).
//   2. hookCredentials.js MAIN-world hook — deletion-ID extraction anchored
//      to the GzXR5e payload context, verified by running the real hook
//      script in a vm sandbox.
//
// Expected GREEN on main. A failure here means a P0 regression.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');
const StorageService = require('../src/core/storage/storageService.js');
const GeminiUtils = require('../src/core/utils/utils.js');
const { ExportEngine } = require('../src/core/engine/exportEngine.js');

// ---------------------------------------------------------------- mocks

function makeChromeStorage() {
    const data = {};
    return {
        data,
        storage: {
            local: {
                get: async (keys) => {
                    await Promise.resolve(); // yield, like real storage IPC
                    const keyList = Array.isArray(keys) ? keys : [keys];
                    const out = {};
                    for (const k of keyList) {
                        if (Object.prototype.hasOwnProperty.call(data, k)) {
                            out[k] = JSON.parse(JSON.stringify(data[k]));
                        }
                    }
                    return out;
                },
                set: async (items) => {
                    await Promise.resolve();
                    for (const [k, v] of Object.entries(items)) {
                        data[k] = JSON.parse(JSON.stringify(v));
                    }
                },
                remove: async (keys) => {
                    const keyList = Array.isArray(keys) ? keys : [keys];
                    for (const k of keyList) delete data[k];
                }
            },
            session: {
                get: async () => ({}),
                set: async () => {},
                remove: async () => {}
            }
        }
    };
}

const zipCaptures = [];

class FakeJSZip {
    folder() {
        return {
            file: (name, content) => zipCaptures.push([name, content])
        };
    }
    async generateAsync(_opts, onMeta) {
        if (onMeta) onMeta({ percent: 100 });
        return { type: 'blob', size: 1 };
    }
}

class FakeAssetPipeline {
    // eslint-disable-next-line no-unused-vars
    constructor(opts) {}
    async processAsset(item, _chat, _meta) {
        return { saved: true, localName: item.localName || item.fileName || 'asset.bin' };
    }
}

async function runExport(chatDetail, { useFakePipeline = false } = {}) {
    zipCaptures.length = 0;
    const chromeMock = makeChromeStorage();
    global.chrome = chromeMock;
    global.StorageService = StorageService;
    global.GeminiUtils = GeminiUtils;
    global.JSZip = FakeJSZip;
    if (useFakePipeline) global.AssetPipeline = FakeAssetPipeline;
    else delete global.AssetPipeline;

    global.TabService = {
        sendToGeminiTab: async (msg) => {
            assert.strictEqual(msg.action, 'getConversationDetail');
            return { success: true, data: chatDetail };
        }
    };

    const onItemExportedCalls = [];
    const engine = new ExportEngine();
    const result = await engine.run(
        {
            selected: [{ id: chatDetail.id, title: chatDetail.title }],
            useZip: true,
            includeAssets: true,
            includeIndex: false,
            currentSlot: 'u0',
            conversations: [],
            downloadHandler: async () => {}
        },
        {
            onItemExported: (id, rec) => onItemExportedCalls.push({ id, rec }),
            onLog: () => {},
            onProgress: () => {},
            onTitleUpdated: () => {}
        }
    );
    // finalizeChatExport is fire-and-forget; let its storage chain settle.
    await new Promise(r => setTimeout(r, 25));
    const exportedIds = await StorageService.getExportedIds('u0');
    return { result, onItemExportedCalls, exportedIds, chromeData: chromeMock.data };
}

// ------------------------------------------- exportEngine.run() end-to-end

test('p0-lock: conversation without assets is finalized exactly once and its record persisted', async () => {
    const chat = {
        id: 'aaaa1111bbbb2222',
        title: 'Plain Chat',
        timestamp: 1700000000000,
        messages: [
            { role: 'user', content: 'hi', timestamp: 1700000000000 },
            { role: 'model', content: 'hello', timestamp: 1700000000001 }
        ]
    };
    const { result, onItemExportedCalls, exportedIds } = await runExport(chat);
    assert.strictEqual(result.landedChats, 1, 'chat text must be exported');
    assert.strictEqual(onItemExportedCalls.length, 1, 'finalizeChatExport must fire exactly once');
    assert.ok(
        exportedIds['aaaa1111bbbb2222'] || exportedIds['c_aaaa1111bbbb2222'],
        'export record must be persisted to exportedIds'
    );
});

test('p0-lock: ZIP-mode contentMarkdown attachment no longer swallows the export record', async () => {
    // Regression scenario: before #194 the zip branch decremented
    // pendingAssetsPerChat BEFORE the count was ever set (|| 1 fallback read
    // it as 1), fired a no-op finalize, then set the count at 1 — so the
    // record was never persisted and the chat was re-exported forever.
    const chat = {
        id: 'cccc3333dddd4444',
        title: 'Doc Chat',
        timestamp: 1700000000000,
        messages: [
            {
                role: 'model',
                content: 'doc answer',
                timestamp: 1700000000001,
                attachments: [{
                    type: 'file',
                    url: 'https://example.file/download',
                    contentMarkdown: 'embedded doc body',
                    localName: 'assets/doc.md',
                    fileName: 'doc.md'
                }]
            }
        ]
    };
    const { result, onItemExportedCalls, exportedIds } = await runExport(chat);
    assert.strictEqual(result.landedChats, 1, 'chat text must be exported');
    assert.ok(
        zipCaptures.some(([name]) => String(name).includes('doc.md')),
        'contentMarkdown attachment must be written into the ZIP'
    );
    assert.strictEqual(onItemExportedCalls.length, 1, 'finalizeChatExport must fire exactly once');
    assert.ok(
        exportedIds['cccc3333dddd4444'] || exportedIds['c_cccc3333dddd4444'],
        'export record must be persisted even when the only asset is a ZIP-inline contentMarkdown'
    );
});

test('p0-lock: staged image asset finalizes exactly once via the queue (no duplicate finalize)', async () => {
    const chat = {
        id: 'eeee5555ffff6666',
        title: 'Image Chat',
        timestamp: 1700000000000,
        messages: [
            {
                role: 'model',
                content: 'generated image',
                timestamp: 1700000000001,
                images: [{ url: 'https://lh3.example/img', fileName: 'img1.jpg', localName: 'assets/img1.jpg' }]
            }
        ]
    };
    const { result, onItemExportedCalls, exportedIds } = await runExport(chat, { useFakePipeline: true });
    assert.strictEqual(result.downloadedAssets, 1, 'image asset must be downloaded');
    assert.strictEqual(onItemExportedCalls.length, 1, 'finalizedChatsSet must prevent duplicate finalize');
    assert.ok(
        exportedIds['eeee5555ffff6666'] || exportedIds['c_eeee5555ffff6666'],
        'export record must be persisted after the asset completes'
    );
});

// ----------------------------------- hookCredentials.js MAIN-world behavior

const hookCode = fs.readFileSync(path.join(SRC, 'content', 'hookCredentials.js'), 'utf8');

function createHookSandbox() {
    const posted = [];
    const win = {};
    win.postMessage = (msg, origin) => posted.push({ msg, origin });
    win.addEventListener = () => {};
    win.__nextResponseText = '';
    win.fetch = async () => ({
        ok: true,
        clone() {
            return { text: async () => win.__nextResponseText };
        }
    });
    const sandbox = {
        window: win,
        location: { origin: 'https://gemini.google.com', href: 'https://gemini.google.com/app', pathname: '/app' },
        document: { querySelectorAll: () => [] },
        console: { log: () => {}, warn: () => {}, debug: () => {} },
        setTimeout: () => 0,
        URLSearchParams
    };
    vm.createContext(sandbox);
    vm.runInContext(hookCode, sandbox, { filename: 'hookCredentials.js' });
    return { posted, win };
}

test('p0-lock: deletion sniffing ignores hex decoys outside the GzXR5e payload context', async () => {
    const { posted, win } = createHookSandbox();
    const DECOY = 'aabbccdd11223344'; // arbitrary hex field earlier in the request body
    const REAL = 'deadbeef00112233';  // the conversation id carried by the GzXR5e payload
    const body = `f.req=[["${DECOY}"],["GzXR5e","c_${REAL}"]]`;

    await win.fetch('https://gemini.google.com/u/0/batchexecute', { method: 'POST', body });
    await new Promise(r => setTimeout(r, 5));

    const deletions = posted.filter(p => p.msg.type === 'GEMINI_CONVERSATION_DELETED');
    assert.strictEqual(deletions.length, 1, 'exactly one deletion event expected');
    assert.strictEqual(
        deletions[0].msg.payload.id,
        REAL,
        'deleted id must be the one anchored to the GzXR5e context, not the first hex token in the text'
    );
});

test('p0-lock: deletion sniffing also anchors ids arriving in the response body', async () => {
    const { posted, win } = createHookSandbox();
    win.__nextResponseText = ')]}\'\n\n[["wrb.fr","GzXR5e","c_feedface12345678",null]]';

    await win.fetch('https://gemini.google.com/u/0/batchexecute', {
        method: 'POST',
        body: 'f.req=[[["GzXR5e",null]]]'
    });
    await new Promise(r => setTimeout(r, 10)); // response is consumed via clone().text()

    const deletions = posted.filter(p => p.msg.type === 'GEMINI_CONVERSATION_DELETED');
    assert.strictEqual(deletions.length, 1, 'exactly one deletion event expected');
    assert.strictEqual(deletions[0].msg.payload.id, 'feedface12345678');
});

test('p0-lock: hex ids without a GzXR5e anchor never trigger local conversation removal', async () => {
    const { posted, win } = createHookSandbox();
    win.__nextResponseText = ')]}\'\n\n[["wrb.fr","MaZiqc","[["aabbccdd11223344",null]]",null]]';

    await win.fetch('https://gemini.google.com/u/0/batchexecute', {
        method: 'POST',
        body: 'f.req=[["MaZiqc",null]]'
    });
    await new Promise(r => setTimeout(r, 10));

    const deletions = posted.filter(p => p.msg.type === 'GEMINI_CONVERSATION_DELETED');
    assert.strictEqual(deletions.length, 0, 'list-RPC responses containing bare hex must not fire deletion events');
});
