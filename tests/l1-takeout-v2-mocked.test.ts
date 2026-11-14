import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ports } from './helpers/l1V2UnitMocks.js';
import { parseGeminiTakeoutZipArchive, readTakeoutBytes } from '../src/l1/imports/takeout/readArchive.js';

beforeEach(() => ports.reset());
const chat = 'source_takeout_123';
const html = '<div class="outer-cell"><a href="https://gemini.google.com/app/' + chat + '">Conversation</a>'
    + '<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">'
    + 'Prompted Draw<br>2026-09-02T12:00:00Z<br><p>Output <img src="picture.png"></p></div></div>';

function archive(read?: () => void) {
    return {
        file() {},
        files: {
            'Takeout/Gemini/MyActivity.html': {
                _data: { uncompressedSize: html.length },
                async: async () => html,
            },
            'Takeout/Gemini/picture.png': {
                _data: { uncompressedSize: 3 },
                async: async () => { read?.(); return Uint8Array.of(4, 5, 6); },
            },
        },
    } as unknown as Blob;
}

test('L1 Takeout archive reader produces keyless source facts without invoking L2 admission or Runtime', async () => {
    let readyCalls = 0;
    const progress: Array<[number, number]> = [];
    let readCount = 0;
    const results = await parseGeminiTakeoutZipArchive(archive(() => { readCount++; }), {
        providerId: 'gemini',
        onArchiveReady: () => { readyCalls++; },
        onProgress: (completed, total) => progress.push([completed, total]),
    });
    assert.equal(readyCalls, 1);
    assert.equal(results.length, 1);
    assert.equal(results[0].conversationId, chat);
    assert.ok(results[0].conversation.detail.messages.length > 0);
    assert.equal('key' in results[0].conversation.detail, false);
    assert.equal('key' in results[0].conversation.index, false);
    assert.equal(readCount, 0, 'archive media entries remain lazy until explicitly read');
    assert.deepEqual(ports.details, [], 'pure L1 archive parser never calls L2 ingestDetail');
    assert.deepEqual(ports.indexes, [], 'pure L1 archive parser never calls L2 ingestIndexes');
    assert.deepEqual(ports.notifications, [], 'pure L1 archive parser never notifies Runtime');
    assert.ok(progress.length > 0);

    const asset = results[0].conversation.detail.assets[0];
    const bound = results[0].archiveResources[asset.id];
    assert.ok(bound);
    const bytes = await readTakeoutBytes(bound.entry);
    assert.deepEqual(bytes, Uint8Array.of(4, 5, 6));
    assert.equal(readCount, 1);
});

test('L1 Takeout archive reader rejects wrong provider context', async () => {
    await assert.rejects(
        parseGeminiTakeoutZipArchive(archive(), { providerId: 'chatgpt' }),
        /Gemini Takeout parser requires providerId gemini/,
    );
});
