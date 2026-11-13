import test from 'node:test';
import assert from 'node:assert/strict';
import { v2ExportHost, exportKey, exportRequest } from './helpers/v2ExportHost.js';
import { fixtureAccount } from './helpers/domainFixture.js';
import { detailGen } from './fixtures/providers/geminiDetail.js';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import { mergeConversationPages } from '../src/l1/parsers/gemini/rpc/mergePages.js';
import { GeminiProvider } from '../src/l1/client/gemini/geminiProvider.js';
import { ingestDetail } from '../src/l2/ingestion.js';
import { runExport, shouldSkipExport } from '../src/application/export/runExport.js';
import { getExportRecord } from '../src/l3a/storageService.js';
import { invalidSourceRangeNodes } from './fixtures/providers/gemini/detail/remainingSourceRanges.js';

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
