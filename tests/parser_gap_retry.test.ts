import { address, key, seed, request, reset, records, events, provider, state } from './helpers/applicationHarness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runExport } from '../src/application/export/runExport.js';
import { CONTENT_PARSER_REVISION } from '../src/shared/parserRevision.js';
import type { ContentRepairPolicy } from '../src/l2/quality.js';
import { ResourceHttpError } from '../src/shared/resources/resourceResult.js';

const repair: ContentRepairPolicy = { reason: 'source_annotations_unrepresented', retry: 'source_or_parser_change',
    parserRevision: CONTENT_PARSER_REVISION };
test.beforeEach(reset);

test('deterministic source loss stays partial while identical repeated exports do not fetch or deliver again', async () => {
    const { detail } = seed('first', { quality: 'partial' });
    detail.quality.repair = repair;
    const first = await runExport(request({ skipUnchanged: true }));
    assert.equal(first.partial, 1);
    assert.deepEqual(records.get(address(key()))?.contentRepair, repair);
    assert.equal(events.filter(event => event === 'refresh').length, 0);
    const second = await runExport(request({ skipUnchanged: true }));
    assert.equal(second.skipped, 1);
    assert.equal(second.exported, 0);
    assert.equal(records.get(address(key()))?.status, 'partial');
    assert.equal(events.filter(event => event === 'refresh').length, 0);
    assert.equal((await runExport(request({ skipUnchanged: false }))).partial, 1);
    assert.equal(events.filter(event => event === 'refresh').length, 0, 'explicit delivery reuses the unchanged source');
});

test('parser revision changes trigger one fresh attempt and then retain partial without repeated fetches', async () => {
    const { detail } = seed('first', { quality: 'partial' });
    const previous = { ...repair, parserRevision: 'previous-parser' };
    detail.quality.repair = previous;
    records.set(address(key()), { format: 'markdown', status: 'partial', otherContentMissing: true,
        chatTime: 100, exportedAt: 1, contentRepair: previous });
    provider.fetchConversationDetail = async () => { events.push('refresh'); detail.quality.repair = repair; };
    assert.equal((await runExport(request({ skipUnchanged: true }))).partial, 1);
    assert.deepEqual(records.get(address(key()))?.contentRepair, repair);
    assert.equal((await runExport(request({ skipUnchanged: true }))).skipped, 1);
    assert.equal(events.filter(event => event === 'refresh').length, 1);
});

test('source version changes and explicit refresh override the deterministic retry policy', async () => {
    const { detail, index } = seed('first', { quality: 'partial' });
    detail.quality.repair = repair;
    await runExport(request({ skipUnchanged: true }));
    index.updatedAt = 101;
    provider.fetchConversationDetail = async () => { events.push('refresh'); detail.savedAt = 101; };
    assert.equal((await runExport(request({ skipUnchanged: true }))).partial, 1);
    assert.equal(records.get(address(key()))?.chatTime, 101);
    assert.equal((await runExport(request({ skipUnchanged: true }))).skipped, 1);
    await runExport(request({ skipUnchanged: true }), { refreshDetail: true });
    assert.equal(events.filter(event => event === 'refresh').length, 2);
});

test('refresh and format failures cannot acquire a deterministic skip receipt', async () => {
    const { detail } = seed('first', { quality: 'partial', savedAt: 90 });
    detail.quality.repair = repair;
    provider.fetchConversationDetail = async () => { events.push('refresh'); throw new Error('offline'); };
    assert.equal((await runExport(request({ skipUnchanged: true }))).partial, 1);
    assert.equal(records.get(address(key()))?.contentRepair, undefined);
    detail.savedAt = 100;
    state.htmlDiagnostics = [{ severity: 'warning', code: 'FORMAT_CONTENT_OMITTED', message: 'Omitted content' }];
    await runExport(request({ format: 'html', skipUnchanged: true }));
    assert.equal(records.get(address(key()))?.contentRepair, undefined);
    assert.equal((await runExport(request({ format: 'html', skipUnchanged: true }))).skipped, 0);
});

test('transient attachments still retry while a deterministic body gap stays partial', async () => {
    const { detail } = seed('first', { quality: 'partial', assets: true });
    detail.quality.repair = repair;
    provider.acquireResource = async () => { events.push('acquire:failed'); throw new ResourceHttpError(503); };
    assert.equal((await runExport(request({ skipUnchanged: true }))).partial, 1);
    assert.equal((await runExport(request({ skipUnchanged: true }))).skipped, 0);
    assert.equal(events.filter(event => event === 'acquire:failed').length, 4);
    assert.equal(events.filter(event => event === 'refresh').length, 0);
});
