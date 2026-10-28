import test from 'node:test';
import assert from 'node:assert/strict';
import { groupExportFailures, copyExportFailures } from '../src/ui/options/views/exportFailures.js';
import type { ExportItemUpdate } from '../src/application/export/types.js';
import { fixtureAccount } from './helpers/domainFixture.js';

const accountId = fixtureAccount('gemini').id;
const key = (conversationId: string) => ({ accountId, conversationId });
const failed = (conversationId: string, message: string, stage = 'export'): ExportItemUpdate => ({
    key: key(conversationId), status: 'failed', diagnostic: { stage, code: 'EXPORT_FAILED', message },
});

test('100 identical reported errors form one group with all affected keys and one copied reason', () => {
    const keys = Array.from({ length: 100 }, (_, i) => key(String(i)));
    const groups = groupExportFailures(keys, keys.map(k => failed(k.conversationId, 'Download rejected')));
    assert.equal(groups.length, 1);
    assert.equal(groups[0].conversations.length, 100);
    const copied = copyExportFailures(groups);
    assert.equal(copied.split('Download rejected').length - 1, 1);
    assert.match(copied, new RegExp(`${accountId}/99`));
});

test('exact messages and stages stay separate; unrelated diagnostics never supply a guessed reason', () => {
    const groups = groupExportFailures([key('a'), key('b'), key('c'), key('d')], [
        failed('a', 'HTTP 403'), failed('b', 'HTTP 404'), failed('c', 'HTTP 403', 'delivery'),
        failed('unrelated', 'HTTP 403'),
    ]);
    assert.equal(groups.length, 4);
    assert.equal(groups[3].diagnostic, undefined);
    assert.match(copyExportFailures([groups[3]]), /Unknown error/);
});

test('grouping deduplicates keys, uses the latest failure, and excludes recovered keys', () => {
    const groups = groupExportFailures([key('a'), key('a')], [
        failed('a', 'Old reason'), failed('b', 'Recovered'), failed('a', 'Current reason'),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].conversations.length, 1);
    assert.equal(groups[0].diagnostic?.message, 'Current reason');
});
