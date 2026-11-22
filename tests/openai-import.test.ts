import test from 'node:test';
import assert from 'node:assert/strict';
import { useIndexStorage } from './helpers/indexStorage.js';
import { fixtureAccount } from './helpers/domainFixture.js';
import { importOpenAI } from '../src/application/imports/importOpenAI.js';
import { createSourceResourceContext } from '../src/l1/resources/sourceResources.js';
import { getDetail, getIndex, getCoverage, getExportRecord } from '../src/l3a/storageService.js';
import { assertDomainClosure } from '../src/l2/closure.js';
import { subscribeCommittedKeys } from '../src/runtime/api/domainStorage.js';
import type { ConversationKey } from '../src/l2/conversationKey.js';
import { handlePlatformArchiveImport } from '../src/ui/options/controllers/takeoutController.js';

const JSZip: { new(): { file(path: string, text: string): void;
    generateAsync(options: { type: 'uint8array' }): Promise<Uint8Array> };
    loadAsync(bytes: ArrayBuffer): Promise<unknown> } = require('../lib/jszip.min.js');

function conversationRow(id: string, updateTime: number, answer: string) {
    return {
        id, title: 'Official export', current_node: 'answer', create_time: 1700000000, update_time: updateTime,
        mapping: {
            root: { id: 'root', parent: null, children: ['question'] },
            question: { id: 'question', parent: 'root', children: ['answer'], message: { id: 'question', author: { role: 'user' }, recipient: 'all', content: { content_type: 'text', parts: ['Question'] } } },
            answer: { id: 'answer', parent: 'question', children: [], message: { id: 'answer', author: { role: 'assistant' }, recipient: 'all', end_turn: true, status: 'finished_successfully', content: { content_type: 'text', parts: [answer] } } },
        },
    };
}

useIndexStorage();
test('OpenAI ZIP commits validated Domain into real Storage and reimport preserves key ownership', async () => {
    Reflect.set(globalThis, 'JSZip', JSZip);
    const account = fixtureAccount('chatgpt');
    const key = { accountId: account.id, conversationId: 'openai-real-storage' };
    const zip = new JSZip();
    zip.file('conversations.json', JSON.stringify([
        conversationRow(key.conversationId, 1700000001, 'Answer\n\n![diagram](file-diagram.png)\n\n[notes](sandbox:/mnt/data/notes.md)'),
    ]));
    zip.file('file-diagram.png', 'image-bytes');
    zip.file('notes.md', '# original notes');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const resources = createSourceResourceContext();
    try {
        for (let i = 0; i < 2; i++) {
            const result = await importOpenAI(bytes, account.id, undefined, resources);
            assert.deepEqual(result, { read: 1, imported: 1, added: i === 0 ? 1 : 0, skipped: 0, missingAssets: 0, status: 'ok' });
        }
        const detail = await getDetail(key);
        assert.ok(detail);
        assertDomainClosure(detail);
        assert.equal(detail.messages.length, 2);
        assert.equal(detail.assets.length, 2);
        assert.equal((await getIndex(key))?.title, 'Official export');
        const note = detail.assets.find(asset => asset.name === 'notes.md');
        assert.ok(note);
        assert.equal(new TextDecoder().decode((await resources.acquire(key, note)).bytes), '# original notes');
        assert.equal(await getCoverage(account.id, 'recent'), null);
        assert.equal(await getExportRecord(key), null);
        assert.equal(JSON.stringify(detail).includes('# original notes'), false, 'attachment bytes never enter stored Domain');
    } finally { resources.release(); }
});

test('Options OpenAI ZIP import notifies each committed key once when the ZIP has multiple snapshots', async t => {
    // JSZip uses FileReader for File input in Chrome; Node can pass the same bytes directly.
    const previousZip = Reflect.get(globalThis, 'JSZip');
    Reflect.set(globalThis, 'JSZip', { loadAsync: async (file: File) => JSZip.loadAsync(await file.arrayBuffer()) });
    t.after(() => { Reflect.set(globalThis, 'JSZip', previousZip); });
    const account = fixtureAccount('chatgpt');
    const key = { accountId: account.id, conversationId: 'repeated' };
    const otherKey = { accountId: account.id, conversationId: 'distinct' };
    const zip = new JSZip();
    zip.file('conversations.json', JSON.stringify([
        conversationRow(key.conversationId, 1700000001, 'First snapshot'),
        conversationRow(otherKey.conversationId, 1700000001, 'Another conversation'),
        conversationRow(key.conversationId, 1700000002, 'Newer snapshot'),
    ]));
    const file = new File([new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))], 'export.zip', { type: 'application/zip' });
    const notifications: ConversationKey[][] = [];
    t.after(subscribeCommittedKeys(keys => { notifications.push([...keys]); }));
    const runImport = () => handlePlatformArchiveImport(file, account, account.id, { onTarget: async () => {} });

    assert.deepEqual(await runImport(), {
        kind: 'openai', result: { read: 2, added: 2, imported: 2, skipped: 0, missingAssets: 0, status: 'ok' },
    });
    assert.equal((await getDetail(key))?.savedAt, 1700000002000);
    assert.deepEqual(notifications, [[key, otherKey]]);

    await runImport();
    assert.deepEqual(notifications, [[key, otherKey]], 'reimporting identical stored facts sends no notification');
});
