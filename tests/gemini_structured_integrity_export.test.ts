import test from 'node:test';
import assert from 'node:assert/strict';
import { v2ExportHost, readDeliveredFiles, exportKey, exportRequest } from './helpers/v2ExportHost.js';
import { fixtureAccount } from './helpers/domainFixture.js';
import { detailGen } from './fixtures/providers/geminiDetail.js';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import { mergeConversationPages } from '../src/l1/parsers/gemini/rpc/mergePages.js';
import { GeminiProvider } from '../src/l1/client/gemini/geminiProvider.js';
import { ingestDetail } from '../src/l2/ingestion.js';
import { runExport, shouldSkipExport } from '../src/application/export/runExport.js';
import { getExportRecord } from '../src/l3a/storageService.js';
import { invalidSourceRangeNodes } from './fixtures/providers/gemini/detail/remainingSourceRanges.js';
import { coverageWire, citationText, citationField } from './fixtures/providers/gemini/detail/content.js';
import { __getZipConstructor, __setZipConstructor } from '../src/l4/packaging/writers/zipWriter.js';

const account = fixtureAccount('gemini');
const parse = (key: Parameters<typeof detailGen>[0]) => mergeConversationPages([
    parseGeminiRpcConversation(detailGen(key), { account, providerId: 'gemini' }),
], undefined, true);

test('native content loss produces physical fallback plus partial receipt; same source version can retry and then skip after repair', async t => {
    const host = v2ExportHost(t);
    let source = parse('G_NATIVE_INTEGRITY_UNKNOWN_NEIGHBOR');
    let refreshes = 0;
    // Only the network acquisition is replaced. Parse, admission, storage,
    // composition, Markdown bytes, delivery and receipts use production code.
    t.mock.method(GeminiProvider.prototype, 'fetchConversationDetail', async (accountId: string, id: string) => {
        refreshes++;
        await ingestDetail(accountId, id, source.conversation.detail, source.conversation.index);
    });
    await ingestDetail(account.id, source.conversationId, source.conversation.detail, source.conversation.index);
    const request = exportRequest([source.conversationId], { skipUnchanged: true });
    const first = await runExport(request);
    assert.equal(first.partial, 1);
    assert.equal(first.skipped, 0);
    const record = await getExportRecord(exportKey(source.conversationId));
    assert.equal(record?.status, 'partial');
    assert.equal(record?.otherContentMissing, true);
    assert.equal(shouldSkipExport(record, source.sourceVersion, request), false);
    const markdown = await host.blobs[0].text();
    assert.ok(markdown.includes('Introduction.') && markdown.includes('Conclusion.'));
    assert.ok(!markdown.includes('PLAN_TITLE_ONLY_IN_NATIVE'));
    const beforeRetry = refreshes;
    await runExport(request);
    assert.equal(refreshes, beforeRetry + 1, 'partial source must be retried even at the same version');
    source = parse('G_NATIVE_INTEGRITY_PLAN');
    const repaired = await runExport(request);
    assert.equal(repaired.exported, 1);
    assert.equal(repaired.partial, 0);
    const repairedMarkdown = await host.blobs[host.blobs.length - 1].text();
    assert.ok(repairedMarkdown.includes('Find sources') && repairedMarkdown.includes('Write report'));
    assert.ok(repairedMarkdown.includes('PLAN\\_DESCRIPTION\\_ONLY\\_IN\\_NATIVE'));
    assert.equal((await getExportRecord(exportKey(source.conversationId)))?.status, 'ok');
    const beforeSkip = refreshes;
    assert.equal((await runExport(request)).skipped, 1);
    assert.equal(refreshes, beforeSkip);
});

test('source-coordinate degradation writes native code and known sources to disk and remains retryable', async t => {
    const host = v2ExportHost(t);
    const source = parse('G_REMAINING_RANGES_INVALID');
    let refreshes = 0;
    t.mock.method(GeminiProvider.prototype, 'fetchConversationDetail', async (accountId: string, id: string) => {
        refreshes++;
        await ingestDetail(accountId, id, source.conversation.detail, source.conversation.index);
    });
    await ingestDetail(account.id, source.conversationId, source.conversation.detail, source.conversation.index);
    const request = exportRequest([source.conversationId], { skipUnchanged: true });
    assert.equal((await runExport(request)).partial, 1);
    const record = await getExportRecord(exportKey(source.conversationId));
    assert.equal(record?.status, 'partial');
    assert.equal(record?.otherContentMissing, true);
    const markdown = await host.blobs[0].text();
    assert.ok(!markdown.includes('Fallback body remains available.'));
    assert.ok(markdown.includes('https://example.com/spp_fixture_'));
    for (const node of invalidSourceRangeNodes) for (const span of node.annotations.filter(a => a.type === 7)) {
        assert.ok(markdown.includes('`' + node.text.slice(span.start, span.end) + '`'));
    }
    const before = refreshes;
    assert.equal((await runExport(request)).skipped, 0);
    assert.equal(refreshes, before + 1);
});

