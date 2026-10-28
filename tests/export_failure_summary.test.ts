import test from 'node:test';
import assert from 'node:assert/strict';
import { ExportIssueCollector, copyExportFailures, failureGroupLabel } from '../src/ui/options/views/exportFailures.js';
import { fixtureAccount } from './helpers/domainFixture.js';

const accountId = fixtureAccount('gemini').id;
const key = (conversationId: string) => ({ accountId, conversationId });

test('100 HTTP failures with different IDs and messages aggregate by actual cause and status', () => {
    const collector = new ExportIssueCollector();
    for (let i = 0; i < 100; i++) collector.add({ key: key(String(i)), stage: 'export', code: 'EXPORT_FAILED',
        severity: 'error', message: `HTTP 403 conversation ${i}`, issue: { code: 'SOURCE_HTTP_ERROR', httpStatus: 403, message: `HTTP 403 conversation ${i}` } });
    const groups = collector.groups();
    assert.equal(groups.length, 1);
    assert.equal(groups[0].conversations.length, 100);
    assert.equal(groups[0].occurrences, 100);
    assert.match(failureGroupLabel(groups[0]), /Platform access restricted.*403/);
    const copied = copyExportFailures(groups);
    assert.equal(copied.split('HTTP 403 conversation 0').length - 1, 1);
    assert.match(copied, new RegExp(`${accountId}/99`));
});

test('different HTTP statuses remain separate, without guessing from message text', () => {
    const collector = new ExportIssueCollector();
    for (const status of [401, 403, 404, 429, 500]) collector.add({ key: key(String(status)), stage: 'source_refresh',
        code: 'SOURCE_REFRESH_FAILED', severity: 'warning', message: 'request failed',
        issue: { code: 'SOURCE_HTTP_ERROR', message: 'request failed', httpStatus: status } });
    collector.add({ key: key('unknown'), stage: 'export', code: 'EXPORT_FAILED', message: 'HTTP 429 login expired CORS offline disk full' });
    assert.equal(collector.groups().length, 6);
    assert.equal(collector.groups()[5].category, 'UNKNOWN_ERROR');
    assert.equal(collector.groups()[5].httpStatus, undefined);
    assert.match(failureGroupLabel(collector.groups()[5]), /Unknown error/);
});

test('partial export warnings count occurrences and distinct account-scoped conversations', () => {
    const collector = new ExportIssueCollector();
    for (let i = 0; i < 2; i++) collector.add({ key: key('a'), stage: 'resource', code: 'RESOURCE_PROCESSING_FAILED', severity: 'warning', message: `asset ${i}` });
    collector.add({ key: { ...key('a'), accountId: fixtureAccount('claude').id }, stage: 'resource', code: 'RESOURCE_PROCESSING_FAILED', severity: 'warning', message: 'asset 3' });
    assert.equal(collector.groups().length, 1);
    assert.equal(collector.groups()[0].conversations.length, 2);
    assert.equal(collector.groups()[0].occurrences, 3);
    assert.equal(collector.groups()[0].severity, 'warning');
    assert.equal(JSON.parse(JSON.stringify(collector))[0].occurrences, 3);
});

test('cancellation, confirmed empty source and ordinary informational diagnostics do not become errors', () => {
    const collector = new ExportIssueCollector();
    for (const code of ['EXPORT_CANCELLED', 'SOURCE_CONVERSATION_EMPTY']) collector.add({ stage: 'run', code, message: code });
    collector.add({ stage: 'pdf', code: 'TYPST_LOCAL_FONTS_RESOLVED', severity: 'info', message: 'resolved' });
    assert.deepEqual(collector.groups(), []);
});
