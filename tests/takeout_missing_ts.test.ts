import test from 'node:test';
import assert from 'node:assert/strict';
import { activityHtml } from './helpers/l1SourceFixture.js';
import { parseGeminiTakeoutArchive } from '../src/l1/parsers/gemini/takeout/parseConversation.js';
test('untimed Takeout source has no invented activity, savedAt or sourceVersion', () => {
    const [parsed] = parseGeminiTakeoutArchive({ htmlText: activityHtml('<p>Answer</p>', 'NoTimestamp_4242', '') }, { providerId: 'gemini' });
    assert.equal(parsed.sourceVersion, undefined);
    assert.equal('updatedAt' in parsed.conversation.index, false);
    assert.equal('savedAt' in parsed.conversation.detail, false);
    assert.equal('key' in parsed.conversation.detail, false);
});
