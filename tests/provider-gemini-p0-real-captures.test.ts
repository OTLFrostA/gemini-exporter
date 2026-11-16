import test from 'node:test';
import assert from 'node:assert/strict';
import { detailGen } from './fixtures/providers/geminiDetail.js';
import { fixtureAccount } from './helpers/domainFixture.js';
import { v2ExportHost, exportKey, exportRequest } from './helpers/v2ExportHost.js';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import { mergeConversationPages } from '../src/l1/parsers/gemini/rpc/mergePages.js';
import { ingestDetail } from '../src/l2/ingestion.js';
import { runExport } from '../src/application/export/runExport.js';
import { getExportRecord } from '../src/l3a/storageService.js';
import { assertDomainClosure } from '../src/l2/closure.js';
import { maskTextPreservingDualCoordinates, sanitizeGeminiBatchexecuteWire } from '../scripts/sanitize_gemini_wire.js';

const account = fixtureAccount('gemini');

function parseRealCapture(key: Parameters<typeof detailGen>[0]) {
    const wire = detailGen(key);
    const page = parseGeminiRpcConversation(wire, { account, providerId: 'gemini' });
    const merged = mergeConversationPages([page], undefined, true);
    assert.equal(merged.conversation.detail.quality.status, 'complete', `${key}: real capture must parse as complete`);
    assert.deepEqual(
        merged.diagnostics.filter(d => d.severity === 'warning' || d.severity === 'error'),
        [],
        `${key}: real capture must emit zero warning/error diagnostics`,
    );
    assertDomainClosure(merged.conversation.detail);
    return merged;
}

async function exportPhysicalFormats(t: import('node:test').TestContext, key: Parameters<typeof detailGen>[0]) {
    const host = v2ExportHost(t);
    const merged = parseRealCapture(key);
    const targetAccountId = exportKey(merged.conversationId).accountId;
    await ingestDetail(targetAccountId, merged.conversationId, merged.conversation.detail, merged.conversation.index);

    const outputs: Record<'markdown' | 'html' | 'json', string> = { markdown: '', html: '', json: '' };
    for (const format of ['markdown', 'html', 'json'] as const) {
        const before = host.blobs.length;
        const result = await runExport(exportRequest([merged.conversationId], { format, includeAssets: false, skipUnchanged: false }));
        assert.equal(result.exported, 1, `${key} (${format}): expected 1 exported conversation`);
        assert.equal(result.partial, 0, `${key} (${format}): expected 0 partial`);
        assert.equal(host.blobs.length, before + 1);
        outputs[format] = await host.blobs[host.blobs.length - 1].text();
        assert.equal((await getExportRecord(exportKey(merged.conversationId)))?.status, 'ok');
    }
    return { merged, outputs };
}

test('P0 real capture [Imagen]: multi-frame batchexecute closes generated image identity and exports physical Markdown/HTML/JSON', async t => {
    const { merged, outputs } = await exportPhysicalFormats(t, 'G_P0_CAPTURED_IMAGEN_01');
    assert.equal(merged.conversation.index.title, 'Martian Astronaut Cat Drinking Coffee');
    assert.equal(merged.conversation.detail.messages.length, 4);
    assert.equal(merged.conversation.detail.assets.length, 1);
    const imgAsset = merged.conversation.detail.assets[0];
    assert.equal(imgAsset.kind, 'image');
    assert.ok(imgAsset.generation?.providerRequestId?.startsWith('r_'));
    assert.match(outputs.markdown, /Martian Astronaut Cat Drinking Coffee/);
    assert.ok(outputs.html.includes('<table') && outputs.html.includes('Martian Astronaut Cat'));
    const exportedJson = JSON.parse(outputs.json);
    assert.equal(exportedJson.conversation.detail.assets[0].kind, 'image');
});

test('P0 real capture [Python Code]: multi-frame batchexecute preserves decorator code blocks, headings and lists across formats', async t => {
    const { merged, outputs } = await exportPhysicalFormats(t, 'G_P0_CAPTURED_PYTHON_CODE_01');
    assert.equal(merged.conversation.index.title, 'Python日志与耗时装饰器设计');
    assert.equal(merged.conversation.detail.messages.length, 2);
    assert.match(outputs.markdown, /```python[\s\S]*functools\.wraps[\s\S]*```/);
    assert.ok(outputs.html.includes('functools.wraps'));
});

test('P0 real capture [User File]: multi-frame batchexecute binds uploaded JSON file asset and hidden file citation without [1] leakage', async t => {
    const { merged, outputs } = await exportPhysicalFormats(t, 'G_P0_CAPTURED_USER_FILE_01');
    assert.equal(merged.conversation.detail.messages.length, 2);
    const fileAsset = merged.conversation.detail.assets.find(a => a.kind === 'file');
    assert.ok(fileAsset);
    assert.equal(fileAsset.name, 'test_config.json');
    assert.match(outputs.markdown, /test\\_config\.json|test_config\.json/);
    assert.doesNotMatch(outputs.markdown, /\[cite:\s*1\]/i, 'native file citation marker must be closed');
});