test('interaction cleanup and a partial-code quote produce complete physical Markdown and a truthful receipt', async t => {
    const host = v2ExportHost(t);
    const markdown = 'Prefix `alpha beta` suffix.\n\n<FollowUp query="Next"/>';
    const quote = 'beta`';
    const start = markdown.indexOf(quote), end = start + quote.length;
    const target = 'https://example.com/verified-source';
    const metadata = [null, [[[quote, null, null, [[start, end], [start, end]]],
        [1], [[target, 'Verified source']], 'spp_owned']]];
    const raw = [
        [[citationText('Other body.')]],
        [[citationText('Prefix alpha beta suffix.', [
            [7, 17, [[null, null, null, null, 3]]],
            [0, 999, [null, null, null, [null, ['spp_owned']]]],
        ])]],
    ];
    const frames: unknown[] = JSON.parse(coverageWire(raw, [['rc_primary', [[markdown]], metadata]]));
    frames.unshift(['wrb.fr', 'MaZiqc', JSON.stringify([null, null, [
        ['c_coverage', 'Verified source fixture', null, null, null, [1700000000, 0]],
    ]])]);
    const source = mergeConversationPages([parseGeminiRpcConversation(JSON.stringify(frames), {
        account, providerId: 'gemini',
    })], undefined, true);
    assert.equal(source.conversation.detail.quality.status, 'complete');
    assert.ok(source.diagnostics.some(d => d.code === 'GEMINI_SOURCE_RANGE_RECOVERED'));
    t.mock.method(GeminiProvider.prototype, 'fetchConversationDetail', async (accountId: string, id: string) => {
        await ingestDetail(accountId, id, source.conversation.detail, source.conversation.index);
    });
    await ingestDetail(account.id, source.conversationId, source.conversation.detail, source.conversation.index);
    const request = exportRequest([source.conversationId], { skipUnchanged: true });
    const exported = await runExport(request);
    assert.equal(exported.exported, 1);
    assert.equal(exported.partial, 0);
    const physical = await host.blobs[0].text();
    assert.match(physical, /Prefix `alpha beta`/);
    assert.ok(physical.includes(target) && physical.includes(' suffix.'));
    assert.doesNotMatch(physical, /Other body|FollowUp/);
    assert.equal((await getExportRecord(exportKey(source.conversationId)))?.status, 'ok');
    assert.equal((await runExport(request)).skipped, 1);
});

test('a missing document body remains retryable and an owned packet supplies the physical file on repair', async t => {
    const host = v2ExportHost(t);
    const oldZip = __getZipConstructor();
    __setZipConstructor(require('../lib/jszip.min.js'));
    t.after(() => __setZipConstructor(oldZip));
    const raw = [[[citationText('See the report.'), citationField(24, [[
        ['http://immersive_entry_chip/report'], 'c_coverage_report', null, 'Owned report', null, null, null, 1,
    ]])]]];
    const candidate: unknown[] = ['rc_primary', [['See the report.']]];
    const read = () => {
        const frames: unknown[] = JSON.parse(coverageWire(raw, [candidate]));
        frames.unshift(['wrb.fr', 'MaZiqc', JSON.stringify([null, null, [
            ['c_coverage', 'Owned document fixture', null, null, null, [1700000000, 0]],
        ]])]);
        return mergeConversationPages([parseGeminiRpcConversation(JSON.stringify(frames), {
            account, providerId: 'gemini',
        })], undefined, true);
    };
    let source = read();
    let refreshes = 0;
    t.mock.method(GeminiProvider.prototype, 'fetchConversationDetail', async (accountId: string, id: string) => {
        refreshes++;
        await ingestDetail(accountId, id, source.conversation.detail, source.conversation.index);
    });
    await ingestDetail(account.id, source.conversationId, source.conversation.detail, source.conversation.index);
    const request = exportRequest([source.conversationId], { skipUnchanged: true, includeAssets: true });
    assert.equal((await runExport(request)).partial, 1);
    const record = await getExportRecord(exportKey(source.conversationId));
    assert.equal(record?.otherContentMissing, true);
    assert.equal(shouldSkipExport(record, source.sourceVersion, request), false);
    const beforeRetry = refreshes;
    await runExport(request);
    assert.equal(refreshes, beforeRetry + 1);

    const body = '# Owned report\n\nExact owned document body.';
    candidate[30] = [Object.assign(['c_coverage_report', null, 'Owned report', null, body], { 10: 1 })];
    source = read();
    assert.equal(source.conversation.detail.quality.status, 'complete');
    const repaired = await runExport(request);
    assert.equal(repaired.exported, 1);
    assert.equal(repaired.partial, 0);
    const files = await readDeliveredFiles(host);
    const document = files.find(file => file.name.startsWith('files/') && file.name.endsWith('.md'));
    assert.ok(document);
    assert.equal(await document.async('string'), body);
    assert.equal((await getExportRecord(exportKey(source.conversationId)))?.status, 'ok');
    const beforeSkip = refreshes;
    assert.equal((await runExport(request)).skipped, 1);
    assert.equal(refreshes, beforeSkip);
});
