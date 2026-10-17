import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import { indexFixture } from './helpers/indexFixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as TakeoutEngine from '../src/core/engine/takeoutEngine.js';
import { mergeConversation } from '../src/core/utils/mergeUtils.js';

const htmlNoTimestamp = `
<html><body>
  <div class="outer-cell">
    <a href="https://gemini.google.com/app/c_NoTimestamp_4242">Link</a>
    Prompted 什么是光合作用？<br>
    <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1"><p>光合作用是植物利用光能的过程。</p></div>
  </div>
</body></html>
`;

test('untimed Takeout ZIP yields no activity version and cannot replace server time', async () => {
    const previousJSZip = (global as any).JSZip;
    (global as any).JSZip = require('../lib/jszip.min.js');
    TakeoutEngine.clearTakeoutData();
    try {
        const zip = new (global as any).JSZip();
        zip.file('Takeout/Gemini/MyActivity.html', htmlNoTimestamp);
        const parsed = await TakeoutEngine.parseTakeoutZip(await zip.generateAsync({ type: 'nodebuffer' }), null, '10000000-0000-4000-8000-000000000001');
        assert.equal(parsed.conversations.length, 1);
        const takeout = parsed.conversations[0];

        // Physical Domain schema omits unknown times; it does not store null or Date.now().
        assert.equal(Object.hasOwn(takeout, 'updatedAt'), false);
        assert.equal(Reflect.get(takeout ?? {}, 'hasTakeoutImport'), undefined);

        const oldServer = indexFixture({
            id: takeout.key.conversationId, title: 'Server title', titleSource: 'rpc', updatedAt: 1700000000000
        });
        const mergedServer = mergeConversation(oldServer, takeout).merged;
        assert.equal(mergedServer.updatedAt, 1700000000000);
        assert.equal(Reflect.get(mergedServer ?? {}, 'hasTakeoutImport'), undefined);
        assert.equal(oldServer.updatedAt, 1700000000000);

        const oldUntimed = indexFixture({ id: takeout.key.conversationId, title: 'Untimed server title', titleSource: 'rpc' });
        const mergedUntimed = mergeConversation(oldUntimed, takeout).merged;
        assert.equal(Object.hasOwn(mergedUntimed, 'updatedAt'), false);
        assert.equal(Reflect.get(mergedUntimed ?? {}, 'hasTakeoutImport'), undefined);
    } finally {
        TakeoutEngine.clearTakeoutData();
        if (previousJSZip === undefined) delete (global as any).JSZip;
        else (global as any).JSZip = previousJSZip;
    }
});