test('P0 real capture [Multimodal 5-Turn]: multi-frame batchexecute preserves generated schematic, LaTeX math, tables, code and citations', async t => {
    const { merged, outputs } = await exportPhysicalFormats(t, 'G_P0_CAPTURED_MULTIMODAL_BRAGG_01');
    assert.equal(merged.conversation.detail.messages.length, 10);
    const blockKinds = new Set(merged.conversation.detail.messages.flatMap(m => m.content.map(b => b.type)));
    for (const expectedKind of ['paragraph', 'heading', 'table', 'list', 'code', 'math'] as const) {
        assert.ok(blockKinds.has(expectedKind), `missing block kind ${expectedKind} in 5-turn multimodal capture`);
    }
    assert.equal(merged.conversation.detail.assets.length, 1);
    assert.equal(merged.conversation.detail.assets[0].kind, 'image');
    assert.ok(outputs.markdown.includes('$$') && outputs.markdown.includes('|'));
    assert.ok(outputs.html.includes('katex') || outputs.html.includes('math'));
});

test('P0 real capture [Quantum Table]: multi-frame batchexecute preserves inline search diagram, display math and multi-column comparison table', async t => {
    const { merged, outputs } = await exportPhysicalFormats(t, 'G_P0_CAPTURED_QUANTUM_TABLE_01');
    assert.equal(merged.conversation.index.title, '贝尔不等式推导与物理意义');
    assert.equal(merged.conversation.detail.messages.length, 4);
    assert.equal(merged.conversation.detail.assets.length, 1);
    assert.equal(merged.conversation.detail.assets[0].kind, 'image');
    assert.match(outputs.markdown, /贝尔不等式/);
    assert.ok(outputs.markdown.includes('|') && outputs.markdown.includes('$$'));
    assert.ok(outputs.html.includes('<table'));
});

test('P0 real capture [Web Citations]: multi-frame batchexecute binds all six spp_ web source attributions into physical links', async t => {
    const { merged, outputs } = await exportPhysicalFormats(t, 'G_P0_CAPTURED_WEB_CITATIONS_01');
    assert.equal(merged.conversation.index.title, '韦伯望远镜深空探测重大发现');
    const citations = merged.conversation.detail.messages.flatMap(m => m.citations ?? []);
    assert.equal(citations.length, 6);
    for (const cit of citations) {
        assert.ok(cit.url?.startsWith('https://'), `expected https citation URL, got ${cit.url}`);
        assert.ok(outputs.markdown.includes(cit.url!), `rendered Markdown must contain linked source ${cit.url}`);
        assert.ok(outputs.html.includes(cit.url!), `rendered HTML must contain linked source ${cit.url}`);
    }
});

test('P0 wire sanitizer: full dual-coordinate masking preserves exact UTF-8/UTF-16 offsets, AST topology and complete quality across all real captures', () => {
    const encoder = new TextEncoder();
    const sample = '引言😀 Prefix `alpha_beta(123)` 中文测试 **$E = mc^2$** [cite: 1] 结尾！';
    const masked = maskTextPreservingDualCoordinates(sample, 'unit-salt');
    assert.equal(masked.length, sample.length, 'UTF-16 code-unit length must stay invariant');
    assert.equal(encoder.encode(masked).length, encoder.encode(sample).length, 'UTF-8 byte length must stay invariant');
    assert.equal(masked.includes('引言'), false);
    assert.equal(masked.includes('alpha'), false);
    assert.ok(masked.includes('[cite: 1]'));

    const allKeys = [
        'G_P0_CAPTURED_IMAGEN_01',
        'G_P0_CAPTURED_PYTHON_CODE_01',
        'G_P0_CAPTURED_USER_FILE_01',
        'G_P0_CAPTURED_MULTIMODAL_BRAGG_01',
        'G_P0_CAPTURED_QUANTUM_TABLE_01',
        'G_P0_CAPTURED_WEB_CITATIONS_01',
    ] as const;

    for (const key of allKeys) {
        const originalWire = detailGen(key);
        const baseline = parseRealCapture(key);
        const blindedWire = sanitizeGeminiBatchexecuteWire(originalWire, { mode: 'full', salt: 'blind-audit-salt' });
        const blinded = mergeConversationPages(
            [parseGeminiRpcConversation(blindedWire, { account, providerId: 'gemini' })],
            undefined,
            true,
        );
        assert.equal(blinded.conversation.detail.quality.status, 'complete', `${key}: full-blinded wire must remain complete`);
        assert.deepEqual(
            blinded.diagnostics.filter(d => d.severity === 'warning' || d.severity === 'error'),
            [],
            `${key}: full-blinded wire must produce zero warnings`,
        );
        assert.equal(blinded.conversation.detail.messages.length, baseline.conversation.detail.messages.length);
        assert.equal(blinded.conversation.detail.assets.length, baseline.conversation.detail.assets.length);
        assert.deepEqual(
            blinded.conversation.detail.messages.map(m => m.content.map(b => b.type)),
            baseline.conversation.detail.messages.map(m => m.content.map(b => b.type)),
            `${key}: block AST topology must be 100% isomorphic after full prose masking`,
        );
        assert.equal(
            blinded.conversation.detail.messages.flatMap(m => m.citations ?? []).length,
            baseline.conversation.detail.messages.flatMap(m => m.citations ?? []).length,
            `${key}: citation bindings must survive dual-coordinate masking intact`,
        );
        assertDomainClosure(blinded.conversation.detail);
    }
});
